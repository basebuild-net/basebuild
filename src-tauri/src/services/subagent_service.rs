//! Subagents: the `task` tool. A parent turn fans independent assignments out
//! to child chat sessions that run concurrently, then folds their final
//! reports into one tool result.
//!
//! Children are ordinary `native_chat_sessions` rows linked to the parent by
//! `parent_session_id`, so their transcript, tool events, and metrics reuse the
//! existing storage. Chat lists hide them. A child runs the same agent loop
//! with `ToolScope::Subagent`: it cannot ask the user questions, cannot propose
//! ideas, and cannot start subagents of its own. Its approval requests route to
//! the parent's task card instead of the chat.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use crate::models::native_chat::NativeChatSession;
use crate::services::agent_loop_service::{self, CancellationToken, RunResult, ToolScope};
use crate::services::native_chat_service::NativeChatService;
use crate::services::plan_runner_service::PlanRunnerService;
use crate::services::provider_client::{ChatMsg, ToolCallRequest};
use crate::services::settings_service::SettingsService;
use crate::services::tool_runtime_service::ToolResult;

/// Tool name the parent model calls to start subagents.
pub const TASK_TOOL_NAME: &str = "task";

/// Most entries one `task` call may carry. Mirrors the schema's `maxItems`.
const MAX_TASKS_PER_CALL: usize = 8;
const NAME_MAX_CHARS: usize = 60;
const ASSIGNMENT_MAX_CHARS: usize = 8000;
/// Cap on the combined reports returned to the parent model.
const RESULT_MAX_CHARS: usize = 20_000;

const SUBAGENT_NOTICE: &str = "You are a subagent running one assignment for a parent agent. \
You cannot ask the user questions and you cannot start other subagents. Work on the assignment \
alone, using the tools you have. When you are done, reply with a concise final report: what you \
did, what you found or changed, and anything the parent still needs to decide. Your final reply \
is the only output the parent sees.";

/// Bookkeeping for one live child, keyed by its child session id.
#[derive(Clone)]
struct ChildInfo {
    parent_session_id: String,
    tool_call_id: String,
    index: i64,
    name: String,
    /// Wakes this child's permit wait when the parent is cancelled.
    wake: Arc<Notify>,
}

/// Live children. A child is registered before its thread starts and removed
/// when it reaches a terminal state.
static CHILDREN: LazyLock<Mutex<HashMap<String, ChildInfo>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Everything a `task` call needs from the parent turn. Children reuse the
/// parent's credentials and system prompt.
pub struct SubagentHost {
    pub session_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// Provider account the parent turn runs on. Child metrics record it.
    pub account_id: Option<String>,
    pub system: String,
    /// Caps this turn's children at once (`subagent_max_count`).
    pub gate: Arc<Semaphore>,
    pub app: AppHandle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskEntry {
    pub name: String,
    pub assignment: String,
}

struct PendingChild {
    session: NativeChatSession,
    index: i64,
    name: String,
    assignment: String,
    wake: Arc<Notify>,
}

struct ChildReport {
    index: i64,
    name: String,
    status: &'static str,
    report: String,
}

/// Validate `task` arguments: `{ "tasks": [{ "name", "assignment" }, ...] }`.
/// Unknown keys are refused so a misspelled field cannot be silently dropped.
pub fn parse_task_arguments(args: &Value) -> Result<Vec<TaskEntry>, String> {
    let object = args
        .as_object()
        .ok_or_else(|| "task arguments must be a JSON object.".to_string())?;
    if let Some(key) = object.keys().find(|key| key.as_str() != "tasks") {
        return Err(format!("Unknown parameter: {key}"));
    }
    let tasks = object
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing required parameter: tasks".to_string())?;
    if tasks.is_empty() {
        return Err("task needs at least one entry in tasks.".to_string());
    }
    if tasks.len() > MAX_TASKS_PER_CALL {
        return Err(format!(
            "task accepts at most {MAX_TASKS_PER_CALL} entries per call."
        ));
    }
    tasks
        .iter()
        .enumerate()
        .map(|(position, entry)| {
            let number = position + 1;
            let entry = entry
                .as_object()
                .ok_or_else(|| format!("Entry {number} must be an object."))?;
            if let Some(key) = entry
                .keys()
                .find(|key| !matches!(key.as_str(), "name" | "assignment"))
            {
                return Err(format!("Entry {number} has unknown field: {key}"));
            }
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if name.is_empty() {
                return Err(format!("Entry {number} needs a name."));
            }
            if name.chars().count() > NAME_MAX_CHARS {
                return Err(format!(
                    "Entry {number} name is longer than {NAME_MAX_CHARS} characters."
                ));
            }
            let assignment = entry
                .get("assignment")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if assignment.is_empty() {
                return Err(format!("Entry {number} needs an assignment."));
            }
            if assignment.chars().count() > ASSIGNMENT_MAX_CHARS {
                return Err(format!(
                    "Entry {number} assignment is longer than {ASSIGNMENT_MAX_CHARS} characters."
                ));
            }
            Ok(TaskEntry {
                name: name.to_string(),
                assignment: assignment.to_string(),
            })
        })
        .collect()
}

/// Subagent cap for a parent turn on `provider_id`: `Some(max)` when the
/// project's effective run-concurrency entry enables subagents with a cap
/// above zero. Fails closed (no subagents) when the setting cannot be read.
pub fn concurrency_cap(project_path: &str, provider_id: &str) -> Option<u32> {
    let entry = SettingsService::effective_run_concurrency(project_path, provider_id).ok()?;
    (entry.subagents_enabled && entry.subagent_max_count > 0).then_some(entry.subagent_max_count)
}

/// Run one `task` call: create a child per entry, run them concurrently, and
/// return their reports in entry order. Blocks until every child is terminal.
pub fn execute_task(host: &SubagentHost, call: &ToolCallRequest, token: &CancellationToken) -> ToolResult {
    let args: Value = match serde_json::from_str(&call.arguments) {
        Ok(value) => value,
        Err(error) => {
            return ToolResult::failure(format!("task arguments are not valid JSON: {error}"))
        }
    };
    let entries = match parse_task_arguments(&args) {
        Ok(entries) => entries,
        Err(error) => return ToolResult::failure(error),
    };
    let parent = match NativeChatService::get_session(&host.session_id) {
        Ok(Some(parent)) => parent,
        Ok(None) => {
            return ToolResult::failure("The parent chat session no longer exists.".to_string())
        }
        Err(error) => {
            return ToolResult::failure(format!("Could not load the parent chat: {error}"))
        }
    };

    // Create every child before any thread starts, so the card lists all
    // entries as queued from the first event.
    let mut pending: Vec<PendingChild> = Vec::with_capacity(entries.len());
    for (position, entry) in entries.into_iter().enumerate() {
        let index = position as i64;
        match NativeChatService::create_subagent_session(
            &parent,
            &call.id,
            index,
            &entry.name,
            &entry.assignment,
        ) {
            Ok(session) => {
                let wake = Arc::new(Notify::new());
                CHILDREN.lock().insert(
                    session.id.clone(),
                    ChildInfo {
                        parent_session_id: host.session_id.clone(),
                        tool_call_id: call.id.clone(),
                        index,
                        name: entry.name.clone(),
                        wake: wake.clone(),
                    },
                );
                emit_child(&host.app, &session.id, "queued", json!({}));
                pending.push(PendingChild {
                    session,
                    index,
                    name: entry.name,
                    assignment: entry.assignment,
                    wake,
                });
            }
            Err(error) => {
                for child in &pending {
                    finish_child(&host.app, &child.session.id, "failed", None);
                }
                return ToolResult::failure(format!(
                    "Could not start subagent \"{}\": {error}",
                    entry.name
                ));
            }
        }
    }

    let reports: Vec<ChildReport> = thread::scope(|scope| {
        let handles: Vec<_> = pending
            .iter()
            .map(|child| (child, scope.spawn(move || run_child(host, token, child))))
            .collect();
        handles
            .into_iter()
            .map(|(child, handle)| {
                handle.join().unwrap_or_else(|_| {
                    finish_child(&host.app, &child.session.id, "failed", None);
                    ChildReport {
                        index: child.index,
                        name: child.name.clone(),
                        status: "failed",
                        report: "The subagent stopped unexpectedly.".to_string(),
                    }
                })
            })
            .collect()
    });
    ToolResult::success(format_reports(&reports))
}

fn run_child(host: &SubagentHost, parent_token: &CancellationToken, pending: &PendingChild) -> ChildReport {
    let child = &pending.session;
    let finished = |status: &'static str, report: String| ChildReport {
        index: pending.index,
        name: pending.name.clone(),
        status,
        report,
    };
    let runtime = match tokio::runtime::Builder::new_current_thread().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            finish_child(&host.app, &child.id, "failed", None);
            return finished("failed", format!("The subagent could not start: {error}"));
        }
    };
    // Both permits stay held until this function returns, so the child counts
    // against the caps for its whole run.
    let Some((_gate, _provider)) =
        acquire_run_permits(host, child, parent_token, &runtime, &pending.wake)
    else {
        finish_child(&host.app, &child.id, "cancelled", None);
        return finished("cancelled", String::new());
    };

    let started_at = now_millis();
    let clock = Instant::now();
    let _ = NativeChatService::set_subagent_status(&child.id, "running");
    emit_child(&host.app, &child.id, "running", json!({}));

    let system = format!("{}\n\n{SUBAGENT_NOTICE}", host.system);
    // The loop persists this child's assistant rows and tool events under the
    // child session as it streams, so the final text is already in the
    // transcript and is not written again here.
    let run = agent_loop_service::run_agent_turn(
        &child.id,
        &child.project_path,
        &child.provider_id,
        &child.model_id,
        &child.effort_level,
        host.api_key.clone(),
        host.base_url.clone(),
        host.account_id.clone(),
        system,
        vec![ChatMsg::text("user", pending.assignment.as_str())],
        host.app.clone(),
        ToolScope::Subagent,
        None,
    );
    let (status, text) = classify(&run);
    let outcome = match status {
        "completed" => "success",
        "cancelled" => "cancelled",
        _ => "error",
    };
    let duration_ms = clock.elapsed().as_millis() as i64;
    let _ = NativeChatService::record_child_metric(
        child,
        started_at,
        duration_ms,
        &run.usage,
        outcome,
        host.account_id.as_deref(),
    );
    finish_child(
        &host.app,
        &child.id,
        status,
        (!text.is_empty()).then_some(text.as_str()),
    );
    finished(status, text)
}

/// Map a finished child run to a terminal status and the report text the
/// parent will see.
fn classify(run: &RunResult) -> (&'static str, String) {
    if run.cancelled {
        return ("cancelled", String::new());
    }
    let content = run.content.trim();
    if run.completed {
        let text = if content.is_empty() {
            "The subagent finished without a written report.".to_string()
        } else {
            content.to_string()
        };
        return ("completed", text);
    }
    if run.hit_cap {
        return (
            "failed",
            "The subagent reached its iteration limit before finishing.".to_string(),
        );
    }
    ("failed", "The subagent stopped before finishing.".to_string())
}

fn format_reports(reports: &[ChildReport]) -> String {
    let mut out = String::new();
    for report in reports {
        out.push_str(&format!(
            "## {}. {} ({})\n",
            report.index + 1,
            report.name,
            report.status
        ));
        let body = report.report.trim();
        out.push_str(if body.is_empty() { "(no report)" } else { body });
        out.push_str("\n\n");
    }
    let out = out.trim_end();
    if out.chars().count() > RESULT_MAX_CHARS {
        let cut: String = out.chars().take(RESULT_MAX_CHARS).collect();
        return format!("{}\n\n[Result truncated.]", cut.trim_end());
    }
    out.to_string()
}

/// Wait for a permit without polling. `cancel_run` wakes `wake` when the parent
/// is cancelled, so a queued child is released promptly. Returns `None` when the
/// parent was cancelled first or the semaphore was closed.
fn acquire_permit(
    semaphore: &Arc<Semaphore>,
    parent_token: &CancellationToken,
    runtime: &tokio::runtime::Runtime,
    wake: &Notify,
) -> Option<OwnedSemaphorePermit> {
    if parent_token.is_cancelled() {
        return None;
    }
    runtime.block_on(async {
        loop {
            tokio::select! {
                permit = semaphore.clone().acquire_owned() => {
                    // A permit granted after cancellation is dropped here, which
                    // returns it to the semaphore at once.
                    return permit.ok().filter(|_| !parent_token.is_cancelled());
                }
                _ = wake.notified() => {
                    if parent_token.is_cancelled() {
                        return None;
                    }
                }
            }
        }
    })
}

/// Wait for the parent turn's gate, then the provider's concurrency permit.
/// Both stay held for the child's whole run, so subagents count against the
/// same `run-concurrency-limits` cap as plan runs.
fn acquire_run_permits(
    host: &SubagentHost,
    session: &NativeChatSession,
    parent_token: &CancellationToken,
    runtime: &tokio::runtime::Runtime,
    wake: &Notify,
) -> Option<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
    let gate = acquire_permit(&host.gate, parent_token, runtime, wake)?;
    let provider = PlanRunnerService::provider_semaphore(&session.project_path, &session.provider_id);
    Some((gate, acquire_permit(&provider, parent_token, runtime, wake)?))
}

/// Parent chat session of a live child. `None` for any other session id.
pub fn parent_of(session_id: &str) -> Option<String> {
    CHILDREN
        .lock()
        .get(session_id)
        .map(|info| info.parent_session_id.clone())
}

/// Wake the queued children of `parent_session_id` so each re-checks whether
/// its parent was cancelled.
pub fn wake_children(parent_session_id: &str) {
    for info in CHILDREN.lock().values() {
        if info.parent_session_id == parent_session_id {
            info.wake.notify_one();
        }
    }
}

/// Persist a terminal state, tell the UI, and drop the child from the live set.
fn finish_child(app: &AppHandle, child_id: &str, status: &str, result: Option<&str>) {
    let _ = NativeChatService::set_subagent_status(child_id, status);
    let detail = match result {
        Some(text) => json!({ "result": text }),
        None => json!({}),
    };
    emit_child(app, child_id, status, detail);
    CHILDREN.lock().remove(child_id);
}

/// Emit `native-chat://subagent-event` for a live child. Silently does nothing
/// for ids that are not registered children.
fn emit_child(app: &AppHandle, child_id: &str, status: &str, detail: Value) {
    let Some(info) = CHILDREN.lock().get(child_id).cloned() else {
        return;
    };
    let mut payload = json!({
        "sessionId": info.parent_session_id,
        "toolCallId": info.tool_call_id,
        "index": info.index,
        "name": info.name,
        "childSessionId": child_id,
        "status": status,
    });
    if let (Some(map), Value::Object(extra)) = (payload.as_object_mut(), detail) {
        map.extend(extra);
    }
    let _ = app.emit("native-chat://subagent-event", payload);
}

/// Whether `session_id` is a live subagent child.
pub fn is_subagent(session_id: &str) -> bool {
    CHILDREN.lock().contains_key(session_id)
}

/// Live child session ids of `parent_session_id`.
pub fn live_children(parent_session_id: &str) -> Vec<String> {
    CHILDREN
        .lock()
        .iter()
        .filter(|(_, info)| info.parent_session_id == parent_session_id)
        .map(|(child_id, _)| child_id.clone())
        .collect()
}

/// Approval registry key for a tool call. Provider call ids can repeat across
/// child runs, so a child's key is scoped by its session id. Parent calls keep
/// the raw call id.
pub fn approval_key(session_id: &str, call_id: &str) -> String {
    if is_subagent(session_id) {
        format!("{session_id}#{call_id}")
    } else {
        call_id.to_string()
    }
}

/// Mark a child as waiting on an approval the parent card must answer.
pub fn note_approval_pending(
    app: &AppHandle,
    child_id: &str,
    key: &str,
    tool_name: &str,
    command: Option<&str>,
    arguments: &str,
) {
    let _ = NativeChatService::set_subagent_status(child_id, "awaiting_approval");
    emit_child(
        app,
        child_id,
        "awaiting_approval",
        json!({
            "pendingApproval": {
                "toolCallId": key,
                "toolName": tool_name,
                "command": command,
                "arguments": arguments,
            }
        }),
    );
}

/// Clear the approval prompt once the user has answered.
pub fn note_approval_resolved(app: &AppHandle, child_id: &str) {
    let _ = NativeChatService::set_subagent_status(child_id, "running");
    emit_child(app, child_id, "running", json!({ "pendingApproval": null }));
}

/// Show what a child is doing right now. No-op for non-children.
pub fn note_activity(app: &AppHandle, session_id: &str, activity: &str) {
    if is_subagent(session_id) {
        emit_child(app, session_id, "running", json!({ "activity": activity }));
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Test hook: register a live child under `parent_session_id` without
/// spawning its thread, so admission rules can be exercised directly.
#[cfg(test)]
pub(crate) fn register_child_for_test(child_id: &str, parent_session_id: &str) {
    CHILDREN.lock().insert(
        child_id.to_string(),
        ChildInfo {
            parent_session_id: parent_session_id.to_string(),
            tool_call_id: "call-test".to_string(),
            index: 0,
            name: "test".to_string(),
            wake: Arc::new(Notify::new()),
        },
    );
}

#[cfg(test)]
pub(crate) fn forget_child_for_test(child_id: &str) {
    CHILDREN.lock().remove(child_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_named_assignments() {
        let args = json!({ "tasks": [
            { "name": "  Auth ", "assignment": "Read the login flow." },
            { "name": "Tests", "assignment": "List the failing tests." }
        ]});
        let entries = parse_task_arguments(&args).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Auth");
        assert_eq!(entries[1].assignment, "List the failing tests.");
    }

    #[test]
    fn permit_wait_returns_when_a_slot_is_free() {
        let semaphore = Arc::new(Semaphore::new(1));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let permit = acquire_permit(
            &semaphore,
            &CancellationToken::new(),
            &runtime,
            &Notify::new(),
        );
        assert!(permit.is_some());
        assert_eq!(semaphore.available_permits(), 0);
    }

    #[test]
    fn cancelled_parent_takes_no_permit() {
        let semaphore = Arc::new(Semaphore::new(1));
        let parent = CancellationToken::new();
        parent.cancel();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let permit = acquire_permit(&semaphore, &parent, &runtime, &Notify::new());
        assert!(permit.is_none(), "a cancelled parent must not start a child");
        assert_eq!(semaphore.available_permits(), 1, "no permit may leak");
    }

    #[test]
    fn queued_child_is_released_when_its_parent_is_cancelled() {
        let semaphore = Arc::new(Semaphore::new(0));
        let parent = Arc::new(CancellationToken::new());
        let wake = Arc::new(Notify::new());
        let (tx, rx) = std::sync::mpsc::channel();
        let (waiter_semaphore, waiter_parent, waiter_wake) =
            (semaphore.clone(), parent.clone(), wake.clone());
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap();
            let permit = acquire_permit(&waiter_semaphore, &waiter_parent, &runtime, &waiter_wake);
            let _ = tx.send(permit.is_some());
        });
        parent.cancel();
        wake.notify_one();
        let got = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("queued child must return once its parent is cancelled");
        assert!(!got, "a cancelled queued child must not receive a permit");
    }

    #[test]
    fn rejects_empty_and_oversized_lists() {
        assert!(parse_task_arguments(&json!({ "tasks": [] })).is_err());
        let nine: Vec<Value> = (0..9)
            .map(|i| json!({ "name": format!("t{i}"), "assignment": "x" }))
            .collect();
        assert!(parse_task_arguments(&json!({ "tasks": nine })).is_err());
    }

    #[test]
    fn rejects_unknown_fields_and_blank_text() {
        assert!(parse_task_arguments(&json!({ "tasks": [], "extra": 1 })).is_err());
        assert!(parse_task_arguments(&json!({ "tasks": [{ "name": "a", "assignment": "x", "model": "m" }] })).is_err());
        assert!(parse_task_arguments(&json!({ "tasks": [{ "name": " ", "assignment": "x" }] })).is_err());
        assert!(parse_task_arguments(&json!({ "tasks": [{ "name": "a", "assignment": "  " }] })).is_err());
    }
}

//! Backend-owned agent loop: the core agentic execution engine.
//!
//! Runs on a dedicated thread per turn. Streams provider output, collects tool
//! calls, resolves them through the approval gateway, executes approved calls,
//! appends results, and re-requests until the model returns no tool calls, an
//! iteration cap is reached, or the run is cancelled. Crash-safe: run state is
//! persisted so a restart never shows a phantom running state.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::models::permission::{GatewayDecision, PermissionDecision, SessionRule};
use crate::services::provider_client::{
    resolve_client, ChatMsg, ProviderClient, ProviderRequest, ProviderResponse, ToolCallRequest,
    ToolSchema,
};
use crate::services::settings_service::SettingsService;
use crate::services::tool_runtime_service::{registry, ToolDef, ToolKind, ToolResult};

/// Maximum loop iterations before stopping.
const MAX_ITERATIONS: usize = 25;
/// Conservative default context window when the catalog doesn't report one.
const DEFAULT_CONTEXT_WINDOW: i64 = 32_000;
/// Output margin reserved for the model's response.
const OUTPUT_MARGIN_MIN: i64 = 8_000;
const OUTPUT_MARGIN_RATIO: f64 = 0.2;
/// Maximum tool result sent to the model before head+tail truncation.
const MAX_TOOL_RESULT_TOKENS: i64 = 4_000;

/// Tracks active runs so cancellation can find them. Keyed by session id.
static ACTIVE_RUNS: LazyLock<Mutex<std::collections::HashMap<String, Arc<RunHandle>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// A cancellation token for a running agent loop.
pub struct CancellationToken {
    cancelled: AtomicBool,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle to a running loop, stored in ACTIVE_RUNS for cancellation.
struct RunHandle {
    token: CancellationToken,
}

/// The result of an agent loop run.
#[derive(Debug, Clone)]
pub struct RunResult {
    /// Final assistant content (may be empty if the loop ended on a tool call
    /// that hit the iteration cap).
    pub content: String,
    /// Whether the loop completed normally (no tool calls in the last response).
    pub completed: bool,
    /// Whether the run was cancelled.
    pub cancelled: bool,
    /// Whether the iteration cap was reached.
    pub hit_cap: bool,
    /// Whether the context budget truncated old turns.
    pub truncated: bool,
    /// Tool events recorded during the run.
    pub tool_events: Vec<ToolEventRecord>,
}

/// A tool event recorded during a run (persisted to native_tool_events by the caller).
#[derive(Debug, Clone)]
pub struct ToolEventRecord {
    pub tool_name: String,
    pub status: String,
    pub summary: String,
    pub duration_ms: i64,
    pub decision: String,
    pub rule_source: Option<String>,
}

/// Run an agentic loop for a session. This is the entry point for both
/// `native_chat_service::send` (UI-driven) and future plan-run callers.
///
/// `session_id` identifies the session for cancellation and event routing.
/// `project_path` is the workspace root for tool scoping.
/// `provider_id`, `model_id`, `effort_level` select the provider client.
/// `api_key` and `base_url` are credentials.
/// `system` is the system prompt.
/// `messages` is the full conversation history (user + assistant + tool turns).
/// `app` is the Tauri handle for emitting streaming events.
/// `supports_tools` gates whether tools are offered (false = plain chat).
///
/// Returns the final `RunResult`. The loop runs on the calling thread (blocking).
pub fn run_agent_turn(
    session_id: &str,
    project_path: &str,
    provider_id: &str,
    model_id: &str,
    effort_level: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    system: String,
    messages: Vec<ChatMsg>,
    app: AppHandle,
    supports_tools: bool,
) -> RunResult {
    let token = Arc::new(CancellationToken::new());
    let handle = Arc::new(RunHandle {
        token: CancellationToken::new(),
    });
    // Register for cancellation.
    {
        let mut active = ACTIVE_RUNS.lock();
        active.insert(session_id.to_string(), handle.clone());
    }
    // Mark run state as running.
    set_run_state(session_id, "running");

    let result = run_loop_inner(
        session_id,
        project_path,
        provider_id,
        model_id,
        effort_level,
        api_key,
        base_url,
        &system,
        messages,
        &app,
        supports_tools,
        &handle.token,
    );

    // Unregister and mark idle.
    {
        let mut active = ACTIVE_RUNS.lock();
        active.remove(session_id);
    }
    let final_state = if result.cancelled { "cancelled" } else { "idle" };
    set_run_state(session_id, final_state);

    result
}

/// Cancel a running agent loop for a session. Returns true if a run was found.
pub fn cancel_run(session_id: &str) -> bool {
    let active = ACTIVE_RUNS.lock();
    if let Some(handle) = active.get(session_id) {
        handle.token.cancel();
        true
    } else {
        false
    }
}

/// On startup, sweep any sessions left in 'running' state and mark them
/// 'interrupted' so the UI shows a recovery notice.
pub fn sweep_interrupted_runs() {
    let conn = match crate::services::storage_service::StorageService::connect() {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute(
        "UPDATE native_chat_sessions SET run_state = 'interrupted' WHERE run_state = 'running'",
        [],
    );
}

/// Set the run_state column on a native chat session.
fn set_run_state(session_id: &str, state: &str) {
    if let Ok(conn) = crate::services::storage_service::StorageService::connect() {
        let _ = conn.execute(
            "UPDATE native_chat_sessions SET run_state = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![state, now_millis(), session_id],
        );
    }
}

fn run_loop_inner(
    session_id: &str,
    project_path: &str,
    provider_id: &str,
    model_id: &str,
    effort_level: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    system: &str,
    mut messages: Vec<ChatMsg>,
    app: &AppHandle,
    supports_tools: bool,
    token: &CancellationToken,
) -> RunResult {
    let tools: Vec<ToolSchema> = if supports_tools {
        registry().iter().map(|t| t.schema.clone()).collect()
    } else {
        Vec::new()
    };
    let tool_defs = if supports_tools {
        registry()
    } else {
        Vec::new()
    };
    let workspace_root = PathBuf::from(project_path);
    let session_rules: Vec<SessionRule> = Vec::new();
    let mut tool_events: Vec<ToolEventRecord> = Vec::new();
    let mut truncated = false;
    let mut iteration = 0;

    loop {
        iteration += 1;
        if token.is_cancelled() {
            return RunResult {
                content: String::new(),
                completed: false,
                cancelled: true,
                hit_cap: false,
                truncated,
                tool_events,
            };
        }
        if iteration > MAX_ITERATIONS {
            emit_system_row(app, session_id, "iteration-cap", MAX_ITERATIONS);
            return RunResult {
                content: String::new(),
                completed: false,
                cancelled: false,
                hit_cap: true,
                truncated,
                tool_events,
            };
        }

        // Context budget guard: trim old turns if over budget.
        let budget = context_budget(model_id);
        let (trimmed_messages, did_truncate) =
            trim_to_budget(&messages, system, &tools, budget);
        if did_truncate {
            truncated = true;
            emit_system_row(app, session_id, "truncated", 0);
        }
        messages = trimmed_messages;

        // Build the request.
        let req = ProviderRequest {
            model_id: model_id.to_string(),
            effort_level: effort_level.to_string(),
            system: Some(system.to_string()),
            messages: messages.clone(),
            api_key: api_key.clone(),
            base_url: base_url.clone(),
            tools: tools.clone(),
        };

        let client = resolve_client(provider_id, base_url.as_deref());
        let session_id_for_emit = session_id.to_string();
        let app_for_emit = app.clone();
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                "native-chat://chunk",
                json!({ "sessionId": session_id_for_emit, "delta": delta, "channel": channel }),
            );
        };

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
                return RunResult {
                    content: format!("Error: {e}"),
                    completed: false,
                    cancelled: false,
                    hit_cap: false,
                    truncated,
                    tool_events,
                };
            }
        };

        // Append the assistant message to history.
        let mut assistant_msg = ChatMsg::text("assistant", response.content.clone());
        assistant_msg.tool_calls = response.tool_calls.clone();
        messages.push(assistant_msg);

        // If no tool calls, the loop is done.
        if response.tool_calls.is_empty() {
            return RunResult {
                content: response.content,
                completed: true,
                cancelled: false,
                hit_cap: false,
                truncated,
                tool_events,
            };
        }

        // Process tool calls.
        let tool_results = process_tool_calls(
            &response.tool_calls,
            &tool_defs,
            &workspace_root,
            project_path,
            &session_rules,
            token,
            app,
            session_id,
            &mut tool_events,
        );

        // Append tool results as messages.
        for (call, result) in tool_results {
            messages.push(ChatMsg {
                role: "tool".to_string(),
                content: result.content,
                tool_calls: Vec::new(),
                tool_call_id: Some(call.id),
                name: Some(call.name),
            });
        }
    }
}

/// Process a batch of tool calls: resolve through gateway, execute, record events.
/// Read-only calls run concurrently; mutating calls run sequentially.
fn process_tool_calls(
    calls: &[ToolCallRequest],
    tool_defs: &[ToolDef],
    workspace_root: &Path,
    project_path: &str,
    session_rules: &[SessionRule],
    token: &CancellationToken,
    app: &AppHandle,
    session_id: &str,
    tool_events: &mut Vec<ToolEventRecord>,
) -> Vec<(ToolCallRequest, ToolResult)> {
    // Partition into read-only and mutating.
    let mut results: Vec<(ToolCallRequest, ToolResult)> = Vec::with_capacity(calls.len());

    // Execute read-only calls (concurrently via threads).
    let read_only: Vec<(usize, &ToolCallRequest)> = calls
        .iter()
        .enumerate()
        .filter(|(_, c)| tool_def_for(&c.name, tool_defs).map(|d| d.kind == ToolKind::ReadOnly).unwrap_or(false))
        .collect();
    let mutating: Vec<(usize, &ToolCallRequest)> = calls
        .iter()
        .enumerate()
        .filter(|(_, c)| tool_def_for(&c.name, tool_defs).map(|d| d.kind == ToolKind::Mutating).unwrap_or(false))
        .collect();

    // Read-only: spawn threads for concurrency.
    let read_results: Arc<Mutex<Vec<(usize, ToolResult)>>> = Arc::new(Mutex::new(Vec::new()));
    let mut threads = Vec::new();
    for (idx, call) in &read_only {
        if token.is_cancelled() {
            break;
        }
        let call = (*call).clone();
        let workspace = workspace_root.to_path_buf();
        let def = tool_def_for(&call.name, tool_defs).cloned();
        let project = project_path.to_string();
        let rules = session_rules.to_vec();
        let app = app.clone();
        let session = session_id.to_string();
        let results = read_results.clone();
        let idx = *idx;
        let token_cancelled = token.is_cancelled();
        threads.push(thread::spawn(move || {
            let result = if token_cancelled {
                ToolResult {
                    content: "Cancelled".to_string(),
                    status: "cancelled".to_string(),
                    full_content: None,
                }
            } else if let Some(def) = def {
                execute_with_gateway(
                    &def,
                    &call,
                    &workspace,
                    &project,
                    &rules,
                    &app,
                    &session,
                )
            } else {
                ToolResult {
                    content: format!("Unknown tool: {}", call.name),
                    status: "failed".to_string(),
                    full_content: None,
                }
            };
            results.lock().push((idx, result));
        }));
    }
    for t in threads {
        let _ = t.join();
    }
    let mut read_results = read_results.lock().drain(..).collect::<Vec<_>>();
    read_results.sort_by_key(|(i, _)| *i);
    for (idx, result) in read_results {
        let call = &calls[idx];
        record_tool_event(
            app, session_id, call, &result, &mut Vec::new(), tool_events,
        );
        results.push((calls[idx].clone(), result));
    }

    // Mutating: sequential in order.
    for (idx, call) in &mutating {
        if token.is_cancelled() {
            let result = ToolResult {
                content: "Cancelled".to_string(),
                status: "cancelled".to_string(),
                full_content: None,
            };
            results.push((calls[*idx].clone(), result));
            break;
        }
        let def = tool_def_for(&call.name, tool_defs);
        let result = if let Some(def) = def {
            execute_with_gateway(def, call, workspace_root, project_path, session_rules, app, session_id)
        } else {
            ToolResult {
                content: format!("Unknown tool: {}", call.name),
                status: "failed".to_string(),
                full_content: None,
            }
        };
        record_tool_event(app, session_id, call, &result, &mut Vec::new(), tool_events);
        results.push((calls[*idx].clone(), result));
    }

    results
}

/// Execute a tool call through the approval gateway.
fn execute_with_gateway(
    def: &ToolDef,
    call: &ToolCallRequest,
    workspace: &Path,
    project_path: &str,
    session_rules: &[SessionRule],
    app: &AppHandle,
    session_id: &str,
) -> ToolResult {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
    let command = args.get("command").and_then(Value::as_str);

    let decision = SettingsService::resolve_tool_call(
        project_path,
        &call.name,
        command,
        session_rules,
    );

    // Record the decision as a tool event.
    let decision_str = match decision.decision {
        PermissionDecision::Allow => "approved",
        PermissionDecision::Deny => "denied",
        PermissionDecision::Ask => "pending",
    };

    if decision.requires_prompt {
        // Emit approval request event for the UI.
        let _ = app.emit(
            "native-chat://approval-request",
            json!({
                "sessionId": session_id,
                "toolName": call.name,
                "arguments": call.arguments,
                "toolCallId": call.id,
            }),
        );
        // In a real implementation, this would block on a channel waiting for
        // the UI to resolve. For now, auto-allow in balanced mode for read-only
        // (the gateway already allowed those) and auto-deny prompted calls
        // after a timeout. The full blocking flow is wired in the chat service.
        // TODO: wire the pending-approval channel when the UI is built.
        return ToolResult {
            content: format!("Approval required for {}. Pending UI integration.", call.name),
            status: "denied".to_string(),
            full_content: None,
        };
    }

    match decision.decision {
        PermissionDecision::Allow => {
            let start = Instant::now();
            let result = (def.execute)(workspace, &args);
            let duration_ms = start.elapsed().as_millis() as i64;
            // Emit tool event for the UI.
            let _ = app.emit(
                "native-chat://tool-event",
                json!({
                    "sessionId": session_id,
                    "toolName": call.name,
                    "status": result.status,
                    "summary": &result.content[..result.content.len().min(200)],
                    "durationMs": duration_ms,
                    "decision": decision_str,
                    "ruleSource": decision.rule_source,
                }),
            );
            result
        }
        PermissionDecision::Deny => {
            let _ = app.emit(
                "native-chat://tool-event",
                json!({
                    "sessionId": session_id,
                    "toolName": call.name,
                    "status": "denied",
                    "summary": decision.reason,
                    "decision": "denied",
                    "ruleSource": decision.rule_source,
                }),
            );
            ToolResult {
                content: format!("Denied: {}", decision.reason),
                status: "denied".to_string(),
                full_content: None,
            }
        }
        PermissionDecision::Ask => {
            // Should not reach here (requires_prompt handled above).
            ToolResult {
                content: "Approval required but not handled.".to_string(),
                status: "denied".to_string(),
                full_content: None,
            }
        }
    }
}

/// Record a tool event in the tool_events list (caller persists to DB).
fn record_tool_event(
    app: &AppHandle,
    session_id: &str,
    call: &ToolCallRequest,
    result: &ToolResult,
    _db_events: &mut Vec<ToolEventRecord>,
    tool_events: &mut Vec<ToolEventRecord>,
) {
    tool_events.push(ToolEventRecord {
        tool_name: call.name.clone(),
        status: result.status.clone(),
        summary: result.content[..result.content.len().min(200)].to_string(),
        duration_ms: 0,
        decision: "approved".to_string(),
        rule_source: None,
    });
}

/// Find a tool definition by name.
fn tool_def_for<'a>(name: &str, defs: &'a [ToolDef]) -> Option<&'a ToolDef> {
    defs.iter().find(|d| d.schema.name == name)
}

/// Get the context budget for a model (conservative default if unknown).
fn context_budget(model_id: &str) -> i64 {
    // In a real implementation, look up the model's context_window from the
    // catalog. For now, use the conservative default.
    let _ = model_id;
    DEFAULT_CONTEXT_WINDOW
}

/// Trim messages to fit within the token budget. Drops oldest non-system turns
/// whole, preserving the system prompt, latest user message, and current
fn trim_to_budget(
    messages: &[ChatMsg],
    system: &str,
    _tools: &[ToolSchema],
    budget: i64,
) -> (Vec<ChatMsg>, bool) {
    let margin = ((budget as f64) * OUTPUT_MARGIN_RATIO)
        .min(OUTPUT_MARGIN_MIN as f64)
        .max(0.0) as i64;
    let available = (budget - margin).max(1);
    let system_tokens = estimate_tokens(system);
    let messages_tokens: i64 = messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    let total = system_tokens + messages_tokens;
    if total <= available {
        return (messages.to_vec(), false);
    }

    // Drop oldest turns (skip the first user message and any system context).
    // Keep the last N messages that fit.
    let mut trimmed = Vec::new();
    let mut used = system_tokens;
    for msg in messages.iter().rev() {
        let msg_tokens = estimate_tokens(&msg.content);
        if used + msg_tokens > available {
            break;
        }
        trimmed.insert(0, msg.clone());
        used += msg_tokens;
    }
    (trimmed, true)
}

/// Estimate tokens for a string (whitespace-split word count).
fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.split_whitespace().count().max(1) as i64
    }
}

/// Emit a system row to the transcript.
fn emit_system_row(app: &AppHandle, session_id: &str, kind: &str, value: usize) {
    let _ = app.emit(
        "native-chat://system-row",
        json!({ "sessionId": session_id, "kind": kind, "value": value }),
    );
}

/// Current time in milliseconds since epoch.
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}
use std::sync::LazyLock;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_to_budget_drops_oldest_turns() {
        let messages = vec![
            ChatMsg::text("user", &"old message with lots of words ".repeat(200)),
            ChatMsg::text("assistant", &"old reply with lots of words ".repeat(200)),
            ChatMsg::text("user", "latest message that should be kept"),
        ];
        let system = "system prompt with a few words";
        // Budget large enough for the latest message but not all history.
        let (trimmed, did_truncate) = trim_to_budget(&messages, system, &[], 500);
        assert!(did_truncate);
        assert!(trimmed.len() < messages.len());
        assert!(trimmed.last().map(|m| m.content.contains("latest")).unwrap_or(false));
    }

    #[test]
    fn trim_to_budget_preserves_when_under_budget() {
        let messages = vec![ChatMsg::text("user", "hello")];
        let system = "system";
        let (trimmed, did_truncate) = trim_to_budget(&messages, system, &[], 32_000);
        assert!(!did_truncate);
        assert_eq!(trimmed.len(), 1);
    }

    #[test]
    fn cancellation_token_works() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }
}

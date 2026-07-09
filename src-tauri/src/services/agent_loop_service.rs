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
use std::time::Instant;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::models::permission::{PermissionDecision, SessionRule};
use crate::services::provider_client::{
    resolve_client_for_model, ChatMsg, ProviderRequest, ToolCallRequest,
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

/// Tracks active runs so cancellation can find them. Keyed by session id.
static ACTIVE_RUNS: LazyLock<Mutex<std::collections::HashMap<String, Arc<RunHandle>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// A pending approval request waiting for UI resolution. The agent loop
/// blocks on `rx` until the UI calls `resolve_approval` with a decision.
#[allow(dead_code)]
struct PendingApproval {
    tool_name: String,
    command: Option<String>,
    arguments: String,
    tx: std::sync::mpsc::Sender<ApprovalResolution>,
}

/// The UI's resolution of a pending approval request.
#[derive(Debug, Clone)]
pub struct ApprovalResolution {
    pub decision: PermissionDecision,
    /// When the user picks "allow for session", a session rule is added so
    /// subsequent matching calls skip the prompt.
    pub session_rule: Option<SessionRule>,
}

/// Global registry of pending approvals keyed by tool call id. The agent loop
/// inserts here and blocks on the channel; the UI's `resolve_approval` command
/// removes and resolves.
static PENDING_APPROVALS: LazyLock<Mutex<std::collections::HashMap<String, PendingApproval>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// `native_interaction_resolve` command removes and resolves.
pub(crate) static PENDING_INTERACTIONS: LazyLock<Mutex<std::collections::HashMap<String, std::sync::mpsc::Sender<InteractionResolution>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// The UI's resolution of a pending ask_user interaction.
#[derive(Debug, Clone)]
pub struct InteractionResolution {
    /// The answers the user provided, keyed by question id.
    pub answers: Vec<crate::models::interaction::QuestionAnswer>,
    /// Whether the interaction was cancelled.
    pub cancelled: bool,
}

/// Resolve a pending interaction from the UI. Called by the
/// `native_interaction_resolve` command. Returns an error if no pending
/// interaction exists for the given id.
pub fn resolve_interaction(
    interaction_id: &str,
    answers: Vec<crate::models::interaction::QuestionAnswer>,
) -> Result<(), String> {
    let tx = {
        let mut pending = PENDING_INTERACTIONS.lock();
        pending.remove(interaction_id)
    };
    let Some(tx) = tx else {
        return Err(format!("No pending interaction for id: {interaction_id}"));
    };
    let _ = tx.send(InteractionResolution { answers, cancelled: false });
    Ok(())
}

/// Cancel a pending interaction from the UI. Called by the
/// `native_interaction_cancel` command.
pub fn cancel_interaction(interaction_id: &str) -> Result<(), String> {
    let tx = {
        let mut pending = PENDING_INTERACTIONS.lock();
        pending.remove(interaction_id)
    };
    if let Some(tx) = tx {
        let _ = tx.send(InteractionResolution { answers: vec![], cancelled: true });
    }
    Ok(())
}

 /// Register a pending approval and block until the UI resolves it (or timeout).
/// Register a pending approval and block until the UI resolves it (or timeout).
/// Returns the resolution, or a timeout denial if no response within 10 minutes.
fn await_approval(
    call: &ToolCallRequest,
    args: &Value,
    app: &AppHandle,
    session_id: &str,
) -> ApprovalResolution {
    let (tx, rx) = std::sync::mpsc::channel::<ApprovalResolution>();
    let command = args.get("command").and_then(Value::as_str).map(str::to_string);
    {
        let mut pending = PENDING_APPROVALS.lock();
        pending.insert(
            call.id.clone(),
            PendingApproval {
                tool_name: call.name.clone(),
                command: command.clone(),
                arguments: call.arguments.clone(),
                tx,
            },
        );
    }
    // Emit a tool-event with status "pending" so the UI shows which tool
    // is waiting for approval in the running-tools indicator.
    let _ = app.emit(
        "native-chat://tool-event",
        json!({
            "sessionId": session_id,
            "toolCallId": call.id,
            "toolName": call.name,
            "status": "pending",
            "summary": format!("{} — approval required", call.name),
            "arguments": call.arguments,
            "decision": "pending",
            "ruleSource": "gateway",
        }),
    );
    let _ = app.emit(
        "native-chat://approval-request",
        json!({
            "sessionId": session_id,
            "toolCallId": call.id,
            "toolName": call.name,
            "command": command,
            "arguments": call.arguments,
        }),
    );
    match rx.recv_timeout(std::time::Duration::from_secs(600)) {
        Ok(resolution) => resolution,
        Err(_) => {
            PENDING_APPROVALS.lock().remove(&call.id);
            ApprovalResolution {
                decision: PermissionDecision::Deny,
                session_rule: None,
            }
        }
    }
}

/// Resolve a pending approval by tool call id. Called by the UI's approve/deny
/// command. Returns true if a pending approval was found and resolved.
pub fn resolve_approval(tool_call_id: &str, resolution: ApprovalResolution) -> bool {
    let pending = PENDING_APPROVALS.lock().remove(tool_call_id);
    match pending {
        Some(p) => {
            let _ = p.tx.send(resolution);
            true
        }
        None => false,
    }
}

/// Cancel all pending approvals for a session (e.g. on run cancel).
pub fn cancel_pending_approvals(_session_id: &str) {
    let mut pending = PENDING_APPROVALS.lock();
    pending.clear();
}
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
    /// Final reasoning/thinking content from the last assistant turn, if any.
    /// Stored separately so it is never replayed to providers nor folded into
    /// the persisted assistant message content.
    pub reasoning: Option<String>,
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
    /// The raw arguments JSON the model passed to the tool.
    pub arguments: Option<String>,
    pub duration_ms: i64,
    pub decision: String,
    pub rule_source: Option<String>,
    /// Unified line diff for file tools, if any.
    pub diff: Option<String>,
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
    let mut session_rules: Vec<SessionRule> = Vec::new();
    let mut tool_events: Vec<ToolEventRecord> = Vec::new();
    let mut truncated = false;
    let mut iteration = 0;

    loop {
        iteration += 1;
        if token.is_cancelled() {
            return RunResult {
                content: String::new(),
                reasoning: None,
                completed: false,
                cancelled: true,
                hit_cap: false,
                truncated,
                tool_events,
            };
        }
        if iteration > MAX_ITERATIONS {
            return RunResult {
                content: String::new(),
                reasoning: None,
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

        let (api_kind, model_base_url) = crate::services::native_chat_service::NativeChatService::resolve_model_routing(provider_id, model_id);
        let client = resolve_client_for_model(provider_id, &api_kind, base_url.as_deref(), &model_base_url);
        let session_id_for_emit = session_id.to_string();
        let app_for_emit = app.clone();
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                "native-chat://chunk",
                json!({ "sessionId": session_id_for_emit, "delta": delta, "channel": channel }),
            );
        };

        // Signal the UI that the model is thinking (streaming will follow).
        // On iterations > 1 this also clears the previous iteration's text
        // so the UI shows a fresh streaming block for the new turn.
        emit(if iteration > 1 { "next" } else { "thinking" }, "status");

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
                return RunResult {
                    content: format!("Error: {e}"),
                    reasoning: None,
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
                reasoning: response.reasoning,
                completed: true,
                cancelled: false,
                hit_cap: false,
                truncated,
                tool_events,
            };
        }

        // Signal the UI that tool execution is starting (clears streaming text).
        emit("tools", "status");

        // Process tool calls.
        let tool_results = process_tool_calls(
            &response.tool_calls,
            &tool_defs,
            &workspace_root,
            project_path,
            &mut session_rules,
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
    session_rules: &mut Vec<SessionRule>,
    token: &CancellationToken,
    app: &AppHandle,
    session_id: &str,
    tool_events: &mut Vec<ToolEventRecord>,
) -> Vec<(ToolCallRequest, ToolResult)> {
    let mut results: Vec<(ToolCallRequest, ToolResult)> = Vec::with_capacity(calls.len());

    // Intercept propose_ideas calls: capture structured ideas to the catalog
    // (ideas table) as concept ideas, optionally category-tagged. This tool is
    // never executed by the generic executor — it's a structured-data channel
    // for generate-ideas runs. One tool event per capture so cards stream in.
    for (idx, call) in calls.iter().enumerate() {
        if call.name == "propose_ideas" {
            let result = execute_propose_ideas(session_id, call);
            record_tool_event(app, session_id, call, &result, tool_events);
            results.push((calls[idx].clone(), result));
        }
    }
    // Intercept ask_user calls: persist the interaction, emit an event so
    // the frontend renders question cards, park the iteration until the user
    // responds or the run is cancelled. Never reaches the generic executor.
    for (idx, call) in calls.iter().enumerate() {
        if call.name == "ask_user" {
            let result = execute_ask_user(app, session_id, call);
            record_tool_event(app, session_id, call, &result, tool_events);
            results.push((calls[idx].clone(), result));
        }
    }
    // Filter out intercepted calls so they aren't double-processed.
    let remaining: Vec<(usize, &ToolCallRequest)> = calls
        .iter()
        .enumerate()
        .filter(|(_, c)| c.name != "propose_ideas" && c.name != "ask_user")
        .collect();

    let read_only: Vec<(usize, &ToolCallRequest)> = remaining
        .iter()
        .filter(|(_, c)| tool_def_for(&c.name, tool_defs).map(|d| d.kind == ToolKind::ReadOnly).unwrap_or(false))
        .cloned()
        .collect();
    let mutating: Vec<(usize, &ToolCallRequest)> = remaining
        .iter()
        .filter(|(_, c)| tool_def_for(&c.name, tool_defs).map(|d| d.kind == ToolKind::Mutating).unwrap_or(false))
        .cloned()
        .collect();
    // Read-only: spawn threads for concurrency. Each thread gets its own
    // mutable clone of session rules (read-only calls won't prompt in balanced
    // mode, but the gateway still consults the rules for matching).
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
        let rules = session_rules.clone();
        let app = app.clone();
        let session = session_id.to_string();
        let results = read_results.clone();
        let idx = *idx;
        let token_cancelled = token.is_cancelled();
        threads.push(thread::spawn(move || {
            let mut rules = rules;
            let result = if token_cancelled {
                ToolResult {
                    content: "Cancelled".to_string(),
                    status: "cancelled".to_string(),
                    full_content: None,
                    diff: None,
                }
            } else if let Some(def) = def {
                execute_with_gateway(
                    &def,
                    &call,
                    &workspace,
                    &project,
                    &mut rules,
                    &app,
                    &session,
                )
            } else {
                ToolResult {
                    content: format!("Unknown tool: {}", call.name),
                    status: "failed".to_string(),
                    full_content: None,
                    diff: None,
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
        record_tool_event(app, session_id, call, &result, tool_events);
        results.push((calls[idx].clone(), result));
    }

    // Mutating: sequential in order, sharing the session rules so "allow for
    // session" additions apply to subsequent calls in the same batch.
    for (idx, call) in &mutating {
        if token.is_cancelled() {
            let result = ToolResult {
                content: "Cancelled".to_string(),
                status: "cancelled".to_string(),
                full_content: None,
                diff: None,
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
                diff: None,
            }
        };
        record_tool_event(app, session_id, call, &result, tool_events);
        results.push((calls[*idx].clone(), result));
    }

    results
}
/// Intercept the propose_ideas tool: parse arguments and capture each idea to
/// the ideas catalog as a concept idea (optionally category-tagged). Returns a
/// success result with the count. One idea per call so the UI can render cards
/// incrementally as the agent streams them.
fn execute_propose_ideas(session_id: &str, call: &ToolCallRequest) -> ToolResult {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
    let ideas = args.get("ideas").and_then(Value::as_array);
    let Some(ideas) = ideas else {
        return ToolResult::failure("propose_ideas requires an 'ideas' array.".to_string());
    };
    let category_id: Option<String> = args
        .get("categoryId")
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let mut captured = 0usize;
    let mut rejected = 0usize;
    for idea in ideas {
        let title = idea.get("title").and_then(Value::as_str).unwrap_or("");
        if title.trim().is_empty() {
            continue;
        }
        let description = idea
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let grounding = idea
            .get("grounding")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if grounding.is_empty() {
            // Grounding is required: an idea with no concrete evidence is
            // rejected, no row created.
            rejected += 1;
            continue;
        }
        let anchor = idea
            .get("anchor")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let result = crate::services::session_service::SessionService::create_idea(
            session_id,
            title,
            &description,
            category_id.as_deref(),
            &grounding,
            anchor.as_deref(),
        );
        if result.is_ok() {
            captured += 1;
        }
    }
    if rejected > 0 {
        ToolResult::success(format!("Captured {captured} idea(s); rejected {rejected} without grounding."))
    } else {
        ToolResult::success(format!("Captured {captured} idea(s)."))
    }
}

/// Intercept the ask_user tool: parse questions, persist a pending
/// interaction, emit `native-chat://interactive-request` so the frontend
/// renders question cards, then park the iteration on a channel until the
/// user resolves or cancels. On resolve, returns the answers as a JSON
/// string the model can consume. On cancel/timeout, returns a notice.
fn execute_ask_user(app: &AppHandle, session_id: &str, call: &ToolCallRequest) -> ToolResult {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
    let Some(questions) = args.get("questions").and_then(Value::as_array) else {
        return ToolResult::failure("ask_user requires a 'questions' array.".to_string());
    };
    if questions.is_empty() {
        return ToolResult::failure("ask_user requires at least one question.".to_string());
    }
    // Parse questions into the interaction model.
    let mut parsed: Vec<crate::models::interaction::Question> = Vec::with_capacity(questions.len());
    for q in questions {
        let id = q.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let prompt = q.get("prompt").and_then(Value::as_str).unwrap_or("").to_string();
        let kind_str = q.get("kind").and_then(Value::as_str).unwrap_or("text");
        let kind = crate::models::interaction::QuestionKind::from_str(kind_str);
        let options: Vec<crate::models::interaction::QuestionOption> = q
            .get("options")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|o| {
                        let label = o.get("label").and_then(Value::as_str).unwrap_or("").to_string();
                        if label.is_empty() { return None; }
                        let description = o.get("description").and_then(Value::as_str).map(str::to_string);
                        Some(crate::models::interaction::QuestionOption { label, description })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let recommended = q.get("recommended").and_then(Value::as_i64).map(|i| i as usize);
        let allow_free_text = q.get("allowFreeText").and_then(Value::as_bool).unwrap_or(false);
        parsed.push(crate::models::interaction::Question {
            id,
            prompt,
            kind,
            options,
            recommended,
            allow_free_text,
        });
    }
    // Persist the pending interaction.
    let interaction = match crate::services::interaction_service::InteractionService::create(
        session_id,
        Some(&call.id),
        &parsed,
    ) {
        Ok(i) => i,
        Err(e) => return ToolResult::failure(format!("Failed to create interaction: {e}")),
    };
    let _ = app.emit(
        "native-chat://interactive-request",
        json!({
            "sessionId": session_id,
            "interactionId": interaction.id,
            "toolCallId": call.id,
        }),
    );
    // Park the iteration on a channel until the UI resolves or cancels.
    let (tx, rx) = std::sync::mpsc::channel::<InteractionResolution>();
    {
        let mut pending = PENDING_INTERACTIONS.lock();
        pending.insert(interaction.id.clone(), tx);
    }
    match rx.recv_timeout(std::time::Duration::from_secs(600)) {
        Ok(resolution) => {
            if resolution.cancelled {
                ToolResult::success("User cancelled the interaction.".to_string())
            } else {
                // Serialize answers as a JSON string the model can consume.
                let answers_json = serde_json::to_string(&resolution.answers).unwrap_or_else(|_| "[]".to_string());
                ToolResult::success(answers_json)
            }
        }
        Err(_) => {
            // Timeout: clean up and return a notice.
            let _ = crate::services::interaction_service::InteractionService::cancel(&interaction.id);
            ToolResult::failure("ask_user timed out waiting for user response (600s).".to_string())
        }
    }
}
/// Execute a tool call through the approval gateway. When the gateway requires
/// a prompt, blocks on `await_approval` until the UI resolves it. Tool events
/// are emitted live and persisted to `native_tool_events` via the caller.
fn execute_with_gateway(
    def: &ToolDef,
    call: &ToolCallRequest,
    workspace: &Path,
    project_path: &str,
    session_rules: &mut Vec<SessionRule>,
    app: &AppHandle,
    session_id: &str,
) -> ToolResult {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
    let command = args.get("command").and_then(Value::as_str);

    let mut decision = SettingsService::resolve_tool_call(
        project_path,
        &call.name,
        command,
        session_rules,
    );

    // If the gateway requires a prompt, block on the UI's approval decision.
    if decision.requires_prompt {
        let resolution = await_approval(call, &args, app, session_id);
        decision.decision = resolution.decision;
        decision.reason = match resolution.decision {
            PermissionDecision::Allow => "Approved by user.".to_string(),
            PermissionDecision::Deny => "Denied by user.".to_string(),
            PermissionDecision::Ask => "Approval required.".to_string(),
        };
        // Apply "allow for session" rules so subsequent matching calls skip.
        if let Some(rule) = resolution.session_rule {
            session_rules.push(rule);
        }
    }

    let decision_str = match decision.decision {
        PermissionDecision::Allow => "approved",
        PermissionDecision::Deny => "denied",
        PermissionDecision::Ask => "pending",
    };

    match decision.decision {
        PermissionDecision::Allow => {
            let start = Instant::now();
            let result = (def.execute)(workspace, &args);
            let duration_ms = start.elapsed().as_millis() as i64;
            let summary = &result.content[..result.content.len().min(200)];
            let _ = app.emit(
                "native-chat://tool-event",
                json!({
                    "sessionId": session_id,
                    "toolCallId": call.id,
                    "toolName": call.name,
                    "status": result.status,
                    "summary": summary,
                    "arguments": call.arguments,
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
                    "toolCallId": call.id,
                    "toolName": call.name,
                    "status": "denied",
                    "summary": decision.reason,
                    "arguments": call.arguments,
                    "decision": "denied",
                    "ruleSource": decision.rule_source,
                }),
            );
            ToolResult {
                content: format!("Denied: {}", decision.reason),
                status: "denied".to_string(),
                full_content: None,
                diff: None,
            }
        }
        PermissionDecision::Ask => {
            // Should not reach here (requires_prompt handled above).
            ToolResult {
                content: "Approval required but not handled.".to_string(),
                status: "denied".to_string(),
                full_content: None,
                diff: None,
            }
        }
    }
}

/// Record a tool event in the tool_events list (caller persists to DB).
fn record_tool_event(
    _app: &AppHandle,
    _session_id: &str,
    call: &ToolCallRequest,
    result: &ToolResult,
    tool_events: &mut Vec<ToolEventRecord>,
) {
    tool_events.push(ToolEventRecord {
        tool_name: call.name.clone(),
        status: result.status.clone(),
        summary: result.content[..result.content.len().min(200)].to_string(),
        arguments: Some(call.arguments.clone()),
        duration_ms: 0,
        decision: "approved".to_string(),
        rule_source: None,
        diff: result.diff.clone(),
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

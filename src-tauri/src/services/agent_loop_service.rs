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
    resolve_client_for_model, ChatMsg, ProviderRequest, ToolCallRequest, ToolSchema,
};
use crate::services::settings_service::SettingsService;
use crate::services::tool_runtime_service::{
    redact_tool_arguments, registry, ToolDef, ToolKind, ToolResult,
};

/// Maximum loop iterations before stopping.
const MAX_ITERATIONS: usize = 25;
/// Retries on empty provider responses before giving up. Local models
/// (LM Studio, Ollama) intermittently return empty streams — a nudge retry
/// recovers most cases without surfacing a confusing error.
const MAX_EMPTY_RETRIES: usize = 2;
/// Conservative default context window when the catalog doesn't report one.
const DEFAULT_CONTEXT_WINDOW: i64 = 32_000;
/// Output margin reserved for the model's response.
const OUTPUT_MARGIN_MIN: i64 = 8_000;
const OUTPUT_MARGIN_RATIO: f64 = 0.2;

/// Tracks active runs so cancellation can find them. Keyed by session id.
static ACTIVE_RUNS: LazyLock<Mutex<std::collections::HashMap<String, Arc<RunHandle>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// Steering messages queued by the user while a run is in flight, keyed by
/// session id. The loop drains these between iterations so a user can
/// redirect the agent without cancelling and restarting the turn.
///
/// Lock order invariant: when both registries are held, `ACTIVE_RUNS` is
/// always acquired first and `PENDING_STEERS` second, never the reverse.
/// `push_steer` and `finish_or_steer` both take the pair in that order, which
/// is what makes the queue-versus-finish handoff atomic without deadlocking.
static PENDING_STEERS: LazyLock<Mutex<std::collections::HashMap<String, Vec<String>>>> =
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
pub(crate) static PENDING_INTERACTIONS: LazyLock<
    Mutex<std::collections::HashMap<String, std::sync::mpsc::Sender<InteractionResolution>>>,
> = LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

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
    let _ = tx.send(InteractionResolution {
        answers,
        cancelled: false,
    });
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
        let _ = tx.send(InteractionResolution {
            answers: vec![],
            cancelled: true,
        });
    }
    Ok(())
}

fn await_interaction(
    interaction_id: &str,
    receiver: &std::sync::mpsc::Receiver<InteractionResolution>,
    timeout: std::time::Duration,
) -> Result<InteractionResolution, std::sync::mpsc::RecvTimeoutError> {
    let result = receiver.recv_timeout(timeout);
    if result.is_err() {
        PENDING_INTERACTIONS.lock().remove(interaction_id);
    }
    result
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
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string);
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
    /// that hit the iteration cap). Kept for compatibility; persistence should
    /// use `segments`, which covers every iteration including the final one.
    pub content: String,
    /// Final reasoning/thinking content from the last assistant turn, if any.
    /// Stored separately so it is never replayed to providers nor folded into
    /// the persisted assistant message content.
    pub reasoning: Option<String>,
    /// Per-iteration assistant output, in chronological order. One entry per
    /// provider response that produced content or reasoning, so the caller can
    /// persist a transcript that interleaves text and tool calls. Preserved on
    /// cancellation and iteration-cap exits.
    pub segments: Vec<TurnSegment>,
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

/// One provider iteration's assistant output within a run. Persisted as its
/// own assistant message so intermediate text between tool batches survives.
#[derive(Debug, Clone)]
pub struct TurnSegment {
    /// Assistant text content from this iteration.
    pub content: String,
    /// Reasoning/thinking content from this iteration, if any.
    pub reasoning: Option<String>,
    /// 1-based loop iteration this segment came from.
    pub iteration: usize,
    /// Pre-created assistant row checkpointed while this iteration streams.
    pub message_id: Option<String>,
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
    /// 1-based loop iteration this event was executed in, so the caller can
    /// bind it to the assistant message that preceded it.
    pub iteration: usize,
    /// Stable provider tool-call id used to upsert live status transitions.
    pub tool_call_id: String,
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
/// `planning_session_id` redirects structured planning captures while keeping
/// chat events and cancellation scoped to `session_id`.
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
    planning_session_id: Option<&str>,
) -> RunResult {
    let handle = Arc::new(RunHandle {
        token: CancellationToken::new(),
    });
    // Register for cancellation.
    {
        let mut active = ACTIVE_RUNS.lock();
        active.insert(session_id.to_string(), handle.clone());
    }
    // The lifecycle authority owns chat/run/plan coherence.
    let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_running(session_id);

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
        planning_session_id,
        &handle.token,
    );

    // Unregister and mark idle. `finish_or_steer` may already have retired the
    // handle, so the removal tolerates a missing key. Any steer that raced in
    // after the loop's final drain is dropped here: `steer()` already
    // persisted it as a user row, so the next turn's history carries it and
    // nothing is lost from the conversation.
    {
        let mut active = ACTIVE_RUNS.lock();
        active.remove(session_id);
        let mut steers = PENDING_STEERS.lock();
        steers.remove(session_id);
    }
    let terminal = if result.cancelled {
        crate::services::plan_lifecycle_service::ChatTerminalState::Cancelled
    } else if result.completed || result.hit_cap {
        crate::services::plan_lifecycle_service::ChatTerminalState::Idle
    } else {
        crate::services::plan_lifecycle_service::ChatTerminalState::Failed
    };
    let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_terminal(
        &app, session_id, terminal,
    );

    result
}

/// Cancel a running agent loop for a session. Returns true if a run was found.
pub fn cancel_run(session_id: &str) -> bool {
    let active = ACTIVE_RUNS.lock();
    let found = if let Some(handle) = active.get(session_id) {
        handle.token.cancel();
        true
    } else {
        false
    };
    // A cancelled turn must not hand stale redirections to the next run.
    PENDING_STEERS.lock().remove(session_id);
    found
}

/// Whether an agent loop is currently running for this session. The steering
/// path uses this to choose between injecting into the live run and falling
/// back to a normal send.
pub fn is_running(session_id: &str) -> bool {
    ACTIVE_RUNS.lock().contains_key(session_id)
}

/// Queue a steering message for the run that owns `session_id`. Returns true
/// when an active run accepted it, false when nothing is running.
///
/// `ACTIVE_RUNS` is checked first and held across the enqueue, so a run that
/// is finishing concurrently cannot retire its handle in the gap between the
/// liveness check and the push. `finish_or_steer` takes the same two locks in
/// the same order, so exactly one of the two wins and the message is either
/// delivered or refused, never silently dropped.
pub fn push_steer(session_id: &str, content: &str) -> bool {
    let active = ACTIVE_RUNS.lock();
    if !active.contains_key(session_id) {
        return false;
    }
    let mut steers = PENDING_STEERS.lock();
    steers
        .entry(session_id.to_string())
        .or_default()
        .push(content.to_string());
    true
}

/// Take every steering message queued for this session, leaving the queue
/// empty. Called between loop iterations, where the run is still live either
/// way so no handoff decision is needed.
fn drain_steers(session_id: &str) -> Vec<String> {
    let mut steers = PENDING_STEERS.lock();
    steers.remove(session_id).unwrap_or_default()
}

/// Final drain before a run reports completion. Takes `ACTIVE_RUNS` then
/// `PENDING_STEERS` (the mandatory lock order) so "keep looping" versus
/// "finish" is decided atomically against `push_steer`. When nothing is
/// pending the run handle is retired here, so a steer arriving afterwards is
/// refused by `push_steer` and the caller re-sends it as a normal turn.
fn finish_or_steer(session_id: &str) -> Vec<String> {
    let mut active = ACTIVE_RUNS.lock();
    let mut steers = PENDING_STEERS.lock();
    let pending = steers.remove(session_id).unwrap_or_default();
    if pending.is_empty() {
        active.remove(session_id);
    }
    pending
}

/// Inject drained steering messages into the running conversation and emit a
/// transcript marker for them. A fresh human instruction earns a fresh
/// iteration budget: `MAX_ITERATIONS` still bounds each stretch, and every
/// reset requires a real human action, so this cannot loop unbounded. The
/// empty-response retry budget resets with it because the redirected request
/// is a new question, not a continuation of the stalled one.
fn apply_steers(
    steers: Vec<String>,
    messages: &mut Vec<ChatMsg>,
    iteration: &mut usize,
    empty_retries: &mut usize,
    app: &AppHandle,
    session_id: &str,
) {
    if steers.is_empty() {
        return;
    }
    let applied = steers.len();
    for steer in steers {
        messages.push(ChatMsg::text("user", steer));
    }
    *iteration = 0;
    *empty_retries = 0;
    emit_system_row(app, session_id, "steered", applied);
}

/// On startup, sweep any sessions left in 'running' state and mark them
/// 'interrupted' so the UI shows a recovery notice.
pub fn sweep_interrupted_runs() {
    let mut conn = match crate::services::storage_service::StorageService::connect() {
        Ok(c) => c,
        Err(_) => return,
    };
    let Ok(tx) = conn.transaction() else {
        return;
    };
    let _ = tx.execute(
        "UPDATE native_tool_events
         SET status = 'interrupted'
         WHERE status IN ('running', 'pending')
           AND session_id IN (
             SELECT id FROM native_chat_sessions WHERE run_state IN ('running','needs_input')
           )",
        [],
    );
    let _ = tx.execute(
        "UPDATE native_chat_sessions SET run_state = 'interrupted'
         WHERE run_state IN ('running','needs_input')",
        [],
    );
    let _ = tx.commit();
    let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::reconcile_stale_owners(
        None, None,
    );
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
    planning_session_id: Option<&str>,
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
    let mut segments: Vec<TurnSegment> = Vec::new();
    let mut truncated = false;
    let mut iteration = 0;
    let mut empty_retries = 0;

    loop {
        iteration += 1;
        if token.is_cancelled() {
            return RunResult {
                content: String::new(),
                reasoning: None,
                segments,
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
                segments,
                completed: false,
                cancelled: false,
                hit_cap: true,
                truncated,
                tool_events,
            };
        }

        // Context budget guard: trim old turns if over budget.
        let budget = context_budget(provider_id, model_id);
        let (trimmed_messages, did_truncate) = trim_to_budget(&messages, system, &tools, budget);
        if did_truncate {
            truncated = true;
            emit_system_row(app, session_id, "truncated", 0);
        }
        messages = trimmed_messages;

        // Create the assistant row before contacting the provider. Streaming
        // callbacks update this row, preserving partial text/reasoning if the
        // app exits before the provider turn completes.
        let draft_message =
            crate::services::native_chat_service::NativeChatService::insert_message(
                session_id,
                "assistant",
                "",
                None,
                Some(provider_id),
                Some(model_id),
                Some(effort_level),
            )
            .ok();
        let draft_message_id = draft_message.as_ref().map(|message| message.id.clone());
        let live_progress = Arc::new(Mutex::new((String::new(), String::new())));

        // Build the request.
        // Resolve the wire-format model id (e.g. "qwen/qwen3.6-27b") from the
        // cache; fall back to the catalog model_id when no override is stored.
        // Routing lookups above use the catalog id (the cache key), but the
        // wire request must send the provider-native model name.
        let wire_model_id =
            crate::services::native_chat_service::NativeChatService::resolve_model_api_id(
                provider_id,
                model_id,
            )
            .unwrap_or_else(|| model_id.to_string());
        let req = ProviderRequest {
            model_id: wire_model_id,
            effort_level: effort_level.to_string(),
            system: Some(system.to_string()),
            messages: messages.clone(),
            api_key: api_key.clone(),
            base_url: base_url.clone(),
            tools: tools.clone(),
        };

        let (api_kind, model_base_url) =
            crate::services::native_chat_service::NativeChatService::resolve_model_routing(
                provider_id,
                model_id,
            );
        let client =
            resolve_client_for_model(provider_id, &api_kind, base_url.as_deref(), &model_base_url);
        let session_id_for_emit = session_id.to_string();
        let app_for_emit = app.clone();
        let draft_id_for_emit = draft_message_id.clone();
        let progress_for_emit = live_progress.clone();
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                "native-chat://chunk",
                json!({ "sessionId": session_id_for_emit, "delta": delta, "channel": channel }),
            );
            if channel != "content" && channel != "reasoning" {
                return;
            }
            let Some(message_id) = draft_id_for_emit.as_deref() else {
                return;
            };
            let mut progress = progress_for_emit.lock();
            if channel == "reasoning" {
                progress.1.push_str(delta);
            } else {
                progress.0.push_str(delta);
            }
            let reasoning = (!progress.1.is_empty()).then_some(progress.1.as_str());
            let _ =
                crate::services::native_chat_service::NativeChatService::update_message_progress(
                    message_id,
                    &progress.0,
                    reasoning,
                );
        };

        // Signal the UI that the model is thinking (streaming will follow).
        // On iterations > 1 this also clears the previous iteration's text
        // so the UI shows a fresh streaming block for the new turn.
        emit(if iteration > 1 { "next" } else { "thinking" }, "status");

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
                // Local models (LM Studio, Ollama) intermittently return
                // empty streams — a transient failure that a nudge retry
                // recovers. Distinguish the typed EmptyResponse from real
                // transport/HTTP errors so we only retry the recoverable case.
                // The error arrives as a String (ProviderError → String), so
                // match on the formatted message.
                let is_empty = e.contains("returned an empty response");
                if is_empty && empty_retries < MAX_EMPTY_RETRIES {
                    empty_retries += 1;
                    // Delete the empty draft and nudge the model to respond.
                    if let Some(message_id) = draft_message_id.as_deref() {
                        let _ = crate::services::native_chat_service::NativeChatService::delete_message(message_id);
                    }
                    messages.push(ChatMsg::text(
                        "user",
                        "Please continue — provide a response or use a tool.",
                    ));
                    continue;
                }
                // Preserve any streamed checkpoint and append the terminal
                // error instead of replacing the partial response.
                let progress = live_progress.lock();
                let error = format!("Error: {e}");
                let content = if progress.0.trim().is_empty() {
                    error
                } else {
                    format!("{}\n\n{error}", progress.0)
                };
                let reasoning = (!progress.1.trim().is_empty()).then_some(progress.1.clone());
                if let Some(message_id) = draft_message_id.as_deref() {
                    let _ = crate::services::native_chat_service::NativeChatService::update_message_progress(
                        message_id,
                        &content,
                        reasoning.as_deref(),
                    );
                }
                segments.push(TurnSegment {
                    content: content.clone(),
                    reasoning: reasoning.clone(),
                    iteration,
                    message_id: draft_message_id,
                });
                return RunResult {
                    content,
                    reasoning,
                    segments,
                    completed: false,
                    cancelled: false,
                    hit_cap: false,
                    truncated,
                    tool_events,
                };
            }
        };

        if let Some(message_id) = draft_message_id.as_deref() {
            let _ =
                crate::services::native_chat_service::NativeChatService::update_message_progress(
                    message_id,
                    &response.content,
                    response.reasoning.as_deref(),
                );
        }

        // Record this iteration's assistant output as a segment so the caller
        // can persist one message per iteration. Iterations that produced only
        // tool calls (no text, no reasoning) get no segment.
        let has_reasoning = response
            .reasoning
            .as_deref()
            .map(|r| !r.trim().is_empty())
            .unwrap_or(false);
        if !response.content.trim().is_empty() || has_reasoning {
            segments.push(TurnSegment {
                content: response.content.clone(),
                reasoning: response.reasoning.clone(),
                iteration,
                message_id: draft_message_id.clone(),
            });
        } else if let Some(message_id) = draft_message_id.as_deref() {
            let _ =
                crate::services::native_chat_service::NativeChatService::delete_message(message_id);
        }
        // Append the assistant message to history.
        let mut assistant_msg = ChatMsg::text("assistant", response.content.clone());
        assistant_msg.tool_calls = response.tool_calls.clone();
        messages.push(assistant_msg);

        // If no tool calls, the loop is done — unless the model returned
        // nothing actionable (no content, no reasoning). Local models
        // sometimes "think" via reasoning_content but produce no final
        // answer, or return a truly empty turn. Nudge and retry instead of
        // ending silently with an empty response.
        if response.tool_calls.is_empty() {
            if response.content.trim().is_empty() && !has_reasoning {
                // Truly empty Ok response — treat like EmptyResponse.
                if empty_retries < MAX_EMPTY_RETRIES {
                    empty_retries += 1;
                    if let Some(message_id) = draft_message_id.as_deref() {
                        let _ = crate::services::native_chat_service::NativeChatService::delete_message(message_id);
                    }
                    messages.push(ChatMsg::text(
                        "user",
                        "Please continue — provide a response or use a tool.",
                    ));
                    continue;
                }
            }
            // Last chance for a steer to land. `finish_or_steer` retires the
            // run handle when nothing is pending, so a message racing in after
            // this point is refused by `push_steer` rather than queued against
            // a run that will never read it. The assistant message was already
            // pushed above, so an accepted steer lands after it in order.
            let steers = finish_or_steer(session_id);
            if !steers.is_empty() {
                apply_steers(
                    steers,
                    &mut messages,
                    &mut iteration,
                    &mut empty_retries,
                    app,
                    session_id,
                );
                continue;
            }
            return RunResult {
                content: response.content,
                reasoning: response.reasoning,
                segments,
                completed: true,
                cancelled: false,
                hit_cap: false,
                truncated,
                tool_events,
            };
        }

        // Signal the UI that tool execution is starting (clears streaming text).
        emit("tools", "status");

        // Process tool calls. The draft message id binds live tool status to
        // the assistant iteration that requested each tool.
        let tool_results = process_tool_calls(
            &response.tool_calls,
            &tool_defs,
            &workspace_root,
            project_path,
            &mut session_rules,
            token,
            app,
            session_id,
            planning_session_id,
            iteration,
            draft_message_id.as_deref(),
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

        // Fold in anything the user typed while the tools were running, so the
        // next provider request already carries the redirection.
        let steers = drain_steers(session_id);
        apply_steers(
            steers,
            &mut messages,
            &mut iteration,
            &mut empty_retries,
            app,
            session_id,
        );
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
    planning_session_id: Option<&str>,
    iteration: usize,
    message_id: Option<&str>,
    tool_events: &mut Vec<ToolEventRecord>,
) -> Vec<(ToolCallRequest, ToolResult)> {
    let mut results: Vec<(ToolCallRequest, ToolResult)> = Vec::with_capacity(calls.len());
    // Surface and checkpoint every tool before execution. This makes the
    // active tool name visible immediately and leaves a recoverable running
    // record if the process exits inside the tool.
    for call in calls {
        let summary = format!("Running {}", call.name.replace('_', " "));
        let _ = app.emit(
            "native-chat://tool-event",
            json!({
                "sessionId": session_id,
                "toolCallId": call.id,
                "toolName": call.name,
                "status": "running",
                "summary": summary,
            }),
        );
        let _ = crate::services::native_chat_service::NativeChatService::upsert_tool_event(
            &call.id, session_id, message_id, &call.name, "running", &summary, None, None, None,
            None,
        );
    }

    // Intercept propose_ideas calls: capture structured ideas to the catalog
    // (ideas table) as concept ideas, optionally category-tagged. This tool is
    // never executed by the generic executor — it's a structured-data channel
    // for generate-ideas runs. One tool event per capture so cards stream in.
    for (idx, call) in calls.iter().enumerate() {
        if call.name == "propose_ideas" {
            let result = execute_propose_ideas(planning_session_id.unwrap_or(session_id), call);
            record_tool_event(
                app,
                session_id,
                message_id,
                call,
                &result,
                iteration,
                tool_events,
            );
            results.push((calls[idx].clone(), result));
        }
    }
    // Intercept ask_user calls: persist the interaction, emit an event so
    // the frontend renders question cards, park the iteration until the user
    // responds or the run is cancelled. Never reaches the generic executor.
    for (idx, call) in calls.iter().enumerate() {
        if call.name == "ask_user" {
            let result = execute_ask_user(app, session_id, call);
            record_tool_event(
                app,
                session_id,
                message_id,
                call,
                &result,
                iteration,
                tool_events,
            );
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
        .filter(|(_, c)| {
            tool_def_for(&c.name, tool_defs)
                .map(|d| d.kind == ToolKind::ReadOnly)
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    let mutating: Vec<(usize, &ToolCallRequest)> = remaining
        .iter()
        .filter(|(_, c)| {
            tool_def_for(&c.name, tool_defs)
                .map(|d| d.kind == ToolKind::Mutating)
                .unwrap_or(false)
        })
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
                    decision: None,
                    rule_source: None,
                    sensitive: false,
                }
            } else if let Some(def) = def {
                execute_with_gateway(
                    &def, &call, &workspace, &project, &mut rules, &app, &session,
                )
            } else {
                ToolResult {
                    content: format!("Unknown tool: {}", call.name),
                    status: "failed".to_string(),
                    full_content: None,
                    diff: None,
                    decision: None,
                    rule_source: None,
                    sensitive: false,
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
            app,
            session_id,
            message_id,
            call,
            &result,
            iteration,
            tool_events,
        );
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
                decision: None,
                rule_source: None,
                sensitive: false,
            };
            results.push((calls[*idx].clone(), result));
            break;
        }
        let def = tool_def_for(&call.name, tool_defs);
        let result = if let Some(def) = def {
            execute_with_gateway(
                def,
                call,
                workspace_root,
                project_path,
                session_rules,
                app,
                session_id,
            )
        } else {
            ToolResult {
                content: format!("Unknown tool: {}", call.name),
                status: "failed".to_string(),
                full_content: None,
                diff: None,
                decision: None,
                rule_source: None,
                sensitive: false,
            }
        };
        record_tool_event(
            app,
            session_id,
            message_id,
            call,
            &result,
            iteration,
            tool_events,
        );
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
    let Some(ideas) = args.get("ideas").and_then(Value::as_array) else {
        return ToolResult::failure("propose_ideas requires an 'ideas' array.".to_string());
    };
    if ideas.is_empty() {
        return ToolResult::failure("propose_ideas requires at least one idea.".to_string());
    }
    let category_id = args
        .get("categoryId")
        .and_then(Value::as_str)
        .map(str::to_string);
    // Guided idea rounds pass a planning-session id, but a plain chat message
    // runs with the native-chat id, which is not a `sessions` row (the
    // ideas.session_id FK target). Resolve native-chat ids to the project's
    // planning session so "give me more ideas" typed in chat persists instead
    // of failing with an opaque FOREIGN KEY error.
    let capture_session_id = match resolve_idea_capture_session(session_id) {
        Ok(id) => id,
        Err(error) => return ToolResult::failure(error),
    };
    // Validate the category reference upfront: a stale or hallucinated id
    // otherwise fails at INSERT time with "FOREIGN KEY constraint failed",
    // which gives the model nothing to repair.
    if let Some(requested) = category_id.as_deref() {
        let project_path =
            crate::services::session_service::SessionService::get(&capture_session_id)
                .ok()
                .flatten()
                .map(|session| session.project_path)
                .unwrap_or_default();
        let categories =
            match crate::services::session_service::SessionService::list_categories_for_project(
                &project_path,
            ) {
                Ok(categories) => categories,
                Err(error) => return ToolResult::failure(error),
            };
        if !categories.iter().any(|category| category.id == requested) {
            let valid = categories
                .iter()
                .map(|category| format!("'{}' ({})", category.id, category.name))
                .collect::<Vec<_>>()
                .join(", ");
            return ToolResult::failure(if valid.is_empty() {
                format!(
                    "propose_ideas categoryId '{requested}' does not exist. This project has no categories yet; omit categoryId to capture uncategorized ideas."
                )
            } else {
                format!(
                    "propose_ideas categoryId '{requested}' does not exist. Valid ids: {valid}. Omit categoryId to capture uncategorized ideas."
                )
            });
        }
    }
    let batch_id = crate::services::idea_round_service::IdeaRoundService::active_round(session_id);

    struct ValidatedIdea {
        title: String,
        description: String,
        grounding: String,
        anchor: Option<String>,
        assessment: crate::models::planning_assessment::ImplementationAssessment,
    }

    // Validate the complete provider payload before writing any row. A weak
    // item fails the tool call with a repairable path instead of leaving a
    // partially-persisted batch.
    let mut validated = Vec::with_capacity(ideas.len());
    for (index, idea) in ideas.iter().enumerate() {
        let title = idea
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if title.is_empty() || title.chars().count() > 240 {
            return ToolResult::failure(format!(
                "propose_ideas ideas[{index}].title must contain 1-240 characters."
            ));
        }
        let description = idea
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if description.is_empty() || description.chars().count() > 20_000 {
            return ToolResult::failure(format!(
                "propose_ideas ideas[{index}].description must contain 1-20,000 characters."
            ));
        }
        let grounding = idea
            .get("grounding")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if grounding.is_empty() {
            return ToolResult::failure(format!(
                "propose_ideas ideas[{index}].grounding is required and must cite concrete evidence."
            ));
        }
        let assessment_value = idea.get("assessment").cloned().ok_or_else(|| {
            format!(
                "propose_ideas ideas[{index}].assessment is required; include schemaVersion, effort, 1-5 ratings, rationale, grounding, capabilities, constraints, missing evidence, and alternatives."
            )
        });
        let assessment_value = match assessment_value {
            Ok(value) => value,
            Err(message) => return ToolResult::failure(message),
        };
        let assessment: crate::models::planning_assessment::ImplementationAssessment =
            match serde_json::from_value(assessment_value) {
                Ok(value) => value,
                Err(error) => {
                    return ToolResult::failure(format!(
                        "propose_ideas ideas[{index}].assessment is malformed: {error}"
                    ));
                }
            };
        if let Err(error) = assessment.validate() {
            return ToolResult::failure(format!("propose_ideas ideas[{index}].{error}"));
        }
        let anchor = idea
            .get("anchor")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        validated.push(ValidatedIdea {
            title,
            description,
            grounding,
            anchor,
            assessment,
        });
    }

    let mut captured = 0usize;
    for idea in validated {
        match crate::services::session_service::SessionService::create_idea(
            &capture_session_id,
            &idea.title,
            &idea.description,
            category_id.as_deref(),
            &idea.grounding,
            idea.anchor.as_deref(),
            batch_id.as_deref(),
            Some(&idea.assessment),
        ) {
            Ok(_) => captured += 1,
            Err(error) => {
                return ToolResult::failure(format!(
                    "propose_ideas persistence failed after {captured} capture(s): {error}"
                ));
            }
        }
    }
    ToolResult::success(format!("Captured {captured} assessed idea(s)."))
}
/// Resolve the session that owns propose_ideas captures. Planning-session ids
/// pass through; native-chat ids map to the newest planning session of the
/// chat's project (created on demand) because `ideas.session_id` references
/// `sessions(id)`, not `native_chat_sessions(id)`.
fn resolve_idea_capture_session(session_id: &str) -> Result<String, String> {
    use crate::services::session_service::SessionService;
    if SessionService::get(session_id)?.is_some() {
        return Ok(session_id.to_string());
    }
    let chat = crate::services::native_chat_service::NativeChatService::get_session(session_id)?
        .ok_or_else(|| {
            format!("propose_ideas: session '{session_id}' does not exist in this workspace.")
        })?;
    if let Some(existing) = SessionService::list_sessions(&chat.project_path)?
        .into_iter()
        .next()
    {
        return Ok(existing.id);
    }
    SessionService::create_session(&chat.project_path, "Planning").map(|session| session.id)
}

/// Intercept the ask_user tool: parse questions, persist a pending
/// interaction, emit `native-chat://interactive-request` so the frontend
/// renders question cards, then park the iteration on a channel until the
/// user resolves or cancels. On resolve, returns the answers as a JSON
/// string the model can consume. On cancel/timeout, returns a notice.
fn execute_ask_user(app: &AppHandle, session_id: &str, call: &ToolCallRequest) -> ToolResult {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or(json!({}));
    let title = args.get("title").and_then(Value::as_str);
    let description = args.get("description").and_then(Value::as_str);
    let Some(questions) = args.get("questions").and_then(Value::as_array) else {
        return ToolResult::failure("ask_user requires a 'questions' array.".to_string());
    };
    if questions.is_empty() {
        return ToolResult::failure("ask_user requires at least one question.".to_string());
    }
    // Parse questions into the interaction model.
    let mut parsed: Vec<crate::models::interaction::Question> = Vec::with_capacity(questions.len());
    for q in questions {
        let id = q
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let prompt = q
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let kind_str = q.get("kind").and_then(Value::as_str).unwrap_or("text");
        let kind = crate::models::interaction::QuestionKind::from_str(kind_str);
        let options: Vec<crate::models::interaction::QuestionOption> = q
            .get("options")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|o| {
                        let label = o
                            .get("label")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        if label.is_empty() {
                            return None;
                        }
                        let description = o
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        Some(crate::models::interaction::QuestionOption { label, description })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let recommended = q
            .get("recommended")
            .and_then(Value::as_i64)
            .map(|i| i as usize);
        let allow_free_text = q
            .get("allowFreeText")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let detail = q.get("detail").and_then(Value::as_str).map(str::to_string);
        let page_id = q.get("pageId").and_then(Value::as_str).map(str::to_string);
        let page_title = q
            .get("pageTitle")
            .and_then(Value::as_str)
            .map(str::to_string);
        let page_description = q
            .get("pageDescription")
            .and_then(Value::as_str)
            .map(str::to_string);
        let required = q.get("required").and_then(Value::as_bool).unwrap_or(false);
        let multiline = q.get("multiline").and_then(Value::as_bool).unwrap_or(false);
        let scale = match q.get("scale") {
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(scale) => Some(scale),
                Err(error) => {
                    return ToolResult::failure(format!(
                        "Question {id} has invalid rating scale metadata: {error}"
                    ));
                }
            },
            None => None,
        };
        parsed.push(crate::models::interaction::Question {
            id,
            prompt,
            kind,
            options,
            recommended,
            allow_free_text,
            detail,
            page_id,
            page_title,
            page_description,
            required,
            multiline,
            scale,
        });
    }
    let interaction =
        match crate::services::interaction_service::InteractionService::create_with_metadata(
            session_id,
            Some(&call.id),
            title,
            description,
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
    if let Ok(Some(session)) =
        crate::services::native_chat_service::NativeChatService::get_session(session_id)
    {
        let _ = crate::services::notification_service::NotificationService::deliver(
            app,
            crate::models::notification::NotificationKind::PendingQuestion,
            &interaction.id,
            "interaction",
            &session.project_path,
            "Agent needs your input",
            Some("Open the chat to answer the pending question."),
        );
    }
    let _ =
        crate::services::plan_lifecycle_service::PlanLifecycleService::chat_needs_input(session_id);
    // Park the iteration on a channel until the UI resolves or cancels.
    let (tx, rx) = std::sync::mpsc::channel::<InteractionResolution>();
    {
        let mut pending = PENDING_INTERACTIONS.lock();
        pending.insert(interaction.id.clone(), tx);
    }
    let result = match await_interaction(&interaction.id, &rx, std::time::Duration::from_secs(600))
    {
        Ok(resolution) => {
            if resolution.cancelled {
                ToolResult::success("User cancelled the interaction.".to_string())
            } else {
                // Serialize answers as a JSON string the model can consume.
                let answers_json =
                    serde_json::to_string(&resolution.answers).unwrap_or_else(|_| "[]".to_string());
                ToolResult::success(answers_json)
            }
        }
        Err(_) => {
            // Timeout: clean up and return a notice.
            let _ =
                crate::services::interaction_service::InteractionService::cancel(&interaction.id);
            ToolResult::failure("ask_user timed out waiting for user response (600s).".to_string())
        }
    };
    let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_running(session_id);
    result
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

    let mut decision =
        SettingsService::resolve_tool_call(project_path, &call.name, command, session_rules);

    if call.name == "get_execution_advice" {
        let is_external_provider =
            crate::services::native_chat_service::NativeChatService::get_session(session_id)
                .ok()
                .flatten()
                .is_none_or(|session| session.provider_id != "basebuild-local");
        if is_external_provider {
            let external_context = SettingsService::get_permission_rules()
                .map(|rules| rules.allow_external_context)
                .unwrap_or(PermissionDecision::Ask);
            match external_context {
                PermissionDecision::Allow => {}
                PermissionDecision::Deny => {
                    decision.decision = PermissionDecision::Deny;
                    decision.requires_prompt = false;
                    decision.reason =
                        "External context delivery is disabled in Privacy settings.".to_string();
                    decision.rule_source = Some("privacy:external-context".to_string());
                }
                PermissionDecision::Ask => {
                    decision.decision = PermissionDecision::Ask;
                    decision.requires_prompt = true;
                    decision.reason = "Execution advice would be returned to the external model; explicit approval is required.".to_string();
                    decision.rule_source = Some("privacy:external-context".to_string());
                }
            }
        }
    }

    // If the gateway requires a prompt, block on the UI's approval decision.
    if decision.requires_prompt {
        let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_needs_input(
            session_id,
        );
        let resolution = await_approval(call, &args, app, session_id);
        decision.decision = resolution.decision;
        let _ =
            crate::services::plan_lifecycle_service::PlanLifecycleService::chat_running(session_id);
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

    let result = match decision.decision {
        PermissionDecision::Allow => {
            let start = Instant::now();
            let mut result = (def.execute)(workspace, &args);
            let duration_ms = start.elapsed().as_millis() as i64;
            result.decision = Some(decision_str.to_string());
            result.rule_source = decision.rule_source.clone();
            let summary = &result.content[..result.content.len().min(200)];
            let arguments = if result.sensitive {
                redact_tool_arguments(&call.arguments)
            } else {
                call.arguments.clone()
            };
            let _ = app.emit(
                "native-chat://tool-event",
                json!({
                    "sessionId": session_id,
                    "toolCallId": call.id,
                    "toolName": call.name,
                    "status": result.status,
                    "summary": summary,
                    "arguments": arguments,
                    "durationMs": duration_ms,
                    "decision": decision_str,
                    "ruleSource": decision.rule_source,
                    "diff": result.diff,
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
                decision: Some("denied".to_string()),
                rule_source: decision.rule_source.clone(),
                sensitive: false,
            }
        }
        PermissionDecision::Ask => ToolResult {
            content: "Approval required but not handled.".to_string(),
            status: "denied".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive: false,
        },
    };
    result
}

/// Record a tool event in the tool_events list (caller persists to DB).
fn record_tool_event(
    _app: &AppHandle,
    session_id: &str,
    message_id: Option<&str>,
    call: &ToolCallRequest,
    result: &ToolResult,
    iteration: usize,
    tool_events: &mut Vec<ToolEventRecord>,
) {
    let arguments = if result.sensitive {
        redact_tool_arguments(&call.arguments)
    } else {
        call.arguments.clone()
    };
    let summary = &result.content[..result.content.len().min(200)];
    let _ = crate::services::native_chat_service::NativeChatService::upsert_tool_event(
        &call.id,
        session_id,
        message_id,
        &call.name,
        &result.status,
        summary,
        Some(&arguments),
        result.diff.as_deref(),
        result.decision.as_deref(),
        result.rule_source.as_deref(),
    );
    tool_events.push(ToolEventRecord {
        tool_name: call.name.clone(),
        status: result.status.clone(),
        summary: summary.to_string(),
        arguments: Some(arguments),
        duration_ms: 0,
        decision: result
            .decision
            .clone()
            .unwrap_or_else(|| "approved".to_string()),
        rule_source: result.rule_source.clone(),
        diff: result.diff.clone(),
        iteration,
        tool_call_id: call.id.clone(),
    });
}

/// Find a tool definition by name.
fn tool_def_for<'a>(name: &str, defs: &'a [ToolDef]) -> Option<&'a ToolDef> {
    defs.iter().find(|d| d.schema.name == name)
}

/// Get the context budget for a model (conservative default if unknown).
fn context_budget(provider_id: &str, model_id: &str) -> i64 {
    // Look up the model's context_window from the DB cache. Local models
    // (LM Studio, Ollama) often have larger windows (128K+) than the
    // conservative 32K default; using the real value prevents unnecessary
    // trimming that could drop tool-call/tool-result pairs.
    if let Ok(conn) = crate::services::storage_service::StorageService::connect() {
        if let Ok(ctx) = conn.query_row::<i64, _, _>(
            "SELECT context_window FROM native_provider_model_cache
             WHERE provider_id = ?1 AND model_id = ?2",
            rusqlite::params![provider_id, model_id],
            |row| row.get(0),
        ) {
            if ctx > 0 {
                return ctx;
            }
        }
    }
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
    // Walk messages in reverse, keeping the last N that fit. But never
    // keep a `tool` result message without its preceding `assistant`
    // tool-call message — that produces an invalid OpenAI chat sequence
    // (tool result with no matching tool_call_id), which local servers
    // (LM Studio, Ollama) may reject or return empty for.
    let mut trimmed = Vec::new();
    let mut used = system_tokens;
    let mut skip_until_assistant_with_tools = false;
    for msg in messages.iter().rev() {
        let msg_tokens = estimate_tokens(&msg.content);
        if skip_until_assistant_with_tools {
            // We're holding a `tool` result whose matching assistant
            // tool-call hasn't been found yet. Keep scanning backward;
            // when we find the assistant message with tool_calls, we
            // include both. If we run out of budget first, drop both.
            if msg.role == "assistant" && !msg.tool_calls.is_empty() {
                skip_until_assistant_with_tools = false;
            } else {
                continue;
            }
        }
        if used + msg_tokens > available {
            // Budget exceeded. If this is a tool result, we must also
            // drop its matching assistant tool-call — set the flag.
            if msg.role == "tool" {
                skip_until_assistant_with_tools = true;
            }
            break;
        }
        if msg.role == "tool" {
            skip_until_assistant_with_tools = true;
        }
        trimmed.insert(0, msg.clone());
        used += msg_tokens;
    }
    // If we were holding a tool result whose assistant tool-call didn't
    // fit, remove the orphaned tool result(s) from the front.
    while skip_until_assistant_with_tools
        && trimmed.first().is_some_and(|m| m.role == "tool")
    {
        trimmed.remove(0);
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

use std::sync::LazyLock;

#[cfg(test)]
mod tests {
    use super::*;
    fn valid_idea_assessment() -> Value {
        json!({
            "schemaVersion": 1,
            "effort": { "minHours": 2, "maxHours": 5 },
            "difficulty": 3,
            "impact": 4,
            "risk": 2,
            "confidence": 4,
            "rationale": "The target is bounded by an existing service.",
            "grounding": ["src/service.rs::run"],
            "requiredCapabilities": ["Rust"],
            "constraints": ["No new dependency"],
            "missingEvidence": [],
            "alternatives": ["Keep current behavior"]
        })
    }

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
        assert!(trimmed
            .last()
            .map(|m| m.content.contains("latest"))
            .unwrap_or(false));
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
    fn trim_to_budget_never_leaves_orphan_tool_result() {
        // Conversation: user → assistant(tool_calls) → tool(result) → user
        // With a tight budget that can only keep the last user message,
        // the tool result must NOT survive without its assistant tool-call.
        let mut assistant_with_tools = ChatMsg::text("assistant", "");
        assistant_with_tools.tool_calls = vec![ToolCallRequest {
            id: "call_1".to_string(),
            name: "list_files".to_string(),
            arguments: r#"{"path":"./"}"#.to_string(),
        }];
        let mut tool_result = ChatMsg::text("tool", "src/\npackage.json\nREADME.md");
        tool_result.tool_call_id = Some("call_1".to_string());
        tool_result.name = Some("list_files".to_string());
        let messages = vec![
            ChatMsg::text("user", &"old message with lots of words ".repeat(200)),
            assistant_with_tools,
            tool_result,
            ChatMsg::text("user", "latest message that should be kept"),
        ];
        let system = "system prompt with a few words";
        // Budget tight enough that the old user message won't fit.
        let (trimmed, did_truncate) = trim_to_budget(&messages, system, &[], 500);
        assert!(did_truncate);
        // No tool result without a preceding assistant tool-call.
        for (i, msg) in trimmed.iter().enumerate() {
            if msg.role == "tool" {
                assert!(
                    i > 0
                        && trimmed[i - 1].role == "assistant"
                        && !trimmed[i - 1].tool_calls.is_empty(),
                    "tool result at index {i} has no preceding assistant tool-call"
                );
            }
        }
    }

    #[test]
    fn cancellation_token_works() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn resolve_interaction_delivers_answers_to_parked_channel() {
        // Simulate the ask_user flow: register a pending interaction with a
        // channel, then resolve it from the UI side. The answers should
        // arrive on the channel.
        let interaction_id = format!("test-int-{}", std::process::id());
        let (tx, rx) = std::sync::mpsc::channel::<InteractionResolution>();
        {
            let mut pending = PENDING_INTERACTIONS.lock();
            pending.insert(interaction_id.clone(), tx);
        }
        let answers = vec![crate::models::interaction::QuestionAnswer {
            question_id: "q1".to_string(),
            selected: vec![],
            text: Some("yes".to_string()),
            value: None,
        }];
        let result = resolve_interaction(&interaction_id, answers.clone());
        assert!(result.is_ok(), "resolve_interaction should succeed");
        // The parked channel should receive the resolution.
        let resolution = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("should receive resolution");
        assert!(!resolution.cancelled, "should not be cancelled");
        assert_eq!(resolution.answers.len(), 1);
        assert_eq!(resolution.answers[0].question_id, "q1");
        assert_eq!(resolution.answers[0].text.as_deref(), Some("yes"));
        assert!(resolve_interaction(&interaction_id, answers).is_err());
        assert!(
            rx.try_recv().is_err(),
            "duplicate submit must not deliver again"
        );
        // The pending entry should be removed.
        let pending = PENDING_INTERACTIONS.lock();
        assert!(
            !pending.contains_key(&interaction_id),
            "pending entry should be removed"
        );
    }

    #[test]
    fn interaction_timeout_removes_parked_channel() {
        let interaction_id = format!("test-timeout-{}", std::process::id());
        let (tx, rx) = std::sync::mpsc::channel::<InteractionResolution>();
        PENDING_INTERACTIONS
            .lock()
            .insert(interaction_id.clone(), tx);

        let result = await_interaction(&interaction_id, &rx, std::time::Duration::from_millis(0));

        assert!(matches!(
            result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        assert!(!PENDING_INTERACTIONS.lock().contains_key(&interaction_id));
    }

    #[test]
    fn resolve_interaction_returns_error_for_unknown_id() {
        let result = resolve_interaction("nonexistent-id", vec![]);
        assert!(result.is_err(), "should error for unknown interaction id");
    }

    #[test]
    fn cancel_interaction_delivers_cancelled_resolution() {
        let interaction_id = format!("test-cancel-{}", std::process::id());
        let (tx, rx) = std::sync::mpsc::channel::<InteractionResolution>();
        {
            let mut pending = PENDING_INTERACTIONS.lock();
            pending.insert(interaction_id.clone(), tx);
        }
        let result = cancel_interaction(&interaction_id);
        assert!(result.is_ok(), "cancel_interaction should succeed");
        let resolution = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("should receive resolution");
        assert!(resolution.cancelled, "should be cancelled");
        assert!(
            resolution.answers.is_empty(),
            "cancelled resolution should have no answers"
        );
    }
    #[test]
    fn propose_ideas_rejects_weak_batch_before_persisting_any_item() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        let session = crate::services::session_service::SessionService::create_session(
            "/test/assessed-ideas",
            "Assessed ideas",
        )
        .unwrap();
        let assessment = valid_idea_assessment();
        let mut invalid = assessment.clone();
        invalid["confidence"] = json!(6);
        let call = ToolCallRequest {
            id: "call-assessed-ideas".to_string(),
            name: "propose_ideas".to_string(),
            arguments: json!({
                "ideas": [
                    {
                        "title": "Improve routing",
                        "description": "Choose a compatible route.",
                        "grounding": "src/service.rs::run",
                        "assessment": assessment
                    },
                    {
                        "title": "Invalid estimate",
                        "description": "This item must reject the batch.",
                        "grounding": "Explicit validation fixture.",
                        "assessment": invalid
                    }
                ]
            })
            .to_string(),
        };

        let result = execute_propose_ideas(&session.id, &call);

        assert_eq!(result.status, "failed");
        assert!(result.content.contains("ideas[1]"));
        assert!(
            crate::services::session_service::SessionService::list_ideas(&session.id,)
                .unwrap()
                .is_empty(),
            "validation failure must not leave a partial batch"
        );
    }
    #[test]
    fn propose_ideas_persists_a_valid_assessment() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        let session = crate::services::session_service::SessionService::create_session(
            "/test/valid-assessed-idea",
            "Valid assessment",
        )
        .unwrap();
        let call = ToolCallRequest {
            id: "call-valid-assessment".to_string(),
            name: "propose_ideas".to_string(),
            arguments: json!({
                "ideas": [{
                    "title": "Improve routing",
                    "description": "Choose a compatible route.",
                    "grounding": "src/service.rs::run",
                    "assessment": valid_idea_assessment()
                }]
            })
            .to_string(),
        };

        let result = execute_propose_ideas(&session.id, &call);
        let ideas =
            crate::services::session_service::SessionService::list_ideas(&session.id).unwrap();

        assert_eq!(result.status, "succeeded");
        assert_eq!(ideas.len(), 1);
        let assessment = ideas[0].assessment.as_ref().expect("assessment");
        assert_eq!(assessment.effort.min_hours, 2);
        assert_eq!(assessment.effort.max_hours, 5);
        assert_eq!(assessment.impact, 4);
    }
    /// Reproduces the observed failure: a plain "give me more ideas" chat
    /// message runs the agent loop with the native-chat id, which is not a
    /// `sessions` row, so idea INSERTs hit the ideas.session_id FK. The
    /// intercept must map the native-chat id to the project's planning
    /// session instead of failing with an opaque FOREIGN KEY error.
    #[test]
    fn propose_ideas_maps_native_chat_id_to_project_planning_session() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        let planning = crate::services::session_service::SessionService::create_session(
            "/test/nchat-capture",
            "Planning",
        )
        .unwrap();
        let conn = crate::services::storage_service::StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at)
             VALUES ('nchat-capture', '/test/nchat-capture', 'Chat', 'basebuild-native', 'anthropic', 'claude', 'high', 'ready', 0, 0)",
            [],
        )
        .unwrap();
        let call = ToolCallRequest {
            id: "call-nchat-capture".to_string(),
            name: "propose_ideas".to_string(),
            arguments: json!({
                "ideas": [{
                    "title": "Improve routing",
                    "description": "Choose a compatible route.",
                    "grounding": "src/service.rs::run",
                    "assessment": valid_idea_assessment()
                }]
            })
            .to_string(),
        };

        let result = execute_propose_ideas("nchat-capture", &call);

        assert_eq!(result.status, "succeeded", "content: {}", result.content);
        let ideas =
            crate::services::session_service::SessionService::list_ideas(&planning.id).unwrap();
        assert_eq!(
            ideas.len(),
            1,
            "the capture must land in the project's planning session"
        );
    }

    /// A stale or hallucinated categoryId used to surface as a raw
    /// "FOREIGN KEY constraint failed" from the INSERT. The intercept must
    /// reject it upfront with a repairable message and persist nothing.
    #[test]
    fn propose_ideas_rejects_unknown_category_before_persisting() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        let session = crate::services::session_service::SessionService::create_session(
            "/test/bad-category",
            "Planning",
        )
        .unwrap();
        let category = crate::services::session_service::SessionService::create_category(
            &session.id,
            "Simpler UX",
            "UX simplification",
        )
        .unwrap();
        let call = ToolCallRequest {
            id: "call-bad-category".to_string(),
            name: "propose_ideas".to_string(),
            arguments: json!({
                "categoryId": "cat-stale",
                "ideas": [{
                    "title": "Improve routing",
                    "description": "Choose a compatible route.",
                    "grounding": "src/service.rs::run",
                    "assessment": valid_idea_assessment()
                }]
            })
            .to_string(),
        };

        let result = execute_propose_ideas(&session.id, &call);

        assert_eq!(result.status, "failed");
        assert!(
            result.content.contains("'cat-stale'") && result.content.contains(&category.id),
            "error must name the invalid id and the valid ones: {}",
            result.content
        );
        assert!(
            crate::services::session_service::SessionService::list_ideas(&session.id)
                .unwrap()
                .is_empty(),
            "category validation failure must not leave a partial batch"
        );
    }

    /// Register a bare run handle so the steering registry sees a live run
    /// without spinning up a provider loop.
    fn register_test_run(session_id: &str) {
        ACTIVE_RUNS.lock().insert(
            session_id.to_string(),
            Arc::new(RunHandle {
                token: CancellationToken::new(),
            }),
        );
    }

    /// Drop the test run handle and any queued steers so the process-wide
    /// registries stay clean for the rest of the suite.
    fn clear_test_run(session_id: &str) {
        ACTIVE_RUNS.lock().remove(session_id);
        PENDING_STEERS.lock().remove(session_id);
    }

    #[test]
    fn push_steer_refuses_when_no_run_is_active() {
        let session_id = "steer-no-active-run";
        assert!(!is_running(session_id));
        assert!(
            !push_steer(session_id, "change course"),
            "with nothing running the caller must fall back to a normal send"
        );
        assert!(
            drain_steers(session_id).is_empty(),
            "a refused steer must not be queued"
        );
    }

    #[test]
    fn push_steer_queues_in_order_and_drain_empties_the_queue() {
        let session_id = "steer-active-run";
        register_test_run(session_id);

        assert!(is_running(session_id));
        assert!(push_steer(session_id, "first"));
        assert!(push_steer(session_id, "second"));

        assert_eq!(drain_steers(session_id), vec!["first", "second"]);
        assert!(
            drain_steers(session_id).is_empty(),
            "draining takes the queue, it does not copy it"
        );

        clear_test_run(session_id);
    }

    /// The finish handoff: with nothing pending the run handle is retired
    /// under the same lock order `push_steer` checks it, so a steer arriving
    /// after the final drain is refused instead of queued against a dead run.
    #[test]
    fn finish_or_steer_retires_the_run_when_nothing_is_pending() {
        let session_id = "steer-finish-clean";
        register_test_run(session_id);

        assert!(finish_or_steer(session_id).is_empty());

        assert!(!is_running(session_id), "the run handle must be retired");
        assert!(
            !push_steer(session_id, "too late"),
            "a steer racing in after the final drain must be refused, not swallowed"
        );
    }

    #[test]
    fn finish_or_steer_keeps_the_run_alive_when_a_steer_is_pending() {
        let session_id = "steer-finish-redirect";
        register_test_run(session_id);
        assert!(push_steer(session_id, "actually, do this instead"));

        assert_eq!(
            finish_or_steer(session_id),
            vec!["actually, do this instead"]
        );

        assert!(
            is_running(session_id),
            "the loop keeps running to serve the steer"
        );
        assert!(
            push_steer(session_id, "and this too"),
            "the still-live run keeps accepting steers"
        );

        clear_test_run(session_id);
    }
}

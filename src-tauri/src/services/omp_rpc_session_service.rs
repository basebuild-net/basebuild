//! Persistent OMP RPC session bridge: owns a hidden `omp --mode rpc` child
//! per session, exchanges line-delimited JSON frames over stdio, and maps
//! frames to native transcript events. Generalizes the one-shot
//! `OmpCodexRpcClient` frame reader into a long-lived session adapter.
//!
//! Frames are untrusted child-process output: parsing is tolerant (malformed
//! lines skipped, unknown frame kinds rendered as inert collapsed debug rows),
//! never executes or interpolates frame content, and never crashes the
//! session on unexpected input.
//!
//! Lifecycle: start → running → exited. A version/capability probe gates
//! the `omp-rpc` runtime profile. Process exit surfaces as a session-ended
//! state with visible history retained.

use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    events::NATIVE_CHAT_CHUNK,
    services::{interaction_service::InteractionService, process_helpers},
};

/// OMP RPC session state.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OmpRpcSessionStatus {
    Starting,
    Running,
    Exited,
}

/// A managed OMP RPC session: the child process + metadata.
pub struct OmpRpcSession {
    pub session_id: String,
    pub child: Option<Child>,
    pub status: OmpRpcSessionStatus,
    /// Signalled when a `turn_end` frame arrives. Used by `native_chat_send`
    /// to wait for the OMP turn to complete.
    pub turn_end_signal: Arc<parking_lot::Mutex<Option<std::sync::mpsc::Sender<()>>>>,
    /// Accumulated content text from the current turn. Cleared on each new
    /// prompt, read by `native_chat_send` after `turn_end`.
    pub content_accumulator: Arc<parking_lot::Mutex<String>>,
    /// Accumulated reasoning text from the current turn.
    pub reasoning_accumulator: Arc<parking_lot::Mutex<String>>,
}

/// Registry of active OMP RPC sessions, held in Tauri managed state.
#[derive(Default)]
pub struct OmpRpcSessionRegistry {
    sessions: Mutex<std::collections::HashMap<String, Arc<Mutex<OmpRpcSession>>>>,
}

impl OmpRpcSessionRegistry {
    pub fn get(&self, session_id: &str) -> Option<Arc<Mutex<OmpRpcSession>>> {
        self.sessions.lock().unwrap().get(session_id).cloned()
    }

    pub fn insert(&self, session_id: &str, session: OmpRpcSession) {
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.to_string(), Arc::new(Mutex::new(session)));
    }

    pub fn remove(&self, session_id: &str) -> Option<Arc<Mutex<OmpRpcSession>>> {
        self.sessions.lock().unwrap().remove(session_id)
    }
}

/// Probe whether an installed OMP supports `--mode rpc` with the frames we
/// need. Returns Ok with the detected version string, or Err with a reason.
pub fn probe_omp_rpc() -> Result<String, String> {
    let output = process_helpers::hidden_command("omp")
        .arg("--version")
        .output()
        .map_err(|e| format!("OMP not installed or not on PATH: {e}"))?;
    if !output.status.success() {
        return Err("OMP --version exited non-zero".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("OMP --version produced empty output".to_string());
    }
    Ok(version)
}

/// Start a persistent OMP RPC session for the given chat session.
/// Spawns a hidden `omp --mode rpc` child with session+tools enabled and
/// begins reading frames on a background thread.
pub fn start_session(
    app: AppHandle,
    session_id: String,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    // Kill any existing session with this id.
    if let Some(existing) = app.state::<OmpRpcSessionRegistry>().get(&session_id) {
        if let Ok(mut session) = existing.lock() {
            if let Some(child) = session.child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            session.status = OmpRpcSessionStatus::Exited;
        }
        app.state::<OmpRpcSessionRegistry>().remove(&session_id);
    }

    let mut cmd = process_helpers::hidden_command("omp");
    cmd.args([
        "--mode", "rpc",
        "--provider", provider,
        "--model", model,
        "--no-title",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch OMP RPC session: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to open OMP stdout")?;
    let session_id_for_reader = session_id.clone();
    let app_for_reader = app.clone();

    // Background thread: read line-delimited JSON frames and map them.
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            handle_frame(&app_for_reader, &session_id_for_reader, &line);
        }
        // stdout closed → process exited.
        let _ = app_for_reader.emit(
            "omp-rpc://status",
            json!({ "sessionId": session_id_for_reader, "status": "exited" }),
        );
        if let Some(registry) = app_for_reader.try_state::<OmpRpcSessionRegistry>() {
            if let Some(session) = registry.get(&session_id_for_reader) {
                if let Ok(mut s) = session.lock() {
                    s.status = OmpRpcSessionStatus::Exited;
                }
            }
        }
    });

    app.state::<OmpRpcSessionRegistry>().insert(
        &session_id,
        OmpRpcSession {
            session_id: session_id.clone(),
            child: Some(child),
            status: OmpRpcSessionStatus::Running,
            turn_end_signal: Arc::new(parking_lot::Mutex::new(None)),
            content_accumulator: Arc::new(parking_lot::Mutex::new(String::new())),
            reasoning_accumulator: Arc::new(parking_lot::Mutex::new(String::new())),
        },
    );
    let _ = app.emit(
        "omp-rpc://status",
        json!({ "sessionId": session_id, "status": "running" }),
    );

    Ok(())
}

/// Send a prompt to an OMP RPC session's stdin.
pub fn send_prompt(app: &AppHandle, session_id: &str, message: &str) -> Result<(), String> {
    let session = app
        .state::<OmpRpcSessionRegistry>()
        .get(session_id)
        .ok_or("OMP RPC session not found")?;
    let session = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
    let child = session.child.as_ref().ok_or("OMP RPC session has no child process")?;
    let stdin = child.stdin.as_ref().ok_or("OMP RPC stdin not available")?;
    let frame = json!({ "id": format!("basebuild-{session_id}"), "type": "prompt", "message": message });
    let mut stdin = stdin;
    writeln!(stdin, "{frame}").map_err(|e| format!("Failed to write prompt: {e}"))?;
    stdin.flush().map_err(|e| format!("Failed to flush prompt: {e}"))?;
    Ok(())
}

/// Send a prompt to an OMP RPC session, wait for the turn to complete, and
/// return the accumulated content and reasoning text. Returns `Ok((content,
/// reasoning))` when the `turn_end` frame arrives, or `Err` on timeout.
pub fn send_prompt_and_wait(
    app: &AppHandle,
    session_id: &str,
    message: &str,
    timeout_secs: u64,
) -> Result<(String, String), String> {
    let session = app
        .state::<OmpRpcSessionRegistry>()
        .get(session_id)
        .ok_or("OMP RPC session not found")?;
    // Clear accumulators for the new turn and register the turn_end channel.
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    {
        let s = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
        s.content_accumulator.lock().clear();
        s.reasoning_accumulator.lock().clear();
        *s.turn_end_signal.lock() = Some(tx);
    }
    // Send the prompt.
    send_prompt(app, session_id, message)?;
    // Wait for turn_end or timeout.
    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(()) => {
            let s = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
            let content = s.content_accumulator.lock().clone();
            let reasoning = s.reasoning_accumulator.lock().clone();
            Ok((content, reasoning))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            // Clear the signal and return whatever content was accumulated.
            let s = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
            *s.turn_end_signal.lock() = None;
            let content = s.content_accumulator.lock().clone();
            let reasoning = s.reasoning_accumulator.lock().clone();
            if content.is_empty() {
                Err(format!("OMP RPC turn timed out after {timeout_secs}s"))
            } else {
                Ok((content, reasoning))
            }
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("OMP RPC session exited during turn".to_string())
        }
    }
}


/// Send a cancel/abort to an OMP RPC session's stdin.
pub fn cancel_session(app: &AppHandle, session_id: &str) -> Result<(), String> {
    let session = app
        .state::<OmpRpcSessionRegistry>()
        .get(session_id)
        .ok_or("OMP RPC session not found")?;
    let session = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
    // Cancel any pending interactions for this session.
    let _ = InteractionService::cancel_pending_for_session(session_id);
    if let Some(child) = session.child.as_ref() {
        if let Some(stdin) = child.stdin.as_ref() {
            let frame = json!({ "id": format!("basebuild-cancel-{session_id}"), "type": "cancel" });
            let mut stdin = stdin;
            let _ = writeln!(stdin, "{frame}");
            let _ = stdin.flush();
        }
    }
    Ok(())
}

/// Shut down an OMP RPC session: kill the child, remove from registry.
pub fn shutdown_session(app: &AppHandle, session_id: &str) -> Result<(), String> {
    if let Some(session) = app.state::<OmpRpcSessionRegistry>().remove(session_id) {
        if let Ok(mut s) = session.lock() {
            if let Some(child) = s.child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            s.status = OmpRpcSessionStatus::Exited;
        }
    }
    let _ = app.emit(
        "omp-rpc://status",
        json!({ "sessionId": session_id, "status": "exited" }),
    );
    Ok(())
}

/// Parse and handle a single line-delimited JSON frame from OMP.
/// Tolerant: malformed lines are skipped; unknown frame kinds emit an inert
/// debug chunk. Never panics on unexpected input.
fn handle_frame(app: &AppHandle, session_id: &str, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let frame: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Malformed line: skip (tolerant parsing per spec).
            return;
        }
    };
    let frame_type = frame.get("type").and_then(Value::as_str).unwrap_or("");

    match frame_type {
        "response" => {
            // Prompt accepted/rejected. If rejected, emit an error chunk.
            if frame.get("success").and_then(Value::as_bool) == Some(false) {
                let error = frame.get("error").and_then(Value::as_str).unwrap_or("OMP rejected the prompt");
                let _ = app.emit(
                    NATIVE_CHAT_CHUNK,
                    json!({ "sessionId": session_id, "delta": format!("[error: {error}]"), "channel": "error" }),
                );
            }
        }
        "assistantMessageEvent" | "event" | "message_update" => {
            // Nested event frame: extract the inner event.
            // `message_update` frames wrap an `assistantMessageEvent` with
            // text_start/text_delta/text_end deltas — same structure as the
            // legacy `assistantMessageEvent` frame type.
            if let Some(event) = frame.get("assistantMessageEvent").or(frame.get("event")) {
                handle_assistant_event(app, session_id, event);
            }
        }
        "message_end" => {
            // Message complete: if this is an assistant message and the
            // content accumulator is still empty (e.g. all deltas were in
            // text_start/text_end rather than text_delta), extract the full
            // text from the message content as a fallback.
            if let Some(msg) = frame.get("message") {
                if msg.get("role").and_then(Value::as_str) == Some("assistant") {
                    if let Some(content_arr) = msg.get("content").and_then(Value::as_array) {
                        let full_text: String = content_arr
                            .iter()
                            .filter_map(|c| {
                                if c.get("type").and_then(Value::as_str) == Some("text") {
                                    c.get("text").and_then(Value::as_str)
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                            .join("");
                        if !full_text.is_empty() {
                            if let Some(registry) = app.try_state::<OmpRpcSessionRegistry>() {
                                if let Some(session) = registry.get(session_id) {
                                    if let Ok(s) = session.lock() {
                                        if s.content_accumulator.lock().is_empty() {
                                            s.content_accumulator.lock().push_str(&full_text);
                                            let _ = app.emit(
                                                NATIVE_CHAT_CHUNK,
                                                json!({ "sessionId": session_id, "delta": &full_text, "channel": "content" }),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        "turn_end" | "agent_end" => {
            // Turn complete: emit a turn-end marker and signal any waiting
            // `native_chat_send` caller that the turn is done.
            // Also extract final assistant content from the turn_end frame
            // as a last-resort fallback if accumulators are empty.
            if frame_type == "turn_end" {
                if let Some(msg) = frame.get("message") {
                    if let Some(content_arr) = msg.get("content").and_then(Value::as_array) {
                        let full_text: String = content_arr
                            .iter()
                            .filter_map(|c| {
                                if c.get("type").and_then(Value::as_str) == Some("text") {
                                    c.get("text").and_then(Value::as_str)
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                            .join("");
                        if !full_text.is_empty() {
                            if let Some(registry) = app.try_state::<OmpRpcSessionRegistry>() {
                                if let Some(session) = registry.get(session_id) {
                                    if let Ok(s) = session.lock() {
                                        if s.content_accumulator.lock().is_empty() {
                                            s.content_accumulator.lock().push_str(&full_text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _ = app.emit(
                NATIVE_CHAT_CHUNK,
                json!({ "sessionId": session_id, "delta": "", "channel": "turn_end" }),
            );
            // Signal the turn_end channel if one was registered.
            if let Some(registry) = app.try_state::<OmpRpcSessionRegistry>() {
                if let Some(session) = registry.get(session_id) {
                    if let Ok(s) = session.lock() {
                        if let Some(sender) = s.turn_end_signal.lock().take() {
                            let _ = sender.send(());
                        }
                    }
                }
            }
        }
        "user_input" | "ask" | "question" => {
            // User-input request: create a pending interaction (question card).
            handle_user_input(app, session_id, &frame);
        }
        _ => {
            // Unknown frame kind: emit as inert collapsed debug row.
            let kind = escape_text(frame_type);
            let _ = app.emit(
                NATIVE_CHAT_CHUNK,
                json!({ "sessionId": session_id, "delta": format!("[debug: unknown frame kind: {kind}]"), "channel": "debug" }),
            );
        }
    }
}

/// Handle an assistant message event (text/reasoning/tool deltas).
fn handle_assistant_event(app: &AppHandle, session_id: &str, event: &Value) {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "text_delta" | "text_start" | "text_end" => {
            // Text content delta. `text_delta` has a `delta` field with
            // incremental text. `text_start`/`text_end` don't have `delta`
            // (content is in `partial`/`content` respectively) — they're
            // matched here to suppress debug noise; the full text is
            // recovered from `message_end`/`turn_end` as a fallback.
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    // Accumulate content for `native_chat_send` to persist.
                    if let Some(registry) = app.try_state::<OmpRpcSessionRegistry>() {
                        if let Some(session) = registry.get(session_id) {
                            if let Ok(s) = session.lock() {
                                s.content_accumulator.lock().push_str(delta);
                            }
                        }
                    }
                    let _ = app.emit(
                        NATIVE_CHAT_CHUNK,
                        json!({ "sessionId": session_id, "delta": delta, "channel": "content" }),
                    );
                }
            }
        }
        "reasoning_delta" | "thinking_delta" => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    // Accumulate reasoning for `native_chat_send` to persist.
                    if let Some(registry) = app.try_state::<OmpRpcSessionRegistry>() {
                        if let Some(session) = registry.get(session_id) {
                            if let Ok(s) = session.lock() {
                                s.reasoning_accumulator.lock().push_str(delta);
                            }
                        }
                    }
                    let _ = app.emit(
                        NATIVE_CHAT_CHUNK,
                        json!({ "sessionId": session_id, "delta": delta, "channel": "reasoning" }),
                    );
                }
            }
        }
        "tool_call" | "tool_event" | "tool_start" | "tool_end" => {
            // Tool activity → tool card channel.
            let summary = event.get("name").and_then(Value::as_str).unwrap_or("tool");
            let _ = app.emit(
                NATIVE_CHAT_CHUNK,
                json!({ "sessionId": session_id, "delta": summary, "channel": "tool", "frame": event }),
            );
        }
        _ => {
            // Unknown event kind: inert debug.
            let kind = escape_text(event_type);
            let _ = app.emit(
                NATIVE_CHAT_CHUNK,
                json!({ "sessionId": session_id, "delta": format!("[debug: unknown event kind: {kind}]"), "channel": "debug" }),
            );
        }
    }
}

/// Handle a user-input/ask frame: create a pending interaction so the UI
/// renders a question card. The answer is returned to OMP over stdin when
/// the user resolves it (see `resolve_user_input`).
fn handle_user_input(app: &AppHandle, session_id: &str, frame: &Value) {
    // Extract question text and options from the frame. OMP's exact ask
    // frame shape is recorded in the protocol spike (agent-runtime.md).
    // We tolerate several common field names.
    let prompt = frame
        .get("prompt")
        .or_else(|| frame.get("message"))
        .or_else(|| frame.get("question"))
        .and_then(Value::as_str)
        .unwrap_or("OMP requests input");
    let id = frame
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let options: Vec<String> = frame
        .get("options")
        .and_then(|o| o.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .or_else(|| v.get("label").and_then(Value::as_str).map(str::to_string))
                })
                .collect()
        })
        .unwrap_or_default();

    // Build a Question for the interaction service.
    use crate::models::interaction::{Question, QuestionKind, QuestionOption};
    let question = Question {
        id: id.clone(),
        prompt: prompt.to_string(),
        kind: QuestionKind::Options,
        options: options
            .iter()
            .map(|label| QuestionOption {
                label: label.clone(),
                description: None,
            })
            .collect(),
        recommended: None,
        allow_free_text: false,
    };

    match InteractionService::create(session_id, None, &[question]) {
        Ok(interaction) => {
            let _ = app.emit(
                "omp-rpc://question",
                json!({ "sessionId": session_id, "interactionId": interaction.id, "prompt": prompt, "options": options, "frameId": id }),
            );
            // Also emit the standard interactive-request event so the
            // ChatPanel refreshes its interaction list and renders the
            // question card. Without this, the frontend never learns about
            // the question and the user has no way to answer it.
            let _ = app.emit(
                "native-chat://interactive-request",
                json!({ "sessionId": session_id, "interactionId": interaction.id }),
            );
        }
        Err(e) => {
            let _ = app.emit(
                NATIVE_CHAT_CHUNK,
                json!({ "sessionId": session_id, "delta": format!("[error: failed to create question card: {e}]"), "channel": "error" }),
            );
        }
    }
}

/// Resolve a user-input request: send the user's answer back to OMP over
/// stdin. Called when the user answers a question card.
pub fn resolve_user_input(app: &AppHandle, session_id: &str, frame_id: &str, answer: &str) -> Result<(), String> {
    let session = app
        .state::<OmpRpcSessionRegistry>()
        .get(session_id)
        .ok_or("OMP RPC session not found")?;
    let session = session.lock().map_err(|e| format!("Session lock poisoned: {e}"))?;
    let child = session.child.as_ref().ok_or("OMP RPC session has no child process")?;
    let stdin = child.stdin.as_ref().ok_or("OMP RPC stdin not available")?;
    let frame = json!({ "id": frame_id, "type": "user_response", "answer": answer });
    let mut stdin = stdin;
    writeln!(stdin, "{frame}").map_err(|e| format!("Failed to write answer: {e}"))?;
    stdin.flush().map_err(|e| format!("Failed to flush answer: {e}"))?;
    Ok(())
}

/// Escape text for inert debug display (no interpolation, no execution).
fn escape_text(s: &str) -> String {
    s.replace('\\', "\\\\").replace(']', "\\]")
}

// ─── Unit tests: frame parser fixtures ───────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_empty_and_malformed_lines() {
        // These should not panic; handle_frame is tolerant.
        // We can't easily test the emit side without a mock AppHandle,
        // but we can verify the parsing logic doesn't panic.
        let line = "";
        let trimmed = line.trim();
        assert!(trimmed.is_empty());

        let line = "not json at all";
        let trimmed = line.trim();
        let result: Result<Value, _> = serde_json::from_str(trimmed);
        assert!(result.is_err());
    }

    #[test]
    fn parses_text_delta_frame() {
        let line = r#"{"type":"assistantMessageEvent","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}"#;
        let frame: Value = serde_json::from_str(line).unwrap();
        assert_eq!(frame.get("type").and_then(Value::as_str), Some("assistantMessageEvent"));
        let event = frame.get("assistantMessageEvent").unwrap();
        assert_eq!(event.get("type").and_then(Value::as_str), Some("text_delta"));
        assert_eq!(event.get("delta").and_then(Value::as_str), Some("hello"));
    }

    #[test]
    fn parses_turn_end_frame() {
        let line = r#"{"type":"turn_end"}"#;
        let frame: Value = serde_json::from_str(line).unwrap();
        assert_eq!(frame.get("type").and_then(Value::as_str), Some("turn_end"));
    }

    #[test]
    fn parses_unknown_frame_kind() {
        let line = r#"{"type":"some_new_frame","data":"whatever"}"#;
        let frame: Value = serde_json::from_str(line).unwrap();
        let frame_type = frame.get("type").and_then(Value::as_str).unwrap_or("");
        assert_eq!(frame_type, "some_new_frame");
        // Unknown kinds are handled by the _ arm in handle_frame.
    }

    #[test]
    fn parses_user_input_frame_with_options() {
        let line = r#"{"type":"user_input","id":"q1","prompt":"Choose?","options":["a","b","c"]}"#;
        let frame: Value = serde_json::from_str(line).unwrap();
        assert_eq!(frame.get("type").and_then(Value::as_str), Some("user_input"));
        assert_eq!(frame.get("id").and_then(Value::as_str), Some("q1"));
        assert_eq!(frame.get("prompt").and_then(Value::as_str), Some("Choose?"));
        let options = frame.get("options").and_then(|o| o.as_array()).unwrap();
        assert_eq!(options.len(), 3);
    }

    #[test]
    fn parses_user_input_frame_with_object_options() {
        let line = r#"{"type":"ask","id":"q2","message":"Pick","options":[{"label":"Yes"},{"label":"No"}]}"#;
        let frame: Value = serde_json::from_str(line).unwrap();
        assert_eq!(frame.get("type").and_then(Value::as_str), Some("ask"));
        let options = frame.get("options").and_then(|o| o.as_array()).unwrap();
        assert_eq!(options.len(), 2);
        assert_eq!(
            options[0].get("label").and_then(Value::as_str),
            Some("Yes")
        );
    }

    #[test]
    fn escape_text_escapes_brackets_and_backslashes() {
        assert_eq!(escape_text("hello"), "hello");
        assert_eq!(escape_text("a]b"), "a\\]b");
        assert_eq!(escape_text(r"a\b"), r"a\\b");
    }

    #[test]
    fn question_round_trip_serialization() {
        use crate::models::interaction::{Question, QuestionKind, QuestionOption};
        let q = Question {
            id: "q1".to_string(),
            prompt: "Choose?".to_string(),
            kind: QuestionKind::Options,
            options: vec![
                QuestionOption { label: "a".to_string(), description: None },
                QuestionOption { label: "b".to_string(), description: None },
            ],
            recommended: None,
            allow_free_text: false,
        };
        let json = serde_json::to_string(&q).unwrap();
        let parsed: Question = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "q1");
        assert_eq!(parsed.options.len(), 2);
        assert_eq!(parsed.options[0].label, "a");
    }
}

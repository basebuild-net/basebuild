//! Provider execution layer for the native chat harness.
//!
//! Each chat turn is dispatched to the provider/model selected for that turn.
//! `LocalCoordinator` is an explicit, clearly-labeled offline fallback; the
//! network clients (`OpenAiCompatibleClient`, `AnthropicClient`) stream real
//! assistant output and capture real token usage. Secrets are never logged.

use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const LOCAL_PROVIDER_ID: &str = "basebuild-local";

/// A single conversation message handed to a provider.
///
/// `content` is the rendered text. `tool_calls` holds outbound tool-call
/// requests the assistant issued (assistant role only). `tool_call_id` and
/// `name` identify a tool-result message (role `tool` for OpenAI, or a
/// `tool_result` content block for Anthropic — the adapter renders the
/// correct wire shape).
#[derive(Debug, Clone, Default)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
    /// Outbound tool calls (assistant messages only). Empty for non-assistant.
    pub tool_calls: Vec<ToolCallRequest>,
    /// For role=`tool` messages: the tool call id this result answers.
    pub tool_call_id: Option<String>,
    /// For role=`tool` messages: the tool name that produced this result.
    pub name: Option<String>,
}

impl ChatMsg {
    /// Convenience for plain text user/assistant/system messages.
    pub fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.to_string(),
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            name: None,
        }
    }
}

/// A JSON-schema tool definition sent to the provider so the model knows what
/// tools exist and how to call them.
#[derive(Debug, Clone)]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    /// JSON Schema for the parameters object. The provider wraps this as
    /// needed (OpenAI nests under `parameters`; Anthropic nests under
    /// `input_schema`).
    pub parameters: Value,
}

/// A tool call requested by the model. Assembled from streamed deltas.
#[derive(Debug, Clone, Default)]
pub struct ToolCallRequest {
    /// Provider-assigned id (OpenAI `tool_calls[].id`; Anthropic `tool_use.id`).
    pub id: String,
    /// Tool name (OpenAI `function.name`; Anthropic `tool_use.name`).
    pub name: String,
    /// Raw JSON arguments string. May arrive fragmented across deltas; the
    /// adapter accumulates and parses on completion.
    pub arguments: String,
}

/// A fully-resolved provider request for one turn.
#[derive(Debug, Clone)]
pub struct ProviderRequest {
    pub model_id: String,
    pub effort_level: String,
    pub system: Option<String>,
    pub messages: Vec<ChatMsg>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// Tools the model may call this turn. Empty for plain-chat turns or
    /// models that don't support tools.
    pub tools: Vec<ToolSchema>,
}

/// The result of a completed provider turn.
#[derive(Debug, Clone, Default)]
pub struct ProviderResponse {
    pub content: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub duration_ms: i64,
    /// Tool calls the model issued this turn. Empty for plain-chat turns.
    pub tool_calls: Vec<ToolCallRequest>,
}

/// Dispatches a resolved request, streaming content deltas through `emit`.
///
/// `emit` receives the delta text and a channel label: `"content"` for final
/// assistant text, `"reasoning"` for chain-of-thought / thinking tokens that
/// providers stream ahead of the answer, and `"tool_call"` for incremental
/// tool-call argument fragments (the assembled `ToolCallRequest`s are also
/// returned on the `ProviderResponse`). Callers that only care about the
/// final text can ignore the channel.
pub trait ProviderClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String>;
}

/// Resolve the client for a provider id. `base_url` is the stored credential
/// base URL override (if any).
pub fn resolve_client(provider_id: &str, base_url: Option<&str>) -> Box<dyn ProviderClient> {
    match provider_id {
        LOCAL_PROVIDER_ID => Box::new(LocalCoordinator),
        "anthropic" => Box::new(AnthropicClient {
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string()),
        }),
        "umans" => Box::new(OpenAiCompatibleClient {
            provider_id: "umans".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.code.umans.ai/v1".to_string()),
        }),
        // Default OpenAI-compatible (OpenAI itself and any future compatible provider).
        _ => Box::new(OpenAiCompatibleClient {
            provider_id: provider_id.to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        }),
    }
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.split_whitespace().count().max(1) as i64
    }
}

// ─── Local coordinator (offline fallback) ───

pub struct LocalCoordinator;

impl LocalCoordinator {
    /// The canned offline response, explicitly labeled as local-coordinator output.
    pub fn compose(system: Option<&str>, messages: &[ChatMsg], model_id: &str, effort_level: &str) -> String {
        let last_user = messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.lines().next().unwrap_or(&m.content).trim().to_string())
            .unwrap_or_default();
        let ctx = system.unwrap_or("").lines().next().unwrap_or("").trim();
        format!(
            "[Offline local coordinator — no external model was contacted]\n\n\
             Model: {model_id} · Effort: {effort_level}\n\
             {ctx}\n\
             Request: {last_user}\n\n\
             This turn was handled locally and persisted as structured chat with real timing \
             metrics. Connect a provider (OpenAI, Anthropic, or Umans) to get model-backed answers."
        )
    }
}

impl ProviderClient for LocalCoordinator {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String> {
        let start = Instant::now();
        let text = LocalCoordinator::compose(
            req.system.as_deref(),
            &req.messages,
            &req.model_id,
            &req.effort_level,
        );
        emit(&text, "content");
        let elapsed = start.elapsed().as_millis() as i64;
        Ok(ProviderResponse {
            input_tokens: Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum()),
            output_tokens: Some(estimate_tokens(&text)),
            ttft_ms: Some(elapsed),
            duration_ms: elapsed.max(1),
            content: text,
            tool_calls: Vec::new(),
        })
    }
}

// ─── OpenAI-compatible (OpenAI, Umans) ───

/// Accumulated state from an OpenAI-compatible SSE stream, extracted for
/// table-driven fixture tests without an HTTP mock server.
#[derive(Default)]
struct OpenAiStreamState {
    content: String,
    reasoning: String,
    ttft_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    tool_calls: Vec<ToolCallRequest>,
}

impl OpenAiStreamState {
    /// Process one raw SSE line from the response body.
    fn process_line(&mut self, line: &str, emit: &dyn Fn(&str, &str), start: &Instant) {
        let data = match line.strip_prefix("data:") {
            Some(rest) => rest.trim(),
            None => return,
        };
        if data.is_empty() || data == "[DONE]" {
            return;
        }
        let value: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
            self.input_tokens = usage
                .get("prompt_tokens")
                .and_then(Value::as_i64)
                .or(self.input_tokens);
            self.output_tokens = usage
                .get("completion_tokens")
                .and_then(Value::as_i64)
                .or(self.output_tokens);
        }
        let delta = value
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("delta"));
        // Reasoning tokens (e.g. Umans GLM, DeepSeek-R1) arrive ahead of
        // the final answer. Stream them on the reasoning channel so the UI
        // can show live thinking activity instead of freezing silently.
        if let Some(text) = delta
            .and_then(|d| d.get("reasoning_content"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                if self.ttft_ms.is_none() {
                    self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                }
                self.reasoning.push_str(text);
                emit(text, "reasoning");
            }
        }
        if let Some(text) = delta
            .and_then(|d| d.get("content"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                if self.ttft_ms.is_none() {
                    self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                }
                self.content.push_str(text);
                emit(text, "content");
            }
        }
        // Tool-call deltas. The first delta for a given index carries id
        // and name; subsequent deltas append to `arguments`. Emit the
        // argument fragments on the `tool_call` channel for live UI.
        if let Some(calls) = delta
            .and_then(|d| d.get("tool_calls"))
            .and_then(Value::as_array)
        {
            for call in calls {
                let idx = call
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as usize;
                while self.tool_calls.len() <= idx {
                    self.tool_calls.push(ToolCallRequest::default());
                }
                let slot = &mut self.tool_calls[idx];
                if let Some(id) = call.get("id").and_then(Value::as_str) {
                    slot.id = id.to_string();
                }
                if let Some(func) = call.get("function") {
                    if let Some(name) = func.get("name").and_then(Value::as_str) {
                        slot.name = name.to_string();
                    }
                    if let Some(args) = func.get("arguments").and_then(Value::as_str) {
                        if !args.is_empty() {
                            if self.ttft_ms.is_none() {
                                self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                            }
                            slot.arguments.push_str(args);
                            emit(args, "tool_call");
                        }
                    }
                }
            }
        }
    }
}

pub struct OpenAiCompatibleClient {
    pub provider_id: String,
    pub base_url: String,
}

impl ProviderClient for OpenAiCompatibleClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String> {
        let api_key = req
            .api_key
            .as_deref()
            .ok_or("Missing API key for provider request")?;

        let mut messages: Vec<Value> = Vec::new();
        if let Some(system) = req.system.as_deref() {
            if !system.trim().is_empty() {
                messages.push(json!({ "role": "system", "content": system }));
            }
        }
        for m in &req.messages {
            // Tool-result messages: role `tool` with the result content and
            // the tool_call_id this result answers.
            if m.role == "tool" {
                messages.push(json!({
                    "role": "tool",
                    "content": m.content,
                    "tool_call_id": m.tool_call_id,
                }));
                continue;
            }
            // Assistant messages that issued tool calls carry the calls in
            // the `tool_calls` array; content may be empty.
            if m.role == "assistant" && !m.tool_calls.is_empty() {
                let calls: Vec<Value> = m
                    .tool_calls
                    .iter()
                    .map(|c| {
                        json!({
                            "id": c.id,
                            "type": "function",
                            "function": {
                                "name": c.name,
                                "arguments": c.arguments,
                            }
                        })
                    })
                    .collect();
                let mut entry = json!({
                    "role": "assistant",
                    "tool_calls": calls,
                });
                if !m.content.trim().is_empty() {
                    entry["content"] = json!(m.content);
                }
                messages.push(entry);
                continue;
            }
            messages.push(json!({ "role": m.role, "content": m.content }));
        }

        let mut body = json!({
            "model": req.model_id,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        // Reasoning effort is only honored by OpenAI reasoning families; pass it
        // through for OpenAI so effort selection has a real effect.
        if self.provider_id == "openai" {
            body["reasoning_effort"] = json!(req.effort_level);
        }
        // Tool schemas: OpenAI function-calling format.
        if !req.tools.is_empty() {
            let tools: Vec<Value> = req
                .tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            body["tools"] = json!(tools);
        }

        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let start = Instant::now();
        let resp = http_client()?
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .map_err(|e| format!("Failed to reach provider: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            return Err(provider_http_error(status.as_u16(), &self.provider_id, &text));
        }

        let mut state = OpenAiStreamState::default();
        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("Stream read error: {e}"))?;
            state.process_line(&line, emit, &start);
        }

        let OpenAiStreamState {
            content,
            reasoning,
            ttft_ms,
            input_tokens,
            output_tokens,
            tool_calls,
        } = state;

        let duration_ms = (start.elapsed().as_millis() as i64).max(1);
        // A tool-call-only turn has no content/reasoning but is still valid.
        if content.trim().is_empty()
            && reasoning.trim().is_empty()
            && output_tokens.is_none()
            && tool_calls.is_empty()
        {
            return Err(format!(
                "Provider '{}' returned an empty response.",
                self.provider_id
            ));
        }
        // Fold reasoning into the persisted content so the saved assistant
        // message keeps the full trace. The UI renders them separately while
        // streaming; the persisted form is a single string for searchability.
        let persisted = if reasoning.trim().is_empty() {
            content
        } else {
            format!("{reasoning}\n\n---\n\n{content}")
        };
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&persisted))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content: persisted,
            tool_calls,
        })
    }
}

// ─── Anthropic ───

/// Accumulated state from an Anthropic SSE stream, extracted for fixture tests.
#[derive(Default)]
struct AnthropicStreamState {
    content: String,
    reasoning: String,
    ttft_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    tool_calls: Vec<ToolCallRequest>,
    current_block_idx: Option<usize>,
}

impl AnthropicStreamState {
    fn process_line(&mut self, line: &str, emit: &dyn Fn(&str, &str), start: &Instant) {
        let data = match line.strip_prefix("data:") {
            Some(rest) => rest.trim(),
            None => return,
        };
        if data.is_empty() {
            return;
        }
        let value: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        match value.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                self.input_tokens = value
                    .get("message")
                    .and_then(|m| m.get("usage"))
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(Value::as_i64)
                    .or(self.input_tokens);
            }
            Some("content_block_start") => {
                let idx = value
                    .get("index")
                    .and_then(Value::as_u64)
                    .map(|i| i as usize);
                let block = value.get("content_block");
                if let (Some(idx), Some(b)) = (idx, block) {
                    if b.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let id = b.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                        let name = b.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                        while self.tool_calls.len() <= idx {
                            self.tool_calls.push(ToolCallRequest::default());
                        }
                        self.tool_calls[idx] = ToolCallRequest {
                            id,
                            name,
                            arguments: String::new(),
                        };
                    }
                    self.current_block_idx = Some(idx);
                }
            }
            Some("content_block_delta") => {
                let delta = value.get("delta");
                if let Some(text) = delta
                    .and_then(|d| d.get("thinking"))
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        if self.ttft_ms.is_none() {
                            self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                        }
                        self.reasoning.push_str(text);
                        emit(text, "reasoning");
                    }
                }
                if let Some(text) = delta
                    .and_then(|d| d.get("text"))
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        if self.ttft_ms.is_none() {
                            self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                        }
                        self.content.push_str(text);
                        emit(text, "content");
                    }
                }
                if let (Some(idx), Some(args)) = (
                    self.current_block_idx,
                    delta
                        .and_then(|d| d.get("partial_json"))
                        .and_then(Value::as_str),
                ) {
                    if idx < self.tool_calls.len() && !args.is_empty() {
                        if self.ttft_ms.is_none() {
                            self.ttft_ms = Some(start.elapsed().as_millis() as i64);
                        }
                        self.tool_calls[idx].arguments.push_str(args);
                        emit(args, "tool_call");
                    }
                }
            }
            Some("content_block_stop") => {
                self.current_block_idx = None;
            }
            Some("message_delta") => {
                self.output_tokens = value
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(Value::as_i64)
                    .or(self.output_tokens);
            }
            _ => {}
        }
    }
}

pub struct AnthropicClient {
    pub base_url: String,
}

impl ProviderClient for AnthropicClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String> {
        let api_key = req
            .api_key
            .as_deref()
            .ok_or("Missing API key for provider request")?;

        // Anthropic uses content blocks: assistant turns may contain text +
        // tool_use blocks; user turns with role `tool` carry tool_result
        // blocks answering prior tool_use ids.
        let messages: Vec<Value> = req
            .messages
            .iter()
            .map(|m| {
                if m.role == "tool" {
                    // Tool result delivered as a user message with a tool_result block.
                    json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id,
                            "content": m.content,
                        }]
                    })
                } else if m.role == "assistant" && !m.tool_calls.is_empty() {
                    let mut blocks: Vec<Value> = Vec::new();
                    if !m.content.trim().is_empty() {
                        blocks.push(json!({ "type": "text", "text": m.content }));
                    }
                    for c in &m.tool_calls {
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": c.id,
                            "name": c.name,
                            "input": serde_json::from_str::<Value>(&c.arguments)
                                .unwrap_or_else(|_| json!({})),
                        }));
                    }
                    json!({ "role": "assistant", "content": blocks })
                } else {
                    json!({ "role": m.role, "content": m.content })
                }
            })
            .collect();

        let mut body = json!({
            "model": req.model_id,
            "max_tokens": 4096,
            "messages": messages,
            "stream": true,
        });
        if let Some(system) = req.system.as_deref() {
            if !system.trim().is_empty() {
                body["system"] = json!(system);
            }
        }
        // Tool schemas: Anthropic input_schema format.
        if !req.tools.is_empty() {
            let tools: Vec<Value> = req
                .tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters,
                    })
                })
                .collect();
            body["tools"] = json!(tools);
        }

        let url = format!("{}/messages", self.base_url.trim_end_matches('/'));
        let start = Instant::now();
        let resp = http_client()?
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Failed to reach provider: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            return Err(provider_http_error(status.as_u16(), "anthropic", &text));
        }
        let mut state = AnthropicStreamState::default();
        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("Stream read error: {e}"))?;
            state.process_line(&line, emit, &start);
        }

        let AnthropicStreamState {
            content,
            reasoning,
            ttft_ms,
            input_tokens,
            output_tokens,
            tool_calls,
            ..
        } = state;

        let duration_ms = (start.elapsed().as_millis() as i64).max(1);
        // A tool-call-only turn has no content/reasoning but is still valid.
        if content.trim().is_empty()
            && reasoning.trim().is_empty()
            && output_tokens.is_none()
            && tool_calls.is_empty()
        {
            return Err("Provider 'anthropic' returned an empty response.".to_string());
        }
        let persisted = if reasoning.trim().is_empty() {
            content
        } else {
            format!("{reasoning}\n\n---\n\n{content}")
        };
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&persisted))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content: persisted,
            tool_calls,
        })
    }
}

/// Build a concise, secret-free error message from an HTTP failure.
fn provider_http_error(status: u16, provider_id: &str, body: &str) -> String {
    let detail: String = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| v.get("error").and_then(Value::as_str).map(str::to_string))
        })
        .unwrap_or_else(|| {
            let trimmed = body.trim();
            if trimmed.len() > 200 {
                trimmed.chars().take(200).collect()
            } else {
                trimmed.to_string()
            }
        });
    match status {
        401 | 403 => format!(
            "Authentication failed ({status}) for '{provider_id}'. Reconnect the provider or check the API key."
        ),
        429 => format!("Rate limited ({status}) by '{provider_id}'. Try again shortly."),
        _ => format!("Provider '{provider_id}' request failed ({status}): {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_coordinator_is_labeled_offline() {
        let client = LocalCoordinator;
        let req = ProviderRequest {
            model_id: "basebuild-local-coordinator".to_string(),
            effort_level: "medium".to_string(),
            system: Some("Project: /tmp/demo".to_string()),
            messages: vec![ChatMsg { role: "user".to_string(), content: "hello there".to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None }],
            api_key: None,
            base_url: None,
            tools: Vec::new(),
        };
        let streamed = std::cell::RefCell::new(String::new());
        let resp = client
            .generate(&req, &|delta, _channel| streamed.borrow_mut().push_str(delta))
            .expect("local coordinator generate");
        assert!(resp.content.contains("Offline local coordinator"));
        assert_eq!(streamed.into_inner(), resp.content);
        assert!(resp.output_tokens.unwrap_or(0) > 0);
    }

    #[test]
    fn resolve_client_maps_provider_ids() {
        // Smoke check that construction does not panic for known ids.
        let _ = resolve_client(LOCAL_PROVIDER_ID, None);
        let _ = resolve_client("openai", None);
        let _ = resolve_client("anthropic", None);
        let _ = resolve_client("umans", Some("https://example.com/v1"));
    }

    #[test]
    fn http_error_never_leaks_body_for_auth() {
        let msg = provider_http_error(401, "openai", "{\"error\":{\"message\":\"secret-ish\"}}");
        assert!(msg.contains("Authentication failed"));
        assert!(!msg.contains("secret-ish"));
    }
    #[test]
    fn openai_assembles_fragmented_tool_call_deltas() {
        // OpenAI streams tool_calls across multiple deltas: the first carries
        // id + name, subsequent deltas append to `arguments` (here split mid-JSON).
        let lines = [
            r#"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}"#,
            r#"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]}}]}"#,
            r#"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"src/main.rs\"}"}}]}}]}"#,
            r#"data: {"choices":[{"index":0,"delta":{"content":"Let me read that file."}}]}"#,
            "data: [DONE]",
        ];
        let start = Instant::now();
        let mut state = OpenAiStreamState::default();
        let emitted: std::cell::RefCell<Vec<(String, String)>> = std::cell::RefCell::new(Vec::new());
        for line in &lines {
            state.process_line(line, &|d, ch| emitted.borrow_mut().push((d.to_string(), ch.to_string())), &start);
        }
        assert_eq!(state.content, "Let me read that file.");
        assert_eq!(state.tool_calls.len(), 1);
        let call = &state.tool_calls[0];
        assert_eq!(call.id, "call_1");
        assert_eq!(call.name, "read_file");
        assert_eq!(call.arguments, r#"{"path":"src/main.rs"}"#);
        let emitted = emitted.into_inner();
        let tool_call_emits: Vec<&(String, String)> = emitted
            .iter()
            .filter(|(_, ch)| ch == "tool_call")
            .collect();
        assert_eq!(tool_call_emits.len(), 2);
    }

    #[test]
    fn openai_tool_only_turn_is_valid() {
        // A turn that only issues a tool call (no content) must not be flagged empty.
        let lines = [
            r#"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_files","arguments":"{\"glob\":\"*.rs\"}"}}]}}]}"#,
            "data: [DONE]",
        ];
        let start = Instant::now();
        let mut state = OpenAiStreamState::default();
        for line in &lines {
            state.process_line(line, &|_, _| {}, &start);
        }
        assert!(state.content.is_empty());
        assert_eq!(state.tool_calls.len(), 1);
        assert_eq!(state.tool_calls[0].name, "list_files");
    }

    #[test]
    fn anthropic_assembles_tool_use_blocks() {
        // Anthropic streams tool_use via content_block_start + input_json_delta.
        let lines = [
            r#"data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}"#,
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Reading file."}}"#,
            r#"data: {"type":"content_block_stop","index":0}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"src/lib.rs\"}"}}"#,
            r#"data: {"type":"content_block_stop","index":1}"#,
            r#"data: {"type":"message_delta","usage":{"output_tokens":42}}"#,
        ];
        let start = Instant::now();
        let mut state = AnthropicStreamState::default();
        for line in &lines {
            state.process_line(line, &|_, _| {}, &start);
        }
        assert_eq!(state.content, "Reading file.");
        assert_eq!(state.input_tokens, Some(10));
        assert_eq!(state.output_tokens, Some(42));
        assert_eq!(state.tool_calls.len(), 2); // index 1 → slot 0 and 1
        let call = &state.tool_calls[1];
        assert_eq!(call.id, "toolu_1");
        assert_eq!(call.name, "read_file");
        assert_eq!(call.arguments, r#"{"path":"src/lib.rs"}"#);
    }

    #[test]
    fn anthropic_tool_only_turn_is_valid() {
        let lines = [
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_2","name":"list_files","input":{}}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"glob\":\"*.ts\"}"}}"#,
            r#"data: {"type":"content_block_stop","index":0}"#,
        ];
        let start = Instant::now();
        let mut state = AnthropicStreamState::default();
        for line in &lines {
            state.process_line(line, &|_, _| {}, &start);
        }
        assert!(state.content.is_empty());
        assert_eq!(state.tool_calls[0].name, "list_files");
        assert_eq!(state.tool_calls[0].arguments, r#"{"glob":"*.ts"}"#);
    }
}

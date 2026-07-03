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
#[derive(Debug, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
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
}

/// The result of a completed provider turn.
#[derive(Debug, Clone, Default)]
pub struct ProviderResponse {
    pub content: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub duration_ms: i64,
}

/// Dispatches a resolved request, streaming content deltas through `emit`.
pub trait ProviderClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str),
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
                .unwrap_or_else(|| "https://api.umans.ai/v1".to_string()),
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
        emit: &dyn Fn(&str),
    ) -> Result<ProviderResponse, String> {
        let start = Instant::now();
        let text = LocalCoordinator::compose(
            req.system.as_deref(),
            &req.messages,
            &req.model_id,
            &req.effort_level,
        );
        emit(&text);
        let elapsed = start.elapsed().as_millis() as i64;
        Ok(ProviderResponse {
            input_tokens: Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum()),
            output_tokens: Some(estimate_tokens(&text)),
            ttft_ms: Some(elapsed),
            duration_ms: elapsed.max(1),
            content: text,
        })
    }
}

// ─── OpenAI-compatible (OpenAI, Umans) ───

pub struct OpenAiCompatibleClient {
    pub provider_id: String,
    pub base_url: String,
}

impl ProviderClient for OpenAiCompatibleClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str),
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

        let mut content = String::new();
        let mut ttft_ms: Option<i64> = None;
        let mut input_tokens: Option<i64> = None;
        let mut output_tokens: Option<i64> = None;

        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("Stream read error: {e}"))?;
            let data = match line.strip_prefix("data:") {
                Some(rest) => rest.trim(),
                None => continue,
            };
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                break;
            }
            let value: Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
                input_tokens = usage.get("prompt_tokens").and_then(Value::as_i64).or(input_tokens);
                output_tokens = usage
                    .get("completion_tokens")
                    .and_then(Value::as_i64)
                    .or(output_tokens);
            }
            if let Some(delta) = value
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(Value::as_str)
            {
                if !delta.is_empty() {
                    if ttft_ms.is_none() {
                        ttft_ms = Some(start.elapsed().as_millis() as i64);
                    }
                    content.push_str(delta);
                    emit(delta);
                }
            }
        }

        let duration_ms = (start.elapsed().as_millis() as i64).max(1);
        if content.trim().is_empty() && output_tokens.is_none() {
            return Err(format!(
                "Provider '{}' returned an empty response.",
                self.provider_id
            ));
        }
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&content))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content,
        })
    }
}

// ─── Anthropic ───

pub struct AnthropicClient {
    pub base_url: String,
}

impl ProviderClient for AnthropicClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str),
    ) -> Result<ProviderResponse, String> {
        let api_key = req
            .api_key
            .as_deref()
            .ok_or("Missing API key for provider request")?;

        let messages: Vec<Value> = req
            .messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
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

        let mut content = String::new();
        let mut ttft_ms: Option<i64> = None;
        let mut input_tokens: Option<i64> = None;
        let mut output_tokens: Option<i64> = None;

        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("Stream read error: {e}"))?;
            let data = match line.strip_prefix("data:") {
                Some(rest) => rest.trim(),
                None => continue,
            };
            if data.is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match value.get("type").and_then(Value::as_str) {
                Some("message_start") => {
                    input_tokens = value
                        .get("message")
                        .and_then(|m| m.get("usage"))
                        .and_then(|u| u.get("input_tokens"))
                        .and_then(Value::as_i64)
                        .or(input_tokens);
                }
                Some("content_block_delta") => {
                    if let Some(text) = value
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(Value::as_str)
                    {
                        if !text.is_empty() {
                            if ttft_ms.is_none() {
                                ttft_ms = Some(start.elapsed().as_millis() as i64);
                            }
                            content.push_str(text);
                            emit(text);
                        }
                    }
                }
                Some("message_delta") => {
                    output_tokens = value
                        .get("usage")
                        .and_then(|u| u.get("output_tokens"))
                        .and_then(Value::as_i64)
                        .or(output_tokens);
                }
                Some("error") => {
                    let msg = value
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown provider error");
                    return Err(format!("Anthropic error: {msg}"));
                }
                _ => {}
            }
        }

        let duration_ms = (start.elapsed().as_millis() as i64).max(1);
        if content.trim().is_empty() && output_tokens.is_none() {
            return Err("Provider 'anthropic' returned an empty response.".to_string());
        }
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&content))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content,
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
            messages: vec![ChatMsg { role: "user".to_string(), content: "hello there".to_string() }],
            api_key: None,
            base_url: None,
        };
        let streamed = std::cell::RefCell::new(String::new());
        let resp = client
            .generate(&req, &|delta| streamed.borrow_mut().push_str(delta))
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
}

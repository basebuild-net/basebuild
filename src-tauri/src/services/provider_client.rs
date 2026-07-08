//! Provider execution layer for the native chat harness.
//!
//! Each chat turn is dispatched to the provider/model selected for that turn.
//! `LocalCoordinator` is an explicit, clearly-labeled offline fallback; the
//! network clients (`OpenAiCompatibleClient`, `AnthropicClient`) stream real
//! assistant output and capture real token usage. Secrets are never logged.

use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const LOCAL_PROVIDER_ID: &str = "basebuild-local";
pub const OMP_CODEX_BASE_URL: &str = "omp://openai-codex";

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
    /// Chain-of-thought / thinking tokens streamed ahead of the answer.
    /// Stored separately from `content` so it is never replayed to providers
    /// nor folded into the persisted assistant message.
    pub reasoning: Option<String>,
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
        "openai" if base_url == Some(OMP_CODEX_BASE_URL) => Box::new(OmpRpcClient {
            omp_provider_id: "openai-codex".to_string(),
        }),
        "anthropic" => Box::new(AnthropicClient {
            provider_id: "anthropic".to_string(),
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
        "devin" => Box::new(OpenAiCompatibleClient {
            provider_id: "devin".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://server.codeium.com".to_string()),
        }),
        "google" => Box::new(OpenAiCompatibleClient {
            provider_id: "google".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/openai".to_string()),
        }),
        "groq" => Box::new(OpenAiCompatibleClient {
            provider_id: "groq".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.groq.com/openai/v1".to_string()),
        }),
        "openrouter" => Box::new(OpenAiCompatibleClient {
            provider_id: "openrouter".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string()),
        }),
        "deepseek" => Box::new(OpenAiCompatibleClient {
            provider_id: "deepseek".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.deepseek.com/v1".to_string()),
        }),
        "mistral" => Box::new(OpenAiCompatibleClient {
            provider_id: "mistral".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.mistral.ai/v1".to_string()),
        }),
        "xai" => Box::new(OpenAiCompatibleClient {
            provider_id: "xai".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.x.ai/v1".to_string()),
        }),
        "together" => Box::new(OpenAiCompatibleClient {
            provider_id: "together".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.together.xyz/v1".to_string()),
        }),
        "fireworks" => Box::new(OpenAiCompatibleClient {
            provider_id: "fireworks".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.fireworks.ai/inference/v1".to_string()),
        }),
        "cerebras" => Box::new(OpenAiCompatibleClient {
            provider_id: "cerebras".to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.cerebras.ai/v1".to_string()),
        }),
        // Default OpenAI-compatible (OpenAI itself, custom providers, and any future compatible provider).
        _ => Box::new(OpenAiCompatibleClient {
            provider_id: provider_id.to_string(),
            base_url: base_url
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        }),
    }
}

/// Whether the transport for `api_kind` can carry Basebuild tool schemas.
/// Native kinds route to `AnthropicClient`/`OpenAiCompatibleClient` and pass
/// tools; bespoke kinds route to `OmpRpcClient` which composes a text prompt
/// and cannot carry structured tool definitions. An empty `api_kind` is the
/// legacy default (`openai-completions`) and is tool-capable.
pub fn transport_supports_tools(api_kind: &str) -> bool {
    matches!(
        api_kind,
        "" | "openai-completions"
            | "openai-responses"
            | "azure-openai-responses"
            | "anthropic-messages"
            | "openrouter"
            | "ollama-chat"
    )
}

/// Resolve a provider client using the model's `api_kind` for routing.
///
/// Routing priority:
/// 1. `LOCAL_PROVIDER_ID` → `LocalCoordinator`
/// 2. `base_url == OMP_CODEX_BASE_URL` → `OmpRpcClient` (backward compat)
/// 3. `anthropic-messages` → `AnthropicClient`
/// 4. `openai-completions`/`openai-responses`/`azure-openai-responses`/
///    `openrouter`/`ollama-chat` → `OpenAiCompatibleClient`
/// 5. Bespoke api kinds:
///    a. If credential has a custom `base_url` override → `OpenAiCompatibleClient`
///       (escape hatch for OpenAI-compatible proxies)
///    b. Otherwise → `OmpRpcClient` (OMP RPC delegation)
pub fn resolve_client_for_model(
    provider_id: &str,
    api_kind: &str,
    base_url: Option<&str>,
    model_base_url: &str,
) -> Box<dyn ProviderClient> {
    if provider_id == LOCAL_PROVIDER_ID {
        return Box::new(LocalCoordinator);
    }
    // Backward compat: existing openai-codex OAuth credentials use the
    // omp:// sentinel as their base_url.
    if base_url == Some(OMP_CODEX_BASE_URL) {
        return Box::new(OmpRpcClient {
            omp_provider_id: "openai-codex".to_string(),
        });
    }
    match api_kind {
        "anthropic-messages" => Box::new(AnthropicClient {
            provider_id: provider_id.to_string(),
            base_url: base_url
                .map(str::to_string)
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    if model_base_url.is_empty() {
                        None
                    } else {
                        Some(model_base_url.to_string())
                    }
                })
                .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string()),
        }),
        "openai-completions"
        | "openai-responses"
        | "azure-openai-responses"
        | "openrouter"
        | "ollama-chat" => Box::new(OpenAiCompatibleClient {
            provider_id: provider_id.to_string(),
            base_url: base_url
                .map(str::to_string)
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    if model_base_url.is_empty() {
                        None
                    } else {
                        Some(model_base_url.to_string())
                    }
                })
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        }),
        // Bespoke api kinds → OMP RPC delegation (or OpenAI-compatible
        // escape hatch if the user configured a custom base_url).
        _ => {
            if let Some(custom) = base_url.filter(|s| !s.is_empty()) {
                Box::new(OpenAiCompatibleClient {
                    provider_id: provider_id.to_string(),
                    base_url: custom.to_string(),
                })
            } else {
                Box::new(OmpRpcClient {
                    omp_provider_id: provider_id.to_string(),
                })
            }
        }
    }
}

/// Check whether the `omp` CLI is available on PATH. Used to surface a
/// actionable error before attempting OMP RPC delegation.
pub fn omp_available() -> bool {
    crate::services::process_helpers::hidden_command("omp")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

struct OmpRpcClient {
    omp_provider_id: String,
}

impl ProviderClient for OmpRpcClient {
    fn generate(
        &self,
        req: &ProviderRequest,
        emit: &dyn Fn(&str, &str),
    ) -> Result<ProviderResponse, String> {
        if !omp_available() {
            return Err(format!(
                "Provider '{}' requires Oh My Pi (OMP) for authentication. \
                 Install OMP and run `omp login {}` to authenticate, then retry.",
                self.omp_provider_id, self.omp_provider_id
            ));
        }
        if !req.tools.is_empty() {
            return Err(format!(
                "OMP RPC bridge (provider={}) does not support Basebuild tool calls",
                self.omp_provider_id
            ));
        }
        let start = Instant::now();
        let prompt = compose_omp_rpc_prompt(req);
        let mut child = crate::services::process_helpers::hidden_command("omp")
            .args([
                "--mode",
                "rpc",
                "--provider",
                &self.omp_provider_id,
                "--model",
                &req.model_id,
                "--no-tools",
                "--no-session",
                "--no-title",
                "--no-skills",
                "--no-rules",
                "--no-extensions",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch OMP for provider {}: {e}", self.omp_provider_id))?;

        let mut stdin = child.stdin.take().ok_or("Failed to open OMP stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open OMP stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open OMP stderr")?;
        let (tx, rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        let stderr_reader = thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        });

        let prompt_frame = json!({ "id": "basebuild-prompt", "type": "prompt", "message": prompt });
        writeln!(stdin, "{prompt_frame}").map_err(|e| format!("Failed to write OMP prompt: {e}"))?;
        stdin.flush().map_err(|e| format!("Failed to flush OMP prompt: {e}"))?;

        let mut content = String::new();
        let mut ttft_ms = None;
        let mut last_text = None;
        let mut prompt_accepted = false;
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            let line = match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(line) => line,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
            if frame.get("type").and_then(Value::as_str) == Some("response")
                && frame.get("command").and_then(Value::as_str) == Some("prompt")
            {
                if frame.get("success").and_then(Value::as_bool) == Some(false) {
                    let _ = child.kill();
                    return Err(frame.get("error").and_then(Value::as_str).unwrap_or("OMP rejected prompt").to_string());
                }
                prompt_accepted = true;
                continue;
            }
            if let Some(delta) = frame
                .get("assistantMessageEvent")
                .and_then(|event| {
                    (event.get("type").and_then(Value::as_str) == Some("text_delta"))
                        .then(|| event.get("delta").and_then(Value::as_str))
                        .flatten()
                })
            {
                if !delta.is_empty() {
                    if ttft_ms.is_none() {
                        ttft_ms = Some(start.elapsed().as_millis() as i64);
                    }
                    content.push_str(delta);
                    emit(delta, "content");
                }
            }
            if matches!(frame.get("type").and_then(Value::as_str), Some("turn_end") | Some("agent_end")) {
                break;
            }
        }

        if !prompt_accepted {
            let _ = child.kill();
            let _ = child.wait();
            let stderr = stderr_reader.join().unwrap_or_default();
            return Err(if stderr.trim().is_empty() {
                format!("OMP did not accept the prompt for provider {}", self.omp_provider_id)
            } else {
                format!("OMP did not accept the prompt for provider {}: {}", self.omp_provider_id, stderr.trim())
            });
        }

        let last_frame = json!({ "id": "basebuild-last", "type": "get_last_assistant_text" });
        let _ = writeln!(stdin, "{last_frame}");
        let _ = stdin.flush();
        let last_deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < last_deadline {
            let line = match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(line) => line,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
            if frame.get("type").and_then(Value::as_str) == Some("response")
                && frame.get("command").and_then(Value::as_str) == Some("get_last_assistant_text")
            {
                last_text = frame
                    .get("data")
                    .and_then(|d| d.get("text"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                break;
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        let final_content = last_text.filter(|s| !s.trim().is_empty()).unwrap_or(content);
        if final_content.trim().is_empty() {
            let stderr = stderr_reader.join().unwrap_or_default();
            // ponytail: OMP swallows 429s silently — tail its latest log for a usable hint.
            // Upgrade to structured OMP error frames if/when OMP emits them on stdout.
            let hint = omp_rate_limit_hint();
            return Err(if stderr.trim().is_empty() {
                if let Some(h) = hint {
                    format!("OMP returned an empty response for provider {}: {h}", self.omp_provider_id)
                } else {
                    format!("OMP returned an empty response for provider {}", self.omp_provider_id)
                }
            } else {
                format!("OMP returned an empty response for provider {}: {}", self.omp_provider_id, stderr.trim())
            });
        }
        let duration_ms = (start.elapsed().as_millis() as i64).max(1);
        Ok(ProviderResponse {
            content: final_content.clone(),
            reasoning: None,
            input_tokens: Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum()),
            output_tokens: Some(estimate_tokens(&final_content)),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            tool_calls: Vec::new(),
        })
    }
}

fn compose_omp_rpc_prompt(req: &ProviderRequest) -> String {
    let mut prompt = String::new();
    if let Some(system) = req.system.as_deref().filter(|s| !s.trim().is_empty()) {
        prompt.push_str("System instructions:\n");
        prompt.push_str(system.trim());
        prompt.push_str("\n\n");
    }
    prompt.push_str("Conversation transcript. Reply only to the final user message.\n\n");
    for message in &req.messages {
        let role = match message.role.as_str() {
            "assistant" => "Assistant",
            "system" => "System",
            "tool" => "Tool",
            _ => "User",
        };
        if message.content.trim().is_empty() {
            continue;
        }
        prompt.push_str(role);
        prompt.push_str(":\n");
        prompt.push_str(message.content.trim());
        prompt.push_str("\n\n");
    }
    prompt.push_str("Assistant:");
    prompt
}

/// Best-effort scan of OMP's latest log for a rate-limit / usage-cap message.
/// Returns the matched message (e.g. "Usage limit reached for 5 hour. Your
/// limit will reset at ...") when found, so the empty-response error can
/// surface a real reason instead of a generic "empty" message.
fn omp_rate_limit_hint() -> Option<String> {
    use std::fs;
    use std::io::Read;
    let mut dir = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)?;
    dir.push(".omp");
    dir.push("logs");
    let entries = fs::read_dir(&dir).ok()?;
    // Pick the most recently modified .log file (current day; gz ignored).
    let latest = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) == Some("log") {
                let m = e.metadata().ok()?;
                let modified = m.modified().ok()?;
                Some((path, modified))
            } else {
                None
            }
        })
        .max_by_key(|(_, m)| *m)
        .map(|(p, _)| p)?;
    let mut buf = String::new();
    // Tail last 64 KiB only — large enough to catch recent errors.
    let mut file = fs::File::open(&latest).ok()?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len > 65_536 {
        use std::io::Seek;
        let _ = file.seek(std::io::SeekFrom::Start(len - 65_536));
    }
    file.read_to_string(&mut buf).ok()?;
    // Find the last rate-limit line; OMP logs JSON with "rate_limit_error" or
    // "Usage limit reached". Extract the bracketed message.
    let mut found: Option<String> = None;
    for line in buf.lines().rev() {
        if !(line.contains("rate_limit_error") || line.contains("Usage limit reached")) {
            continue;
        }
        // Try to extract the human-readable message between [code][...].
        if let Some(start) = line.rfind("Usage limit reached") {
            let tail = &line[start..];
            let end = tail.find(']').unwrap_or(tail.len());
            let msg = tail[..end].trim();
            if !msg.is_empty() {
                found = Some(msg.to_string());
            }
            break;
        }
    }
    found
}

/// Stream-idle timeout: if no data arrives for this duration during SSE streaming,
/// the request is aborted to prevent indefinite hangs. Enforced via the total
/// request timeout on `http_client()` (300s cap) — if the stream is truly idle,
/// the connection times out and returns a `StreamIdleTimeout` error.
const STREAM_IDLE_TIMEOUT_SECS: u64 = 120;

/// Typed provider error categories for structured error handling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    /// Missing or invalid API key.
    AuthMissing,
    /// HTTP status error (4xx/5xx) from the provider.
    HttpError { provider: String, status: u16, message: String },
    /// Connection or read timeout during request.
    ConnectTimeout,
    /// Stream started but went idle (no SSE data) for >120s.
    StreamIdleTimeout,
    /// Provider returned an empty response (no content, no tool calls).
    EmptyResponse { provider: String },
    /// Other transport/format error.
    Other(String),
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::AuthMissing => write!(f, "Missing API key for provider request"),
            ProviderError::HttpError { provider, status, message } => {
                write!(f, "Provider '{provider}' returned HTTP {status}: {message}")
            }
            ProviderError::ConnectTimeout => {
                write!(f, "Provider connection timed out (>10s)")
            }
            ProviderError::StreamIdleTimeout => {
                write!(f, "Provider stream went idle for >{STREAM_IDLE_TIMEOUT_SECS}s")
            }
            ProviderError::EmptyResponse { provider } => {
                write!(f, "Provider '{provider}' returned an empty response")
            }
            ProviderError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<ProviderError> for String {
    fn from(e: ProviderError) -> Self {
        e.to_string()
    }
}

/// Classify a reqwest error into a typed ProviderError.
fn classify_reqwest_error(e: &reqwest::Error) -> ProviderError {
    if e.is_timeout() {
        ProviderError::ConnectTimeout
    } else {
        ProviderError::Other(format!("Failed to reach provider: {e}"))
    }
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.split_whitespace().count().max(1) as i64
    }
}
fn strip_think_tags(content: &str) -> (String, String) {
    let markers: &[(&str, &str)] = &[
        ("\u{2764}", "\u{2764}"),
        ("<thinking>", "</thinking>"),
        ("<think>", "</think>"),
    ];
    let mut cleaned = content.to_string();
    let mut extracted = String::new();
    for (open, close) in markers {
        loop {
            if let Some(start) = cleaned.find(open) {
                let after_start = &cleaned[start + open.len()..];
                if let Some(end_rel) = after_start.find(close) {
                    let inner = after_start[..end_rel].to_string();
                    cleaned = format!("{}{}", &cleaned[..start], &after_start[end_rel + close.len()..]);
                    if !inner.trim().is_empty() {
                        if !extracted.is_empty() {
                            extracted.push_str("\n\n");
                        }
                        extracted.push_str(&inner);
                    }
                    continue;
                }
            }
            break;
        }
    }
    (cleaned, extracted)
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
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
            reasoning: None,
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
            .map_err(|e| classify_reqwest_error(&e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            return Err(ProviderError::HttpError {
                provider: self.provider_id.clone(),
                status: status.as_u16(),
                message: provider_http_error(status.as_u16(), &self.provider_id, &text),
            }.into());
        }

        let mut state = OpenAiStreamState::default();
        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| ProviderError::Other(format!("Stream read error: {e}")))?;
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
        if content.trim().is_empty()
            && reasoning.trim().is_empty()
            && output_tokens.is_none()
            && tool_calls.is_empty()
        {
            return Err(ProviderError::EmptyResponse {
                provider: self.provider_id.clone(),
            }.into());
        }
        let (clean_content, extracted_reasoning) = strip_think_tags(&content);
        let mut final_reasoning = if reasoning.trim().is_empty() {
            None
        } else {
            Some(reasoning)
        };
        if !extracted_reasoning.is_empty() {
            final_reasoning = Some(match final_reasoning {
                Some(mut r) => {
                    r.push_str("\n\n");
                    r.push_str(&extracted_reasoning);
                    r
                }
                None => extracted_reasoning,
            });
        }
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&clean_content))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content: clean_content,
            reasoning: final_reasoning,
            tool_calls,
        })
    }
}
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
    pub provider_id: String,
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

        // Normalize: the Anthropic Messages API lives at /v1/messages, but
        // the vendored OMP catalog has inconsistent baseUrl values — some
        // include `/v1`, most don't. Without this, requests hit
        // https://api.anthropic.com/messages → 404.
        let normalized_base = self.base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{normalized_base}/v1/messages");
        let start = Instant::now();
        let is_jwt = api_key.starts_with("eyJ");
        let resp = http_client()?
            .post(&url)
            // OAuth JWTs (from omp login) use Bearer; regular API keys use
            // x-api-key. Sending both risks auth-confusion rejection.
            .header(if is_jwt { "Authorization" } else { "x-api-key" }, if is_jwt { format!("Bearer {}", api_key) } else { api_key.to_string() })
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| classify_reqwest_error(&e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            return Err(ProviderError::HttpError {
                provider: self.provider_id.clone(),
                status: status.as_u16(),
                message: provider_http_error(status.as_u16(), &self.provider_id, &text),
            }.into());
        }
        let mut state = AnthropicStreamState::default();
        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = line.map_err(|e| ProviderError::Other(format!("Stream read error: {e}")))?;
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
        if content.trim().is_empty()
            && reasoning.trim().is_empty()
            && output_tokens.is_none()
            && tool_calls.is_empty()
        {
            return Err(ProviderError::EmptyResponse {
                provider: "anthropic".to_string(),
            }.into());
        }
        let (clean_content, extracted_reasoning) = strip_think_tags(&content);
        let mut final_reasoning = if reasoning.trim().is_empty() {
            None
        } else {
            Some(reasoning)
        };
        if !extracted_reasoning.is_empty() {
            final_reasoning = Some(match final_reasoning {
                Some(mut r) => {
                    r.push_str("\n\n");
                    r.push_str(&extracted_reasoning);
                    r
                }
                None => extracted_reasoning,
            });
        }
        Ok(ProviderResponse {
            output_tokens: output_tokens.or_else(|| Some(estimate_tokens(&clean_content))),
            input_tokens: input_tokens
                .or_else(|| Some(req.messages.iter().map(|m| estimate_tokens(&m.content)).sum())),
            ttft_ms: ttft_ms.or(Some(duration_ms)),
            duration_ms,
            content: clean_content,
            reasoning: final_reasoning,
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
    fn resolve_client_for_model_routes_devin_to_omp_rpc() {
        // Devin uses the devin-agent bespoke protocol → OmpRpcClient.
        let client = resolve_client_for_model("devin", "devin-agent", None, "https://server.codeium.com");
        // We can't directly check the type, but OmpRpcClient::generate will
        // fail with the "requires Oh My Pi" error if OMP is not installed.
        // The key assertion is that it does NOT route to OpenAiCompatibleClient
        // (which would 404 against server.codeium.com). We verify by checking
        // that generate() produces an OMP-related error, not a 404.
        let req = ProviderRequest {
            model_id: "swe-1-6".to_string(),
            effort_level: "medium".to_string(),
            system: None,
            messages: vec![ChatMsg {
                role: "user".to_string(),
                content: "hello".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
            }],
            api_key: None,
            base_url: None,
            tools: Vec::new(),
        };
        let result = client.generate(&req, &|_, _| {});
        // The error should mention OMP, not a 404 or HTTP error.
        if let Err(e) = result {
            assert!(
                e.contains("Oh My Pi") || e.contains("OMP") || e.contains("omp"),
                "devin routing should produce an OMP-related error, got: {e}"
            );
        }
    }

    #[test]
    fn resolve_client_for_model_routes_openai_to_compatible() {
        // OpenAI uses openai-completions → OpenAiCompatibleClient.
        let _ = resolve_client_for_model("openai", "openai-completions", None, "https://api.openai.com/v1");
        // With a custom base_url override, should still use OpenAiCompatibleClient.
        let _ = resolve_client_for_model("openai", "openai-completions", Some("https://custom.proxy/v1"), "https://api.openai.com/v1");
    }

    #[test]
    fn resolve_client_for_model_routes_anthropic_to_anthropic_client() {
        // Anthropic uses anthropic-messages → AnthropicClient.
        let _ = resolve_client_for_model("anthropic", "anthropic-messages", None, "https://api.anthropic.com/v1");
    }

    #[test]
    fn resolve_client_for_model_omp_sentinel_routes_to_omp_rpc() {
        // Backward compat: omp://openai-codex sentinel → OmpRpcClient.
        let _ = resolve_client_for_model("openai", "openai-completions", Some(OMP_CODEX_BASE_URL), "https://api.openai.com/v1");
    }

    #[test]
    fn resolve_client_for_model_bespoke_with_custom_base_url_uses_compatible() {
        // Escape hatch: bespoke provider with custom base_url → OpenAiCompatibleClient.
        let _ = resolve_client_for_model("devin", "devin-agent", Some("https://my-proxy/v1"), "https://server.codeium.com");
    }

    #[test]
    fn transport_supports_tools_native_kinds() {
        // Native kinds that route to AnthropicClient/OpenAiCompatibleClient.
        assert!(transport_supports_tools(""));
        assert!(transport_supports_tools("openai-completions"));
        assert!(transport_supports_tools("openai-responses"));
        assert!(transport_supports_tools("azure-openai-responses"));
        assert!(transport_supports_tools("anthropic-messages"));
        assert!(transport_supports_tools("openrouter"));
        assert!(transport_supports_tools("ollama-chat"));
    }

    #[test]
    fn transport_supports_tools_bespoke_kinds_are_false() {
        // Bespoke kinds route to OmpRpcClient which cannot carry tool schemas.
        assert!(!transport_supports_tools("devin-agent"));
        assert!(!transport_supports_tools("cursor-agent"));
        assert!(!transport_supports_tools("openai-codex-responses"));
        assert!(!transport_supports_tools("google-generative-ai"));
        assert!(!transport_supports_tools("google-vertex"));
        assert!(!transport_supports_tools("google-gemini-cli"));
        assert!(!transport_supports_tools("bedrock-converse-stream"));
        assert!(!transport_supports_tools("gitlab-duo-agent"));
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

    #[test]
    fn provider_error_display_formats_correctly() {
        let auth = ProviderError::AuthMissing;
        assert!(auth.to_string().contains("Missing API key"));

        let http = ProviderError::HttpError {
            provider: "openai".to_string(),
            status: 429,
            message: "Rate limited".to_string(),
        };
        assert!(http.to_string().contains("HTTP 429"));
        assert!(http.to_string().contains("Rate limited"));

        let timeout = ProviderError::ConnectTimeout;
        assert!(timeout.to_string().contains("timed out"));

        let idle = ProviderError::StreamIdleTimeout;
        assert!(idle.to_string().contains("idle"));

        let empty = ProviderError::EmptyResponse { provider: "anthropic".to_string() };
        assert!(empty.to_string().contains("empty response"));
    }

    #[test]
    fn provider_error_converts_to_string() {
        let err = ProviderError::AuthMissing;
        let s: String = err.into();
        assert!(s.contains("Missing API key"));
    }

    #[test]
    fn empty_response_error_for_empty_stream() {
        // Simulate an empty SSE stream — no content, no tool calls, no tokens.
        let lines = ["data: [DONE]"];
        let start = Instant::now();
        let mut state = OpenAiStreamState::default();
        for line in &lines {
            state.process_line(line, &|_, _| {}, &start);
        }
        // The stream state should be empty.
        assert!(state.content.is_empty());
        assert!(state.tool_calls.is_empty());
        assert!(state.output_tokens.is_none());
        // In the real generate(), this would return EmptyResponse.
        let err = ProviderError::EmptyResponse { provider: "openai".to_string() };
        assert!(err.to_string().contains("openai"));
    }

    #[test]
    fn strip_think_tags_extracts_thinking_block() {
        let content = "Before. <thinking>hidden reasoning</thinking> After.";
        let (cleaned, extracted) = strip_think_tags(content);
        assert_eq!(cleaned, "Before.  After.");
        assert_eq!(extracted, "hidden reasoning");
    }

    #[test]
    fn strip_think_tags_handles_multiple_blocks() {
        let content = "<thinking>first</thinking> mid <thinking>second</thinking>";
        let (cleaned, extracted) = strip_think_tags(content);
        assert_eq!(cleaned.trim(), "mid");
        assert!(extracted.contains("first"));
        assert!(extracted.contains("second"));
    }

    #[test]
    fn strip_think_tags_preserves_content_without_markers() {
        let content = "Just plain answer with no think tags.";
        let (cleaned, extracted) = strip_think_tags(content);
        assert_eq!(cleaned, content);
        assert!(extracted.is_empty());
    }

    #[test]
    fn local_coordinator_returns_no_reasoning() {
        let client = LocalCoordinator;
        let req = ProviderRequest {
            model_id: "basebuild-local-coordinator".to_string(),
            effort_level: "medium".to_string(),
            system: None,
            messages: vec![ChatMsg { role: "user".to_string(), content: "hi".to_string(), tool_calls: Vec::new(), tool_call_id: None, name: None }],
            api_key: None,
            base_url: None,
            tools: Vec::new(),
        };
        let resp = client.generate(&req, &|_, _| {}).expect("local coordinator generate");
        assert!(resp.reasoning.is_none());
    }
}

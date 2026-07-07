use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatSession {
    pub id: String,
    pub project_path: String,
    pub title: String,
    pub profile_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub effort_level: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub sort_order: i64,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub effort_level: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolEvent {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub summary: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderCatalog {
    pub providers: Vec<NativeProvider>,
    pub models: Vec<NativeModel>,
    pub effort_levels: Vec<NativeEffortLevel>,
    pub default_provider_id: String,
    pub default_model_id: String,
    pub default_effort_level: String,
    pub fetched_at: i64,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProvider {
    pub id: String,
    pub label: String,
    pub status: String,
    pub credential_owner: String,
    pub configured: bool,
    pub local_only: bool,
    pub detail: String,
    pub auth_method: String,
    pub api_key_url: Option<String>,
    pub model_count: i64,
    pub last_synced_at: Option<i64>,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderCredential {
    pub provider_id: String,
    pub label: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderCredentialInput {
    pub provider_id: String,
    pub label: String,
    pub api_key: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeModel {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub supports_effort: bool,
    pub supports_streaming: bool,
    /// Whether the model accepts tool schemas (function calling). False for
    /// the local coordinator; true for network providers by default.
    pub supports_tools: bool,
    pub local_only: bool,
    pub context_window: Option<i64>,
    pub max_tokens: Option<i64>,
    pub supports_reasoning: bool,
    pub supported_efforts: Vec<String>,
    pub supports_images: bool,
    pub source: String,
    /// Provider-specific model API id (e.g. "umans-glm-5.2") sent in the
    /// provider's chat request body. Null for legacy bundled/discovered rows;
    /// callers fall back to `id` when null. Populated by catalog sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_api_id: Option<String>,
    /// Wire-protocol kind from the OMP catalog: `openai-completions`,
    /// `anthropic-messages`, `devin-agent`, `openai-codex-responses`,
    /// `cursor-agent`, `google-generative-ai`, `google-vertex`,
    /// `google-gemini-cli`, `bedrock-converse-stream`, `ollama-chat`,
    /// `openrouter`, `openai-responses`, `azure-openai-responses`,
    /// `gitlab-duo-agent`. Empty for legacy rows; `resolve_client` treats
    /// an empty kind as `openai-completions` (the historical default).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub api_kind: String,
    /// The model's API base URL from the OMP catalog (e.g.
    /// `https://server.codeium.com` for devin). Empty for legacy rows and
    /// for providers whose base URL is credential-driven.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub base_url: String,
    /// Per-million-token input cost (USD), from the OMP catalog. Null when
    /// unknown (legacy rows, discovered models without cost metadata).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_input: Option<f64>,
    /// Per-million-token output cost (USD), from the OMP catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_output: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEffortLevel {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderCatalogRefreshRequest {
    pub provider_id: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatStartRequest {
    pub project_path: String,
    pub title: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub effort_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatSendRequest {
    pub session_id: String,
    pub content: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub effort_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatSendResult {
    pub user_message: NativeChatMessage,
    pub assistant_message: Option<NativeChatMessage>,
    pub metrics: Option<NativeRequestMetric>,
    pub tool_events: Vec<NativeToolEvent>,
    /// Present when the chosen provider has no stored credential. The composer
    /// renders this as an inline connect prompt without discarding the draft.
    pub setup_required: Option<NativeSetupRequired>,
    /// True when the turn was handled by the offline local coordinator rather
    /// than an external provider.
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSetupRequired {
    pub provider_id: String,
    pub provider_label: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGenerateIdeasRequest {
    pub session_id: String,
    pub schematic: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub effort_level: Option<String>,
    /// Optional category id for category-directed generation. When present,
    /// the prompt is grounded in the category's name/description and captured
    /// ideas are tagged with this id.
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGeneratedIdea {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGenerateIdeasResult {
    pub ideas: Vec<NativeGeneratedIdea>,
    pub setup_required: Option<NativeSetupRequired>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRequestMetric {
    pub id: String,
    pub session_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub effort_level: String,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub ttlt_ms: Option<i64>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub tokens_per_second: Option<f64>,
    pub cost_total: Option<f64>,
    pub outcome: String,
    pub error_class: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRequestMetricsSummary {
    pub total_requests: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub avg_tokens_per_second: Option<f64>,
    pub avg_ttft_ms: Option<f64>,
    pub avg_ttlt_ms: Option<f64>,
    pub last_provider_id: Option<String>,
    pub last_model_id: Option<String>,
    pub last_effort_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolApprovalRequest {
    pub action: String,
    pub scope: Option<String>,
    pub source_workflow: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolApprovalResult {
    pub decision: String,
    pub requires_prompt: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLoginStart {
    pub provider_id: String,
    pub provider_label: String,
    /// Loopback landing page opened in the system browser to capture the token.
    pub landing_url: String,
    /// The provider's own key/authorization page linked from the landing page.
    pub provider_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLoginPoll {
    /// One of: "pending", "success", "error", "cancelled".
    pub status: String,
    pub message: Option<String>,
}

/// Persisted chat model default (provider/model/effort triple). Stored per
/// project; a global default lives in `app_defaults` under the key
/// `chat.defaultModel`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatModelDefault {
    pub provider_id: String,
    pub model_id: String,
    pub effort_level: String,
}

/// Resolved default for a project, with provenance for UI display. Falls back
/// through project → global → first connected provider/model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedChatModelDefault {
    pub provider_id: String,
    pub model_id: String,
    pub effort_level: String,
    /// Where the resolved value came from: "project", "global", or
    /// "fallback" (first connected provider's default model).
    pub source: String,
    /// Non-empty when the stored default was unavailable (disconnected
    /// provider or missing model) and a fallback was used instead.
    pub notice: Option<String>,
}

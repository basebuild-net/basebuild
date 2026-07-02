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
    pub local_only: bool,
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
    pub assistant_message: NativeChatMessage,
    pub metrics: NativeRequestMetric,
    pub tool_events: Vec<NativeToolEvent>,
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

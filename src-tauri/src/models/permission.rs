use serde::{Deserialize, Serialize};

/// A permission decision for a sensitive agent/runtime action.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionDecision {
    Ask,
    Allow,
    Deny,
}

impl PermissionDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Allow => "allow",
            Self::Deny => "deny",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "allow" => Self::Allow,
            "deny" => Self::Deny,
            _ => Self::Ask,
        }
    }
}

/// The set of sensitive actions that require permission before execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRules {
    pub allow_command_execution: PermissionDecision,
    pub allow_external_context: PermissionDecision,
    pub allow_file_modification: PermissionDecision,
    pub allow_usage_analytics_collection: bool,
    pub allow_usage_analytics_upload: bool,
    pub allow_detailed_diagnostics: bool,
}

impl Default for PermissionRules {
    fn default() -> Self {
        Self::conservative()
    }
}

impl PermissionRules {
    /// Conservative defaults: ask before sensitive actions, analytics off.
    pub fn conservative() -> Self {
        Self {
            allow_command_execution: PermissionDecision::Ask,
            allow_external_context: PermissionDecision::Ask,
            allow_file_modification: PermissionDecision::Ask,
            allow_usage_analytics_collection: false,
            allow_usage_analytics_upload: false,
            allow_detailed_diagnostics: false,
        }
    }
}

/// A single audit entry recording a permission decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub action: String,
    pub scope: Option<String>,
    pub decision: String,
    pub source_workflow: Option<String>,
    pub created_at: i64,
}

/// A privacy-safe usage analytics event. Never stores prompt text, chat
/// content, source code, terminal output, secrets, or raw absolute paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub id: String,
    pub event_name: String,
    pub feature_area: String,
    pub outcome: Option<String>,
    pub duration_ms: Option<i64>,
    pub adapter_id: Option<String>,
    pub error_class: Option<String>,
    pub created_at: i64,
}

/// Consent record for analytics collection and upload.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsConsent {
    pub collection_enabled: bool,
    pub upload_enabled: bool,
    pub consent_version: Option<String>,
    pub consented_at: Option<i64>,
}

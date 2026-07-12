use serde::{Deserialize, Serialize};

/// A permission decision for a sensitive agent/runtime action.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionDecision {
    Ask,
    Allow,
    Deny,
}

#[allow(dead_code)]
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

/// Per-project approval mode controlling how tool calls are gated.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    /// Every tool call prompts the user.
    Safe,
    /// Read-only tools auto-allowed; writes and commands prompt.
    Balanced,
    /// No prompts; everything auto-allowed within workspace scoping.
    Auto,
}

/// Default is Auto (run everything): no prompts, everything auto-allowed
/// within workspace scoping. Users opt into Balanced/Safe per project.
/// Note: `from_str` still falls back to Balanced for unknown *stored*
/// values — a corrupt explicit setting degrades conservatively.
impl Default for ApprovalMode {
    fn default() -> Self {
        Self::Auto
    }
}

impl ApprovalMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Balanced => "balanced",
            Self::Auto => "auto",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "safe" => Self::Safe,
            "auto" => Self::Auto,
            _ => Self::Balanced,
        }
    }
}

/// A persistent per-project approval rule (e.g. "always allow run_command
/// starting with `npm test`").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRule {
    pub id: String,
    pub project_path: String,
    pub tool_name: String,
    /// For `run_command`: command prefix to match. Empty for other tools.
    pub command_prefix: Option<String>,
    pub decision: PermissionDecision,
    pub created_at: i64,
}

/// A session-scoped rule (in-memory, not persisted). Created when the user
/// picks "allow for session" on an approval prompt.
#[derive(Debug, Clone)]
pub struct SessionRule {
    pub tool_name: String,
    pub command_prefix: Option<String>,
    pub decision: PermissionDecision,
}

/// The result of gateway resolution for a tool call.
#[derive(Debug, Clone)]
pub struct GatewayDecision {
    /// `allow`, `deny`, or `ask` (prompt the user).
    pub decision: PermissionDecision,
    /// Whether a UI prompt is needed.
    pub requires_prompt: bool,
    /// Human-readable reason for the decision.
    pub reason: String,
    /// The rule that matched, if any (for audit).
    pub rule_source: Option<String>,
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

/// Persisted usage-sync settings. `auto_sync_usage` defaults to true so a
/// signed-in user with the upload permission granted syncs hourly without
/// extra opt-in. Explicit off persists across restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSyncSettings {
    /// Whether the user has opted in to periodic account usage sync.
    pub auto_sync_usage: bool,
    /// Sync interval in minutes (default 60).
    pub auto_sync_interval_minutes: i64,
    /// Epoch seconds of the last successful sync, when any.
    pub last_usage_sync_at: Option<i64>,
    /// Detail level for the app→basebuild.net message sync: "rows" (send
    /// per-message rows; the server rolls up + owns aggregation) or "summary"
    /// (roll up client-side, send summaries).
    #[serde(default = "default_usage_sync_mode")]
    pub usage_sync_mode: String,
    /// created_at (epoch seconds) of the last message row synced — the cursor
    /// for the incremental message sync.
    #[serde(default)]
    pub last_message_sync_at: Option<i64>,
}

fn default_usage_sync_mode() -> String {
    "rows".to_string()
}

impl Default for UsageSyncSettings {
    fn default() -> Self {
        Self {
            auto_sync_usage: true,
            auto_sync_interval_minutes: 60,
            last_usage_sync_at: None,
            usage_sync_mode: default_usage_sync_mode(),
            last_message_sync_at: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_mode_defaults_to_auto() {
        // Product decision: new projects run everything without prompts.
        assert_eq!(ApprovalMode::default(), ApprovalMode::Auto);
    }

    #[test]
    fn approval_mode_from_str_roundtrips_and_degrades_conservatively() {
        assert_eq!(ApprovalMode::from_str("safe"), ApprovalMode::Safe);
        assert_eq!(ApprovalMode::from_str("balanced"), ApprovalMode::Balanced);
        assert_eq!(ApprovalMode::from_str("auto"), ApprovalMode::Auto);
        // Unknown *stored* values degrade to Balanced, not the Auto default.
        assert_eq!(ApprovalMode::from_str("garbage"), ApprovalMode::Balanced);
    }
}

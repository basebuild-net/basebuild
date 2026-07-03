//! OMP session telemetry models — derived from `omp stats --json` and
//! `omp usage --json`. These types carry ONLY usage/metadata: provider, plan,
//! model, effort, tokens, cost, timing, and window utilization. They MUST NOT
//! carry prompt text, response text, source code, terminal output, secrets, or
//! raw absolute filesystem paths.

use serde::{Deserialize, Serialize};

/// Attachment state of the telemetry source to a running OMP session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "state", content = "reason")]
pub enum OmpAttachmentState {
    /// Actively reading telemetry from a running OMP session.
    Attached,
    /// No OMP session is running or the ledgers are unreadable.
    Detached(Option<String>),
    /// A session is running but the latest data is older than the freshness threshold.
    Stale(Option<String>),
}

impl Default for OmpAttachmentState {
    fn default() -> Self {
        Self::Detached(None)
    }
}

/// Where a plan attribution value came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlanSource {
    /// Resolved from the local OMP ledgers (`agent.db` usage_history / auth_credentials).
    Local,
    /// Reconciled with the account's detected plan via MCP.
    Account,
}

/// One per-message telemetry row. All metric fields are optional — missing
/// metrics are omitted, never zero-filled.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OmpMessageTelemetry {
    /// OMP session id, when resolvable from stats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Provider id (e.g. "anthropic", "openai").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Model id as OMP recorded it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Plan tier in use for this provider, when resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_tier: Option<String>,
    /// Where the plan value was resolved from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_source: Option<PlanSource>,
    /// Effort/thinking level when resolvable; `unknown` string when not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_second: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_ttft_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_timestamp: Option<i64>,
}

/// One provider utilization window (e.g. 5h or 7d).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OmpUsageWindow {
    /// Window label, e.g. "5h" or "7d".
    pub window: String,
    /// Fraction of the window used (0.0..=1.0).
    pub used_fraction: f64,
    /// Fraction remaining (1.0 - used_fraction).
    pub remaining_fraction: f64,
    /// When the window resets (epoch seconds or ISO string).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
    /// Severity: "ok" | "warning" | "critical" | "unknown".
    pub severity: String,
    /// Epoch seconds when the measurement was taken.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured_at: Option<i64>,
    /// Age of the measurement in minutes, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_minutes: Option<f64>,
    /// True when the measurement is older than the freshness threshold.
    pub is_stale: bool,
}

/// Live context for the attached OMP session — the snapshot published over
/// `omp-telemetry://` events and returned by the snapshot command.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OmpLiveContext {
    pub attachment: OmpAttachmentState,
    /// Active provider, when resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Active model id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Active plan tier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_source: Option<PlanSource>,
    /// Effort/thinking level ("off"|"minimal"|"low"|"medium"|"high"|"xhigh" or "unknown").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// Active session id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Per-window utilization for the active provider(s).
    #[serde(default)]
    pub windows: Vec<OmpUsageWindow>,
    /// Recent per-message telemetry rows (newest last), bounded.
    #[serde(default)]
    pub recent_messages: Vec<OmpMessageTelemetry>,
    /// Epoch seconds when this snapshot was assembled.
    pub assembled_at: i64,
}

impl OmpLiveContext {
    /// Build a detached context with a reason.
    pub fn detached(reason: impl Into<String>) -> Self {
        Self {
            attachment: OmpAttachmentState::Detached(Some(reason.into())),
            assembled_at: now_seconds(),
            ..Default::default()
        }
    }

    /// Build a stale context carrying the prior snapshot's reason.
    pub fn stale(reason: impl Into<String>) -> Self {
        Self {
            attachment: OmpAttachmentState::Stale(Some(reason.into())),
            assembled_at: now_seconds(),
            ..Default::default()
        }
    }
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

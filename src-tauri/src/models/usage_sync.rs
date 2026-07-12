//! Projected-usage models returned by basebuild.net MCP usage tools
//! (`get_my_live_usage`, `get_my_usage`, `list_my_plans`, `get_my_plan_timeline`).
//! These are read-only views of the account's derived usage, surfaced on the
//! Account page. They never contain prompt/source/secret content.

use serde::{Deserialize, Serialize};

/// One provider/window live utilization row from `get_my_live_usage`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveUsageRow {
    pub provider: String,
    /// Window label, e.g. "5h" or "7d".
    pub window: String,
    pub used_fraction: f64,
    pub remaining_fraction: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
    /// "ok" | "warning" | "critical" | "unknown".
    pub severity: String,
    /// How many minutes ago the underlying provider data was fetched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_ago_min: Option<f64>,
    /// True when the server marks this value as stale.
    pub is_stale: bool,
}

/// The live utilization snapshot returned by `get_my_live_usage`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveUsage {
    #[serde(default)]
    pub rows: Vec<LiveUsageRow>,
    /// True when the server says a fresh sync is needed.
    pub should_sync: bool,
}

/// One per-(provider, model) usage snapshot row from `get_my_usage`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshotRow {
    pub provider: String,
    pub model: String,
    pub requests_per_day: f64,
    pub hours_per_day: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_per_day: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_ttft_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_rate: Option<f64>,
}

/// The per-(provider, model) usage snapshot returned by `get_my_usage`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    #[serde(default)]
    pub rows: Vec<UsageSnapshotRow>,
}

/// One provider plan summary from `list_my_plans`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub provider: String,
    /// Monthly request volume, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_requests: Option<i64>,
    /// Dominant model id, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_model: Option<String>,
    /// Whether usage looks like a paid subscription vs pay-per-token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub looks_like_subscription: Option<bool>,
    /// Inferred tier label, when the server could infer one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred_tier: Option<String>,
    /// Detection confidence: "unknown" | "low" | "high".
    pub confidence: String,
}

/// The per-provider plan summaries returned by `list_my_plans`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummaries {
    #[serde(default)]
    pub plans: Vec<PlanSummary>,
}

/// One plan window in the per-provider timeline (`get_my_plan_timeline`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanTimelineWindow {
    pub provider: String,
    /// Plan tier label, e.g. "Claude Max".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    /// ISO date when the window started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// ISO date when the window ended, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    /// True when an exhaustion event was recorded in this window.
    #[serde(default)]
    pub had_exhaustion_event: bool,
    /// True when this is the current tier.
    #[serde(default)]
    pub is_current: bool,
}

/// The per-provider plan timeline returned by `get_my_plan_timeline`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanTimeline {
    #[serde(default)]
    pub windows: Vec<PlanTimelineWindow>,
}

/// The full projected-usage payload assembled for the Account page.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedUsage {
    pub live: LiveUsage,
    pub snapshot: UsageSnapshot,
    #[serde(default)]
    pub plans: PlanSummaries,
    #[serde(default)]
    pub timeline: PlanTimeline,
    /// Epoch seconds when this projection was assembled locally.
    pub assembled_at: i64,
}

/// Auto-sync status returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncStatus {
    /// Whether the user has enabled auto-sync (requires sign-in + upload permission to actually run).
    pub enabled: bool,
    /// Whether the gates currently allow syncing (signed in + enabled + upload permission).
    pub gates_pass: bool,
    /// Configured interval in minutes.
    pub interval_minutes: i64,
    /// Epoch seconds of the last successful sync, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<i64>,
    /// Last error message, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Current usage sync detail mode ("rows" | "summary").
    #[serde(default)]
    pub sync_mode: String,
}

/// Result of a manual or triggered sync push.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub ok: bool,
    pub message: String,
    /// Epoch seconds when the sync completed.
    pub completed_at: i64,
}

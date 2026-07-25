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

/// Principal that receives future accepted usage. A private installation is
/// random and write-only; it is never a hardware or operating-system identity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncAttribution {
    Account,
    #[default]
    PrivateInstallation,
}

/// Why syncing is currently off. `None` means every required gate passes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncOffReason {
    UsageSharingDisabled,
    AutoSyncDisabled,
    ConsentRequired,
    NoSourcesAvailable,
    RetryBackoff,
}

/// Complete result from the most recent coordinated multi-source attempt.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncOverallOutcome {
    Success,
    Partial,
    Failed,
    NothingToSync,
}

/// Privacy-safe status for one supported local aggregate source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSyncStatus {
    /// Allowlisted source name: native, omp, claude-code, codex, or opencode.
    pub source: String,
    /// Whether the local source can currently be read.
    pub available: bool,
    /// Safe explanation when the source is unavailable. Never contains paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability_reason: Option<String>,
    /// The source has an unacknowledged logical window that will be retried.
    #[serde(default)]
    pub pending_retry: bool,
    /// Epoch seconds of the last accepted acknowledgement for this source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_success_at: Option<i64>,
    /// Epoch seconds when server processing last completed, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_processed_at: Option<i64>,
    /// Actionable, privacy-safe source error. Never contains raw paths/content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Auto-sync status returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncStatus {
    /// Whether periodic auto-sync is enabled.
    pub enabled: bool,
    /// Whether consent, upload, and scheduling gates currently allow syncing.
    pub gates_pass: bool,
    /// Explicit reason syncing is off when a gate does not pass.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub off_reason: Option<SyncOffReason>,
    /// Whether future accepted usage is attributed to an account or only to
    /// this random, private installation.
    #[serde(default)]
    pub attribution: SyncAttribution,
    /// Configured interval in minutes.
    pub interval_minutes: i64,
    /// Epoch seconds of the last successful coordinated sync, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<i64>,
    /// Epoch seconds of the last coordinated ATTEMPT, successful or not.
    /// Distinct from `last_sync_at`: the retry backoff is measured from the
    /// attempt, so a permanently failing sync actually slows down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<i64>,
    /// Epoch seconds when the next automatic attempt becomes eligible, when
    /// the coordinator is currently backing off after a failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<i64>,
    /// Last coordinator error message, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Current usage sync detail mode ("rows" | "summary").
    #[serde(default)]
    pub sync_mode: String,
    /// Complete result of the most recent coordinated attempt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overall_outcome: Option<SyncOverallOutcome>,
    /// Independent status for every registered local source.
    #[serde(default)]
    pub sources: Vec<SourceSyncStatus>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_auto_sync_status_defaults_to_private_installation() {
        let status: AutoSyncStatus = serde_json::from_value(json!({
            "enabled": false,
            "gatesPass": false,
            "intervalMinutes": 60,
            "lastSyncAt": null,
            "lastError": null
        }))
        .expect("legacy status should deserialize");

        assert_eq!(status.attribution, SyncAttribution::PrivateInstallation);
        assert_eq!(status.off_reason, None);
        assert_eq!(status.overall_outcome, None);
        assert!(status.sources.is_empty());
    }

    #[test]
    fn source_status_serializes_stable_status_mapping() {
        let status = AutoSyncStatus {
            enabled: true,
            gates_pass: true,
            off_reason: None,
            attribution: SyncAttribution::Account,
            interval_minutes: 60,
            last_sync_at: Some(100),
            last_attempt_at: Some(100),
            retry_after: None,
            last_error: None,
            sync_mode: "summary".to_string(),
            overall_outcome: Some(SyncOverallOutcome::Partial),
            sources: vec![SourceSyncStatus {
                source: "claude-code".to_string(),
                available: true,
                availability_reason: None,
                pending_retry: true,
                last_success_at: Some(90),
                last_processed_at: Some(95),
                last_error: Some("Upload was not acknowledged; retry scheduled.".to_string()),
            }],
        };

        let value = serde_json::to_value(status).expect("status should serialize");
        assert_eq!(value["attribution"], "account");
        assert_eq!(value["overallOutcome"], "partial");
        assert_eq!(value["sources"][0]["source"], "claude-code");
        assert_eq!(value["sources"][0]["pendingRetry"], true);
        assert!(value.get("installationId").is_none());
        assert!(value.get("accountId").is_none());
    }
}

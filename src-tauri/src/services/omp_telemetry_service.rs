//! OMP session telemetry service.
//!
//! Reads `omp stats --json` and `omp usage --json` (the same blobs the sync
//! path sends to basebuild.net) and normalizes them into `OmpLiveContext` /
//! `OmpMessageTelemetry` rows. This is a read-only view of a running OMP
//! session: it never writes to OMP databases and never sends commands to OMP.
//!
//! The service runs a background polling loop (debounced) that republishes
//! the assembled context over the `omp-telemetry://update` event channel.
//! Local persistence of telemetry metrics is gated on the
//! `allowUsageAnalyticsCollection` permission; live in-memory publishing is
//! ungated.
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::events::OMP_TELEMETRY;
use crate::models::omp_telemetry::{
    OmpAttachmentState, OmpLiveContext, OmpMessageTelemetry, OmpUsageWindow, PlanSource,
};
use crate::services::omp_service::OmpService;
use crate::services::settings_service::SettingsService;

/// Default poll interval for the telemetry loop. Conservative to avoid
/// hammering `omp stats/usage --json` (each poll spawns two short-lived omp
/// processes).
const DEFAULT_POLL_INTERVAL_SECS: u64 = 30;
/// Treat a measurement older than this (in minutes) as stale.
const STALE_THRESHOLD_MINUTES: i64 = 15;
/// Maximum per-message rows retained in the live context.
const MAX_RECENT_MESSAGES: usize = 50;

/// Tracks whether the telemetry loop is currently running.
static TELEMETRY_RUNNING: AtomicBool = AtomicBool::new(false);

/// The latest snapshot, shared between the polling thread and command reads.
static LATEST: Mutex<Option<OmpLiveContext>> = parking_lot::const_mutex(None);

#[derive(Debug, Default)]
pub struct OmpTelemetryService;

impl OmpTelemetryService {
    /// Build a single snapshot from `omp stats --json` + `omp usage --json`.
    /// Returns a detached context when OMP is not installed or no data exists.
    pub fn snapshot() -> OmpLiveContext {
        // Probe OMP first — if not installed, there is nothing to read.
        let status = OmpService::status();
        if !status.installed {
            return OmpLiveContext::detached("OMP is not installed");
        }

        let stats = OmpService::run_json(&["stats", "--json"]);
        let usage = OmpService::run_json(&["usage", "--json"]);

        let stats_json = match stats {
            Ok(r) if r.success => r.json.unwrap_or(Value::Null),
            Ok(r) => {
                return OmpLiveContext::detached(format!(
                    "`omp stats --json` failed: {}",
                    r.stderr.trim()
                ))
            }
            Err(e) => return OmpLiveContext::detached(format!("`omp stats --json` failed: {e}")),
        };
        let usage_json = match usage {
            Ok(r) if r.success => r.json.unwrap_or(Value::Null),
            Ok(r) => {
                return OmpLiveContext::detached(format!(
                    "`omp usage --json` failed: {}",
                    r.stderr.trim()
                ))
            }
            Err(e) => return OmpLiveContext::detached(format!("`omp usage --json` failed: {e}")),
        };

        Self::assemble(&stats_json, &usage_json)
    }

    /// Assemble a live context from parsed stats + usage JSON.
    fn assemble(stats: &Value, usage: &Value) -> OmpLiveContext {
        let messages = parse_messages(stats);
        let windows = parse_windows(usage);
        let plan = parse_plan(usage);

        // The active provider/model/effort is the most recent message with a model.
        let active = messages.iter().rev().find(|m| m.model.is_some());

        let assembled_at = now_seconds();
        let is_stale = messages
            .iter()
            .rev()
            .find_map(|m| m.last_timestamp)
            .map(|ts| {
                let age_min = (assembled_at - ts).max(0) / 60;
                age_min > STALE_THRESHOLD_MINUTES
            })
            .unwrap_or(true);

        let attachment = if messages.is_empty() && windows.is_empty() {
            OmpAttachmentState::Detached(Some("No OMP session data found".to_string()))
        } else if is_stale {
            OmpAttachmentState::Stale(Some(format!(
                "last activity > {STALE_THRESHOLD_MINUTES}m ago"
            )))
        } else {
            OmpAttachmentState::Attached
        };

        OmpLiveContext {
            attachment,
            provider: active.and_then(|m| m.provider.clone()),
            model: active.and_then(|m| m.model.clone()),
            plan_tier: plan.clone(),
            plan_source: if plan.is_some() {
                Some(PlanSource::Local)
            } else {
                None
            },
            effort: None, // not reliably available from stats/usage JSON
            session_id: active.and_then(|m| m.session_id.clone()),
            windows,
            recent_messages: messages
                .into_iter()
                .rev()
                .take(MAX_RECENT_MESSAGES)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
            assembled_at,
        }
    }

    /// Start the background polling loop. Idempotent — only one loop runs.
    pub fn start_loop(app: AppHandle) {
        if TELEMETRY_RUNNING.swap(true, Ordering::SeqCst) {
            return; // already running
        }
        thread::spawn(move || {
            loop {
                if !TELEMETRY_RUNNING.load(Ordering::SeqCst) {
                    break;
                }
                let ctx = Self::snapshot();
                let app2 = app.clone();
                // Persist locally only when analytics collection is permitted.
                // Live publishing is ungated.
                let _ = Self::maybe_persist(&ctx);
                {
                    *LATEST.lock() = Some(ctx.clone());
                }
                let _ = app2.emit(OMP_TELEMETRY, &ctx);
                thread::sleep(Duration::from_secs(DEFAULT_POLL_INTERVAL_SECS));
            }
            // Clear the running flag on exit.
            TELEMETRY_RUNNING.store(false, Ordering::SeqCst);
        });
    }

    /// Stop the background polling loop. Idempotent.
    pub fn stop_loop() {
        TELEMETRY_RUNNING.store(false, Ordering::SeqCst);
    }

    /// Read the latest cached snapshot (does not spawn omp).
    pub fn latest() -> OmpLiveContext {
        LATEST
            .lock()
            .clone()
            .unwrap_or_else(|| OmpLiveContext::detached("No telemetry snapshot yet"))
    }

    /// Persist telemetry metrics locally, gated on the collection permission.
    /// Currently a no-op placeholder — the local ledger table is not yet
    /// populated, but the gate is enforced here so future persistence is
    /// automatically privacy-correct.
    fn maybe_persist(_ctx: &OmpLiveContext) -> Result<(), String> {
        let rules = SettingsService::get_permission_rules()?;
        if !rules.allow_usage_analytics_collection {
            return Ok(());
        }
        // Future: insert usage rows into a local telemetry ledger table.
        Ok(())
    }
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// Parse per-message rows from `omp stats --json`. OMP's stats shape is a
/// JSON object whose `byModel` array contains per-(model, provider) aggregates
/// with tokens/cost/timing. We treat each as a "message telemetry" row.
fn parse_messages(stats: &Value) -> Vec<OmpMessageTelemetry> {
    let Some(by_model) = stats.get("byModel").and_then(|v| v.as_array()) else {
        // Some OMP versions nest under `stats.byModel`; others return a bare array.
        if let Some(arr) = stats.as_array() {
            return arr.iter().map(parse_message_row).collect();
        }
        return Vec::new();
    };
    by_model.iter().map(parse_message_row).collect()
}

fn parse_message_row(row: &Value) -> OmpMessageTelemetry {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    let i = |k: &str| row.get(k).and_then(|v| v.as_i64());
    let f = |k: &str| row.get(k).and_then(|v| v.as_f64());
    OmpMessageTelemetry {
        session_id: s("sessionId").or_else(|| s("session")),
        provider: s("provider"),
        model: s("model").or_else(|| s("modelId")),
        plan_tier: None,
        plan_source: None,
        effort: None,
        input_tokens: i("inputTokens"),
        output_tokens: i("outputTokens"),
        cache_read_tokens: i("cacheReadTokens"),
        cache_write_tokens: i("cacheWriteTokens"),
        total_tokens: i("totalTokens"),
        tokens_per_second: f("tokensPerSecond"),
        cost_total: f("costTotal"),
        avg_ttft_ms: f("avgTtftMs"),
        avg_duration_ms: f("avgDurationMs"),
        requests: i("requests").or_else(|| i("requestCount")),
        error_rate: f("errorRate"),
        first_timestamp: i("firstTimestamp"),
        last_timestamp: i("lastTimestamp"),
    }
}

/// Parse per-window utilization rows from `omp usage --json`. The shape is
/// an object whose `windows` (or `usage`) array contains per-provider window
/// rows with `usedFraction`, `resetsAt`, `severity`, and a fetch timestamp.
fn parse_windows(usage: &Value) -> Vec<OmpUsageWindow> {
    let windows_arr = usage
        .get("windows")
        .and_then(|v| v.as_array())
        .or_else(|| usage.get("usage").and_then(|v| v.as_array()))
        .or_else(|| usage.as_array());
    let Some(arr) = windows_arr else {
        return Vec::new();
    };
    arr.iter().map(parse_window_row).collect()
}

fn parse_window_row(row: &Value) -> OmpUsageWindow {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    let f = |k: &str| row.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let i = |k: &str| row.get(k).and_then(|v| v.as_i64());
    let used = f("usedFraction");
    let remaining = if row.get("remainingFraction").is_some() {
        f("remainingFraction")
    } else {
        (1.0 - used).max(0.0)
    };
    let measured_at = i("measuredAt").or_else(|| i("fetchedAt"));
    let age_minutes = measured_at.map(|ts| ((now_seconds() - ts).max(0) as f64) / 60.0);
    let is_stale = age_minutes
        .map(|a| a > STALE_THRESHOLD_MINUTES as f64)
        .unwrap_or(true);
    OmpUsageWindow {
        window: s("window").unwrap_or_else(|| "unknown".to_string()),
        used_fraction: used,
        remaining_fraction: remaining,
        resets_at: s("resetsAt"),
        severity: s("severity").unwrap_or_else(|| "unknown".to_string()),
        measured_at,
        age_minutes,
        is_stale,
    }
}

/// Parse the active plan tier from `omp usage --json`. OMP exposes plan
/// windows in `usage_history` (via `agent.db`); the `omp usage --json` view
/// surfaces the current plan tier in `plan.tier` or `currentPlan`.
fn parse_plan(usage: &Value) -> Option<String> {
    usage
        .get("plan")
        .and_then(|p| p.get("tier"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            usage
                .get("currentPlan")
                .and_then(|v| v.as_str())
                .map(String::from)
        })
        .or_else(|| {
            usage
                .get("plan")
                .and_then(|p| p.get("tier"))
                .and_then(|v| v.as_str())
                .map(String::from)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_by_model_array() {
        let stats = json!({
            "byModel": [
                {
                    "model": "claude-sonnet-4",
                    "provider": "anthropic",
                    "requests": 12,
                    "inputTokens": 1000,
                    "outputTokens": 500,
                    "costTotal": 0.12,
                    "avgTtftMs": 800.0,
                    "avgDurationMs": 2500.0,
                    "lastTimestamp": now_seconds() - 60,
                }
            ]
        });
        let usage = json!({});
        let ctx = OmpTelemetryService::assemble(&stats, &usage);
        assert_eq!(ctx.recent_messages.len(), 1);
        let m = &ctx.recent_messages[0];
        assert_eq!(m.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(m.provider.as_deref(), Some("anthropic"));
        assert_eq!(m.requests, Some(12));
        assert_eq!(m.cost_total, Some(0.12));
        // No prompt/source/secret fields exist on the model.
        let serialized = serde_json::to_string(m).unwrap();
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("content"));
    }

    #[test]
    fn parses_windows_with_freshness() {
        let ts = now_seconds();
        let usage = json!({
            "windows": [
                {
                    "window": "5h",
                    "usedFraction": 0.62,
                    "resetsAt": "2026-07-03T12:00:00Z",
                    "severity": "warning",
                    "measuredAt": ts,
                }
            ]
        });
        let ctx = OmpTelemetryService::assemble(&json!({}), &usage);
        assert_eq!(ctx.windows.len(), 1);
        let w = &ctx.windows[0];
        assert_eq!(w.window, "5h");
        assert!((w.used_fraction - 0.62).abs() < 1e-9);
        assert_eq!(w.severity, "warning");
        assert!(!w.is_stale);
    }

    #[test]
    fn marks_stale_measurement() {
        let old_ts = now_seconds() - (STALE_THRESHOLD_MINUTES as i64 + 5) * 60;
        let usage = json!({
            "windows": [{ "window": "5h", "usedFraction": 0.5, "measuredAt": old_ts }]
        });
        let ctx = OmpTelemetryService::assemble(&json!({}), &usage);
        assert!(ctx.windows[0].is_stale);
        assert!(matches!(ctx.attachment, OmpAttachmentState::Stale(_)));
    }

    #[test]
    fn detached_when_omp_data_empty() {
        let ctx = OmpTelemetryService::assemble(&json!({}), &json!({}));
        assert!(matches!(ctx.attachment, OmpAttachmentState::Detached(_)));
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::{AUTH_CHANGED, USAGE_SYNC_STATUS};
use crate::models::usage_sync::{
    AutoSyncStatus, LiveUsage, LiveUsageRow, PlanSummaries, PlanSummary, PlanTimeline,
    PlanTimelineWindow, ProjectedUsage, SyncResult, UsageSnapshot, UsageSnapshotRow,
};
use crate::services::auth_service::AuthService;
use crate::services::omp_service::OmpService;
use crate::services::settings_service::SettingsService;

const MCP_URL: &str = "https://basebuild.net/api/mcp";
/// Minimum gap between sync pushes in seconds, even if a trigger fires.
const MIN_INTER_SYNC_GAP_SECS: i64 = 60;
/// Default interval (minutes) when the setting is missing or zero.
const DEFAULT_INTERVAL_MINUTES: i64 = 60;

/// Tracks whether the autosync loop is currently running.
static AUTOSYNC_RUNNING: AtomicBool = AtomicBool::new(false);
/// The most recent status, shared between the loop and command reads.
static AUTOSYNC_STATUS: Mutex<AutoSyncStatus> = parking_lot::const_mutex(AutoSyncStatus {
    enabled: false,
    gates_pass: false,
    interval_minutes: DEFAULT_INTERVAL_MINUTES,
    last_sync_at: None,
    last_error: None,
});

/// Sync raw OMP usage to basebuild.net using the stored native token.
/// Collects `omp stats --json` and `omp usage --json`, then sends them
/// as a `sync_raw_usage` JSON-RPC call to the hosted MCP endpoint.
///
/// Returns a human-readable result message.
pub fn sync_raw_usage_native() -> Result<String, String> {
    // 1. Get the stored native token
    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    // 2. Collect OMP stats and usage
    let stats = OmpService::run_json(&["stats", "--json"])
        .map_err(|e| format!("Failed to run `omp stats --json`: {e}"))?;
    let stats_json = if stats.success {
        stats.json.clone().unwrap_or(Value::Null)
    } else {
        return Err(format!("`omp stats --json` failed: {}", stats.stderr));
    };

    let usage = OmpService::run_json(&["usage", "--json"])
        .map_err(|e| format!("Failed to run `omp usage --json`: {e}"))?;
    let usage_json = if usage.success {
        usage.json.clone().unwrap_or(Value::Null)
    } else {
        return Err(format!("`omp usage --json` failed: {}", usage.stderr));
    };

    // 3. Build the JSON-RPC request
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "sync_raw_usage",
            "arguments": {
                "stats": stats_json,
                "usage": usage_json,
            }
        }
    });

    // 4. Send to MCP endpoint
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(MCP_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&rpc_body)
        .send()
        .map_err(|e| format!("Failed to connect to basebuild.net: {e}"))?;

    let status = resp.status();
    let text = resp.text().unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        // Token may be revoked or expired — clear it
        let _ = AuthService::clear_auth();
        return Err("Token expired or revoked. Please sign in again.".into());
    }

    if !status.is_success() {
        return Err(format!("MCP sync failed ({status}): {text}"));
    }

    // Parse the JSON-RPC response
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse MCP response: {e}"))?;

    if let Some(error) = parsed.get("error") {
        let message = error.get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP error: {message}"));
    }

    // Extract result text
    let result = parsed.get("result")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Usage synced successfully.");

    Ok(result.to_string())
}

// ─── Projected-usage reads (native token, /api/mcp) ───────────────────────

/// Call an MCP `tools/call` method by name with no arguments, returning the
/// parsed `result.content[0].text` as a `Value`. On 401, clears auth.
fn call_mcp_tool(token: &str, tool: &str, arguments: Value) -> Result<Value, String> {
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": tool, "arguments": arguments }
    });
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(MCP_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&rpc_body)
        .send()
        .map_err(|e| format!("Failed to connect to basebuild.net: {e}"))?;

    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let _ = AuthService::clear_auth();
        return Err("Token expired or revoked. Please sign in again.".into());
    }
    if !status.is_success() {
        return Err(format!("MCP {tool} failed ({status}): {text}"));
    }
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse MCP {tool} response: {e}"))?;
    if let Some(error) = parsed.get("error") {
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP {tool} error: {message}"));
    }
    // The result content text is itself JSON; parse it out.
    let text = parsed
        .get("result")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("MCP {tool} returned no content text"))?;
    // The text may be a JSON string or a JSON object serialized as a string.
    serde_json::from_str::<Value>(text).or_else(|_| Ok(Value::String(text.to_string())))
}

/// Fetch the full projected-usage payload for the Account page.
pub fn fetch_projected_usage() -> Result<ProjectedUsage, String> {
    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    let live = call_mcp_tool(&token, "get_my_live_usage", json!({}))
        .map(parse_live_usage)
        .unwrap_or_default();
    let snapshot = call_mcp_tool(&token, "get_my_usage", json!({}))
        .map(parse_usage_snapshot)
        .unwrap_or_default();
    let plans = call_mcp_tool(&token, "list_my_plans", json!({}))
        .map(parse_plan_summaries)
        .unwrap_or_default();
    let timeline = call_mcp_tool(&token, "get_my_plan_timeline", json!({}))
        .map(parse_plan_timeline)
        .unwrap_or_default();

    Ok(ProjectedUsage {
        live,
        snapshot,
        plans,
        timeline,
        assembled_at: now_seconds(),
    })
}

fn parse_live_usage(v: Value) -> LiveUsage {
    // The MCP tool returns an object with per-(provider, window) rows and
    // a top-level shouldSync flag. Be defensive about shape.
    let should_sync = v.get("shouldSync").and_then(|v| v.as_bool()).unwrap_or(false);
    let rows = v
        .get("rows")
        .or_else(|| v.get("usage"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_live_usage_row).collect())
        .unwrap_or_default();
    LiveUsage { rows, should_sync }
}

fn parse_live_usage_row(row: &Value) -> LiveUsageRow {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    let f = |k: &str| row.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    LiveUsageRow {
        provider: s("provider").unwrap_or_else(|| "unknown".to_string()),
        window: s("window").unwrap_or_else(|| "unknown".to_string()),
        used_fraction: f("usedFraction"),
        remaining_fraction: f("remainingFraction"),
        resets_at: s("resetsAt"),
        severity: s("severity").unwrap_or_else(|| "unknown".to_string()),
        fetched_ago_min: row.get("fetchedAgoMin").and_then(|v| v.as_f64()),
        is_stale: row.get("isStale").and_then(|v| v.as_bool()).unwrap_or(false),
    }
}

fn parse_usage_snapshot(v: Value) -> UsageSnapshot {
    let rows = v
        .get("rows")
        .or_else(|| v.get("snapshots"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_usage_snapshot_row).collect())
        .unwrap_or_default();
    UsageSnapshot { rows }
}

fn parse_usage_snapshot_row(row: &Value) -> UsageSnapshotRow {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    let f = |k: &str| row.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    UsageSnapshotRow {
        provider: s("provider").unwrap_or_else(|| "unknown".to_string()),
        model: s("model").unwrap_or_else(|| "unknown".to_string()),
        requests_per_day: f("requestsPerDay"),
        hours_per_day: f("hoursPerDay"),
        cost_per_day: row.get("costPerDay").and_then(|v| v.as_f64()),
        avg_duration_ms: row.get("avgDurationMs").and_then(|v| v.as_f64()),
        avg_ttft_ms: row.get("avgTtftMs").and_then(|v| v.as_f64()),
        error_rate: row.get("errorRate").and_then(|v| v.as_f64()),
    }
}

fn parse_plan_summaries(v: Value) -> PlanSummaries {
    let plans = v
        .get("plans")
        .or_else(|| v.get("rows"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_plan_summary).collect())
        .unwrap_or_default();
    PlanSummaries { plans }
}

fn parse_plan_summary(row: &Value) -> PlanSummary {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    PlanSummary {
        provider: s("provider").unwrap_or_else(|| "unknown".to_string()),
        monthly_requests: row.get("monthlyRequests").and_then(|v| v.as_i64()),
        dominant_model: s("dominantModel"),
        looks_like_subscription: row.get("looksLikeSubscription").and_then(|v| v.as_bool()),
        inferred_tier: s("inferredTier"),
        confidence: s("confidence").unwrap_or_else(|| "unknown".to_string()),
    }
}

fn parse_plan_timeline(v: Value) -> PlanTimeline {
    let windows = v
        .get("windows")
        .or_else(|| v.get("timeline"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_plan_timeline_window).collect())
        .unwrap_or_default();
    PlanTimeline { windows }
}

fn parse_plan_timeline_window(row: &Value) -> PlanTimelineWindow {
    let s = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
    PlanTimelineWindow {
        provider: s("provider").unwrap_or_else(|| "unknown".to_string()),
        tier: s("tier"),
        started_at: s("startedAt"),
        ended_at: s("endedAt"),
        had_exhaustion_event: row.get("hadExhaustionEvent").and_then(|v| v.as_bool()).unwrap_or(false),
        is_current: row.get("isCurrent").and_then(|v| v.as_bool()).unwrap_or(false),
    }
}

// ─── Auto-sync driver ──────────────────────────────────────────────────────

/// Check whether the gates currently allow a sync push: signed in AND
/// auto-sync enabled AND upload permission granted. Does not perform network
/// I/O for the gate check itself (only reads stored settings/auth).
pub fn gates_pass() -> bool {
    let Ok(Some(_token)) = AuthService::get_access_token() else {
        return false;
    };
    let Ok(rules) = SettingsService::get_permission_rules() else {
        return false;
    };
    if !rules.allow_usage_analytics_upload {
        return false;
    }
    let status = AUTOSYNC_STATUS.lock().clone();
    status.enabled
}

/// Read the current auto-sync status (cached, no network I/O).
pub fn autosync_status() -> AutoSyncStatus {
    // Refresh gates_pass + interval from settings so the UI reflects truth.
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.gates_pass = gates_pass();
    let settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    status.enabled = settings.auto_sync_usage;
    status.interval_minutes = settings.auto_sync_interval_minutes.max(1);
    // Write back so the cached status stays fresh for other callers.
    *AUTOSYNC_STATUS.lock() = status.clone();
    status
}

/// Enable or disable auto-sync. Persisted to settings.
pub fn set_autosync_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    settings.auto_sync_usage = enabled;
    SettingsService::set_usage_sync_settings(&settings)?;
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.enabled = enabled;
    status.gates_pass = gates_pass();
    Ok(())
}

/// Trigger a sync push now (manual or opportunistic). Re-checks gates and
/// freshness, then calls `sync_raw_usage_native`. Records last_sync_at /
/// last_error and emits a status event. Non-blocking on failure.
pub fn trigger_sync(app: AppHandle, reason: &str) {
    if !gates_pass() {
        return;
    }
    // Debounce: enforce a minimum gap between pushes.
    let now = now_seconds();
    {
        let status = AUTOSYNC_STATUS.lock().clone();
        if let Some(last) = status.last_sync_at {
            if now - last < MIN_INTER_SYNC_GAP_SECS {
                return;
            }
        }
    }
    // Freshness check: ask the server if data is stale before pushing.
    let should_push = match AuthService::get_access_token() {
        Ok(Some(token)) => {
            call_mcp_tool(&token, "get_my_live_usage", json!({}))
                .ok()
                .and_then(|v| v.get("shouldSync").and_then(|v| v.as_bool()))
                .unwrap_or(true)
        }
        _ => false,
    };
    if !should_push {
        return;
    }

    let app2 = app.clone();
    let reason_owned = reason.to_string();
    thread::spawn(move || {
        let result = sync_raw_usage_native();
        let now = now_seconds();
        let mut status = AUTOSYNC_STATUS.lock().clone();
        match result {
            Ok(msg) => {
                status.last_sync_at = Some(now);
                status.last_error = None;
                let _ = app2.emit(
                    USAGE_SYNC_STATUS,
                    &SyncResult { ok: true, message: format!("{reason_owned}: {msg}"), completed_at: now },
                );
            }
            Err(e) => {
                status.last_error = Some(e.clone());
                let _ = app2.emit(
                    USAGE_SYNC_STATUS,
                    &SyncResult { ok: false, message: format!("{reason_owned}: {e}"), completed_at: now },
                );
                // If the error was auth-related, emit auth-changed so the UI prompts re-sign-in.
                if e.contains("Token expired") || e.contains("Not signed in") {
                    let _ = app2.emit(AUTH_CHANGED, ());
                }
            }
        }
        *AUTOSYNC_STATUS.lock() = status;
    });
}

/// Start the auto-sync background loop. Idempotent. Ticks every
/// `autoSyncIntervalMinutes` and on each tick re-checks gates + freshness.
pub fn start_autosync_loop(app: AppHandle) {
    if AUTOSYNC_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        loop {
            if !AUTOSYNC_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            let interval_minutes = autosync_status().interval_minutes.max(1);
            // Sync (if gates + freshness allow) on each tick.
            trigger_sync(app.clone(), "hourly");
            // Sleep for the interval, checking the stop flag every 5s so the
            // loop can exit promptly when stopped.
            let sleep_secs = (interval_minutes as u64) * 60;
            let mut slept = 0u64;
            while slept < sleep_secs {
                if !AUTOSYNC_RUNNING.load(Ordering::SeqCst) {
                    break;
                }
                let chunk = std::cmp::min(5, sleep_secs - slept);
                thread::sleep(Duration::from_secs(chunk));
                slept += chunk;
            }
        }
        AUTOSYNC_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Stop the auto-sync background loop. Idempotent.
pub fn stop_autosync_loop() {
    AUTOSYNC_RUNNING.store(false, Ordering::SeqCst);
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

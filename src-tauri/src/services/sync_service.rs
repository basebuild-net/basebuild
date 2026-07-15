use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::{AUTH_CHANGED, USAGE_SYNC_STATUS};
use crate::models::usage_envelope::{
    build_envelope, sanitize_row, SourceKind, UsageBatch, ENVELOPE_VERSION,
};
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
/// Maximum backoff in seconds (15 minutes).
const MAX_BACKOFF_SECS: u64 = 900;
/// Initial backoff in seconds.
const INITIAL_BACKOFF_SECS: u64 = 30;

/// Tracks whether the autosync loop is currently running.
static AUTOSYNC_RUNNING: AtomicBool = AtomicBool::new(false);
/// Single-flight guard: prevents concurrent trigger_sync invocations from
/// launching overlapping sync threads.
static SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
/// Current backoff in seconds. Reset to INITIAL_BACKOFF_SECS on success,
/// doubled (capped at MAX_BACKOFF_SECS) on transient failure.
static BACKOFF_SECS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(INITIAL_BACKOFF_SECS);
/// The most recent status, shared between the loop and command reads.
static AUTOSYNC_STATUS: Mutex<AutoSyncStatus> = parking_lot::const_mutex(AutoSyncStatus {
    enabled: false,
    gates_pass: false,
    interval_minutes: DEFAULT_INTERVAL_MINUTES,
    last_sync_at: None,
    last_error: None,
    sync_mode: String::new(),
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
    let parsed: Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse MCP response: {e}"))?;

    if let Some(error) = parsed.get("error") {
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP error: {message}"));
    }

    // Extract result text
    let result = parsed
        .get("result")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Usage synced successfully.");

    Ok(result.to_string())
}

/// Sync per-message usage rows to basebuild.net via the `sync_messages` MCP
/// tool. Reads native chat request metrics since the last message-sync cursor
/// and sends them either as raw rows (server rolls up + owns aggregation) or as
/// client-side summaries, per the `usage_sync_mode` setting. Advances the
/// cursor only on a successful push. Returns a human-readable result message.
pub fn sync_messages_native() -> Result<String, String> {
    use crate::services::native_chat_service::NativeChatService;

    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    let mut settings = SettingsService::get_usage_sync_settings()?;
    let since = settings.last_message_sync_at.unwrap_or(0);
    let metrics = NativeChatService::metrics_since(since, 5000)?;
    if metrics.is_empty() {
        return Ok("no new messages".to_string());
    }
    let window_start = metrics.iter().map(|m| m.created_at).min().unwrap_or(since);
    let window_end = metrics.iter().map(|m| m.created_at).max().unwrap_or(since);

    let arguments = if settings.usage_sync_mode == "summary" {
        json!({
            "mode": "summary",
            "windowStart": window_start,
            "windowEnd": window_end,
            "summaries": build_message_summaries(&metrics),
        })
    } else {
        json!({
            "mode": "rows",
            "windowStart": window_start,
            "windowEnd": window_end,
            "rows": metrics.iter().map(message_row_json).collect::<Vec<_>>(),
        })
    };

    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": "sync_messages", "arguments": arguments }
    });

    let result = post_mcp(&token, &rpc_body)?;
    // Advance the cursor only after the server accepted the batch.
    settings.last_message_sync_at = Some(window_end);
    let _ = SettingsService::set_usage_sync_settings(&settings);
    Ok(format!("{} rows: {result}", metrics.len()))
}

// ─── Versioned envelope sync for native chat metrics ──────────────────────
//
// The envelope carries native chat metrics in a versioned, allowlisted
// structure. OMP continues to use the existing `sync_raw_usage` path
// (task 5.5: preserve existing OMP upload path). If the server doesn't
// recognize the envelope tool, we fall back to `sync_messages`.

/// Collect native chat metrics as a sanitized, allowlisted batch.
pub fn collect_native_batch() -> Result<UsageBatch, String> {
    use crate::services::native_chat_service::NativeChatService;

    let settings = SettingsService::get_usage_sync_settings()?;
    let since = settings.last_message_sync_at.unwrap_or(0);
    let metrics = NativeChatService::metrics_since(since, 5000)?;

    let rows: Vec<Value> = metrics
        .iter()
        .map(|m| {
            sanitize_row(&json!({
                "id": m.id,
                "ts": m.created_at,
                "source": "native",
                "provider": m.provider_id,
                "model": m.model_id,
                "effort": m.effort_level,
                "subscriptionTier": m.subscription_tier,
                "subscriptionSource": m.subscription_source,
                "planName": m.plan_name,
                "inputTokens": m.input_tokens,
                "outputTokens": m.output_tokens,
                "cacheReadTokens": m.cache_read_tokens,
                "costTotal": m.cost_total.unwrap_or(0.0),
                "durationMs": m.duration_ms,
                "ttftMs": m.ttft_ms,
                "outcome": m.outcome,
            }))
        })
        .collect();

    let window_start = metrics.iter().map(|m| m.created_at).min().unwrap_or(since);
    let window_end = metrics.iter().map(|m| m.created_at).max().unwrap_or(since);

    Ok(UsageBatch {
        source: SourceKind::Native,
        dedup_key: format!("native-{window_end}"),
        window_start,
        window_end,
        rows,
    })
}

/// Sync a versioned envelope carrying native chat metrics to basebuild.net
/// via the `sync_usage_envelope` MCP tool. Falls back to `sync_messages`
/// if the server doesn't recognize the envelope tool. OMP continues to use
/// the existing `sync_raw_usage` path independently.
pub fn sync_envelope_native() -> Result<String, String> {
    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    let batch = match collect_native_batch() {
        Ok(b) if !b.rows.is_empty() => b,
        Ok(_) => return Ok("no new native usage data".to_string()),
        Err(e) => {
            eprintln!("[SYNC] native batch collection failed: {e}");
            return Err(e);
        }
    };

    // Build and validate the envelope before transport.
    let envelope = build_envelope(vec![batch], now_seconds())
        .map_err(|e| format!("envelope validation failed: {e}"))?;

    // Send the envelope to the server.
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "sync_usage_envelope",
            "arguments": serde_json::to_value(&envelope).unwrap_or(Value::Null),
        }
    });

    match post_mcp(&token, &rpc_body) {
        Ok(result) => {
            // Advance the native cursor only after the server accepted the batch.
            for batch in &envelope.batches {
                if batch.source == SourceKind::Native {
                    if let Ok(mut settings) = SettingsService::get_usage_sync_settings() {
                        settings.last_message_sync_at = Some(batch.window_end);
                        let _ = SettingsService::set_usage_sync_settings(&settings);
                    }
                }
            }
            Ok(format!("envelope v{ENVELOPE_VERSION}: {result}"))
        }
        Err(e) => {
            // If the server doesn't recognize the envelope tool, fall back to
            // the existing sync_messages path. This preserves compatibility.
            if e.contains("Unknown tool")
                || e.contains("not found")
                || e.contains("sync_usage_envelope")
            {
                eprintln!("[SYNC] server doesn't support sync_usage_envelope — falling back to sync_messages");
                sync_messages_native()
            } else {
                Err(e)
            }
        }
    }
}

fn message_row_json(m: &crate::models::native_chat::NativeRequestMetric) -> Value {
    json!({
        "id": m.id,
        "ts": m.created_at,
        "provider": m.provider_id,
        "model": m.model_id,
        "effort": m.effort_level,
        "subscriptionTier": m.subscription_tier,
        "subscriptionSource": m.subscription_source,
        "planName": m.plan_name,
        "inputTokens": m.input_tokens,
        "outputTokens": m.output_tokens,
        "cacheReadTokens": m.cache_read_tokens,
        "costTotal": m.cost_total.unwrap_or(0.0),
        "durationMs": m.duration_ms,
        "ttftMs": m.ttft_ms,
        "outcome": m.outcome,
    })
}

/// Roll native metrics up client-side, grouped by (provider, model, tier).
fn build_message_summaries(
    metrics: &[crate::models::native_chat::NativeRequestMetric],
) -> Vec<Value> {
    use std::collections::HashMap;
    struct Acc {
        provider: String,
        model: String,
        effort: String,
        tier: Option<String>,
        source: Option<String>,
        plan_name: Option<String>,
        requests: i64,
        input: i64,
        output: i64,
        cache_read: i64,
        cost: f64,
        errors: i64,
        dur_sum: i64,
        dur_n: i64,
        ttft_sum: i64,
        ttft_n: i64,
    }
    let mut map: HashMap<String, Acc> = HashMap::new();
    for m in metrics {
        let key = format!(
            "{}\u{1}{}\u{1}{}",
            m.provider_id,
            m.model_id,
            m.subscription_tier.clone().unwrap_or_default(),
        );
        let acc = map.entry(key).or_insert_with(|| Acc {
            provider: m.provider_id.clone(),
            model: m.model_id.clone(),
            effort: m.effort_level.clone(),
            tier: m.subscription_tier.clone(),
            source: m.subscription_source.clone(),
            plan_name: m.plan_name.clone(),
            requests: 0,
            input: 0,
            output: 0,
            cache_read: 0,
            cost: 0.0,
            errors: 0,
            dur_sum: 0,
            dur_n: 0,
            ttft_sum: 0,
            ttft_n: 0,
        });
        acc.requests += 1;
        acc.input += m.input_tokens;
        acc.output += m.output_tokens;
        acc.cache_read += m.cache_read_tokens;
        acc.cost += m.cost_total.unwrap_or(0.0);
        if m.outcome == "error" {
            acc.errors += 1;
        }
        if let Some(d) = m.duration_ms {
            acc.dur_sum += d;
            acc.dur_n += 1;
        }
        if let Some(t) = m.ttft_ms {
            acc.ttft_sum += t;
            acc.ttft_n += 1;
        }
    }
    map.into_values()
        .map(|a| {
            json!({
                "provider": a.provider,
                "model": a.model,
                "effort": a.effort,
                "subscriptionTier": a.tier,
                "subscriptionSource": a.source,
                "planName": a.plan_name,
                "requests": a.requests,
                "inputTokens": a.input,
                "outputTokens": a.output,
                "cacheReadTokens": a.cache_read,
                "costTotal": a.cost,
                "errorCount": a.errors,
                "avgDurationMs": if a.dur_n > 0 { Some(a.dur_sum as f64 / a.dur_n as f64) } else { None },
                "avgTtftMs": if a.ttft_n > 0 { Some(a.ttft_sum as f64 / a.ttft_n as f64) } else { None },
            })
        })
        .collect()
}

/// POST a JSON-RPC body to the MCP endpoint and extract the result text.
/// Clears auth on 401. Shared by the raw-usage and message sync paths.
fn post_mcp(token: &str, rpc_body: &Value) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(MCP_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(rpc_body)
        .send()
        .map_err(|e| format!("Failed to connect to basebuild.net: {e}"))?;
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let _ = AuthService::clear_auth();
        return Err("Token expired or revoked. Please sign in again.".into());
    }
    if !status.is_success() {
        return Err(format!("MCP sync failed ({status}): {text}"));
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse MCP response: {e}"))?;
    if let Some(error) = parsed.get("error") {
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP error: {message}"));
    }
    Ok(parsed
        .get("result")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Synced successfully.")
        .to_string())
}

// ─── Projected-usage reads (native token, /api/mcp) ───────────────────────

/// Call an MCP `tools/call` method by name with no arguments, returning the
/// parsed `result.content[0].text` as a `Value`. On 401, clears auth.
pub(crate) fn call_mcp_tool(token: &str, tool: &str, arguments: Value) -> Result<Value, String> {
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
    let should_sync = v
        .get("shouldSync")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
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
        is_stale: row
            .get("isStale")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
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
        had_exhaustion_event: row
            .get("hadExhaustionEvent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        is_current: row
            .get("isCurrent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

// ─── Environment telemetry (installed tools, skills, providers) ──────────

/// Collect the user's installed-tool environment: connectors, skills,
/// provider credentials, OMP status, and app version. Sent to basebuild.net
/// via the `sync_environment` MCP tool for internal analytics (not shown
/// publicly). All fields are metadata only — no prompts, code, or secrets.
pub fn sync_environment_native() -> Result<String, String> {
    let token = AuthService::get_access_token()?.ok_or_else(|| "Not signed in".to_string())?;
    let env = collect_environment();
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "sync_environment",
            "arguments": env,
        }
    });
    post_mcp(&token, &rpc_body)
}

/// Gather environment metadata from local DB + filesystem. Each section is
/// best-effort: a failure in one section doesn't prevent the others.
fn collect_environment() -> Value {
    let connectors = collect_connectors();
    let skills = collect_skills();
    let providers = collect_providers();
    let omp = collect_omp_status();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    json!({
        "source": "basebuild-app",
        "appVersion": app_version,
        "connectors": connectors,
        "skills": skills,
        "providers": providers,
        "omp": omp,
        "collectedAt": now_seconds(),
    })
}

/// Registered connectors: id, name, version, enabled, state.
fn collect_connectors() -> Vec<Value> {
    crate::services::connector_service::ConnectorService::list()
        .unwrap_or_default()
        .into_iter()
        .map(|c| {
            json!({
                "id": c.manifest_id,
                "name": c.name,
                "version": c.version,
                "enabled": c.enabled,
                "state": c.state.as_str(),
            })
        })
        .collect()
}

/// Resolved skills: name, source, runtime.
fn collect_skills() -> Vec<Value> {
    crate::services::skill_registry_service::SkillRegistryService::list()
        .unwrap_or_default()
        .into_iter()
        .map(|s| {
            json!({
                "name": s.name,
                "source": match s.source {
                    crate::services::skill_registry_service::SkillSource::Bundled => "bundled",
                    crate::services::skill_registry_service::SkillSource::User => "user",
                    crate::services::skill_registry_service::SkillSource::Override => "override",
                },
                "runtime": match s.runtime {
                    crate::services::skill_registry_service::SkillRuntime::Native => "native",
                    crate::services::skill_registry_service::SkillRuntime::Omp => "omp",
                    crate::services::skill_registry_service::SkillRuntime::Both => "both",
                },
            })
        })
        .collect()
}

/// Provider credentials: which providers the user has auth'd (id + label only,
/// never tokens/keys).
fn collect_providers() -> Vec<Value> {
    crate::services::native_chat_service::NativeChatService::list_credentials()
        .unwrap_or_default()
        .into_iter()
        .map(|c| {
            json!({
                "providerId": c.provider_id,
                "label": c.label,
            })
        })
        .collect()
}

/// OMP install status: installed + version.
fn collect_omp_status() -> Value {
    let status = crate::services::omp_service::OmpService::status();
    json!({
        "installed": status.installed,
        "version": status.version,
    })
}

// ─── Auto-sync driver ──────────────────────────────────────────────────────

/// Check whether the gates currently allow a sync push: signed in AND
/// auto-sync enabled AND upload permission granted. Does not perform network
/// I/O for the gate check itself (only reads stored settings/auth).
pub fn gates_pass() -> bool {
    let token_ok = match AuthService::get_access_token() {
        Ok(Some(_)) => true,
        Ok(None) => {
            eprintln!("[SYNC] gates: no token");
            false
        }
        Err(e) => {
            eprintln!("[SYNC] gates: token error: {e}");
            false
        }
    };
    if !token_ok {
        return false;
    }
    let rules = match SettingsService::get_permission_rules() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[SYNC] gates: permission rules error: {e}");
            return false;
        }
    };
    if !rules.allow_usage_analytics_upload {
        eprintln!("[SYNC] gates: allow_usage_analytics_upload=false");
        return false;
    }
    let status = AUTOSYNC_STATUS.lock().clone();
    if !status.enabled {
        eprintln!("[SYNC] gates: auto_sync_usage=false (status.enabled=false)");
        return false;
    }
    true
}

/// Read the current auto-sync status (cached, no network I/O).
pub fn autosync_status() -> AutoSyncStatus {
    // Refresh gates_pass + interval from settings so the UI reflects truth.
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.gates_pass = gates_pass();
    let settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    status.enabled = settings.auto_sync_usage;
    status.interval_minutes = settings.auto_sync_interval_minutes.max(1);
    status.sync_mode = settings.usage_sync_mode.clone();
    // Write back so the cached status stays fresh for other callers.
    *AUTOSYNC_STATUS.lock() = status.clone();
    status
}

/// Read the current backoff in seconds. Reset to `INITIAL_BACKOFF_SECS`
/// after a successful sync, doubled (capped at `MAX_BACKOFF_SECS`) on
/// transient failure.
pub fn current_backoff_secs() -> u64 {
    BACKOFF_SECS.load(Ordering::SeqCst)
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

/// Persist the usage sync detail mode ("rows" | "summary").
pub fn set_usage_sync_mode(mode: &str) -> Result<(), String> {
    let normalized = if mode == "summary" { "summary" } else { "rows" };
    let mut settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    settings.usage_sync_mode = normalized.to_string();
    SettingsService::set_usage_sync_settings(&settings)?;
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.sync_mode = normalized.to_string();
    *AUTOSYNC_STATUS.lock() = status;
    Ok(())
}

/// Trigger a sync push now (manual or opportunistic). Re-checks gates and
/// freshness (unless `skip_freshness` is true), then calls
/// `sync_raw_usage_native`. Records last_sync_at / last_error and emits a
/// status event. Non-blocking on failure.
pub fn trigger_sync(app: AppHandle, reason: &str, skip_freshness: bool) {
    eprintln!("[SYNC] trigger_sync reason={reason} skip_freshness={skip_freshness}");
    if !gates_pass() {
        eprintln!("[SYNC] gates_pass=false — aborting (need: signed in + upload permission + auto-sync enabled)");
        return;
    }
    // Single-flight: if a sync is already in flight, coalesce this trigger
    // into the pending one rather than launching a duplicate.
    if SYNC_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        eprintln!("[SYNC] single-flight: a sync is already in flight — coalescing");
        return;
    }
    eprintln!("[SYNC] gates_pass=true");
    // Debounce: enforce a minimum gap between pushes.
    let now = now_seconds();
    {
        let status = AUTOSYNC_STATUS.lock().clone();
        if let Some(last) = status.last_sync_at {
            if now - last < MIN_INTER_SYNC_GAP_SECS {
                eprintln!(
                    "[SYNC] debounced — last sync was {}s ago, min gap is {}s",
                    now - last,
                    MIN_INTER_SYNC_GAP_SECS
                );
                SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
                return;
            }
        }
    }
    // Freshness check: ask the server if data is stale before pushing.
    // Skipped on startup so the first sync fires unconditionally.
    let should_push = if skip_freshness {
        let has_token = AuthService::get_access_token()
            .map(|t| t.is_some())
            .unwrap_or(false);
        eprintln!("[SYNC] skip_freshness=true, has_token={has_token}");
        has_token
    } else {
        match AuthService::get_access_token() {
            Ok(Some(token)) => {
                eprintln!("[SYNC] checking server freshness…");
                let fresh = call_mcp_tool(&token, "get_my_live_usage", json!({}))
                    .ok()
                    .and_then(|v| v.get("shouldSync").and_then(|v| v.as_bool()))
                    .unwrap_or(true);
                eprintln!("[SYNC] server shouldSync={fresh}");
                fresh
            }
            _ => {
                eprintln!("[SYNC] no token — aborting");
                false
            }
        }
    };
    if !should_push {
        eprintln!("[SYNC] should_push=false — aborting");
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    }
    eprintln!("[SYNC] launching sync thread…");

    let app2 = app.clone();
    let reason_owned = reason.to_string();
    thread::spawn(move || {
        eprintln!("[SYNC] thread started — calling sync_raw_usage_native…");
        let result = sync_raw_usage_native();
        eprintln!(
            "[SYNC] sync_raw_usage_native: {}",
            match &result {
                Ok(m) => format!("ok: {m}"),
                Err(e) => format!("ERR: {e}"),
            }
        );
        eprintln!("[SYNC] calling sync_envelope_native…");
        let messages_result = sync_envelope_native();
        eprintln!(
            "[SYNC] sync_envelope_native: {}",
            match &messages_result {
                Ok(m) => format!("ok: {m}"),
                Err(e) => format!("ERR: {e}"),
            }
        );
        eprintln!("[SYNC] calling sync_environment_native…");
        let env_result = sync_environment_native();
        eprintln!(
            "[SYNC] sync_environment_native: {}",
            match &env_result {
                Ok(m) => format!("ok: {m}"),
                Err(e) => format!("ERR: {e}"),
            }
        );
        let now = now_seconds();
        let mut status = AUTOSYNC_STATUS.lock().clone();
        match result {
            Ok(msg) => {
                status.last_sync_at = Some(now);
                status.last_error = None;
                // Reset backoff on success.
                BACKOFF_SECS.store(INITIAL_BACKOFF_SECS, Ordering::SeqCst);
                let extra = match &messages_result {
                    Ok(m) => format!(" | messages: {m}"),
                    Err(e) => format!(" | messages sync failed: {e}"),
                };
                let env_extra = match &env_result {
                    Ok(_) => " | env: ok".to_string(),
                    Err(e) => format!(" | env sync failed: {e}"),
                };
                eprintln!("[SYNC] ✅ all syncs complete: {reason_owned}: {msg}{extra}{env_extra}");
                let _ = app2.emit(
                    USAGE_SYNC_STATUS,
                    &SyncResult {
                        ok: true,
                        message: format!("{reason_owned}: {msg}{extra}{env_extra}"),
                        completed_at: now,
                    },
                );
            }
            Err(e) => {
                status.last_error = Some(e.clone());
                // Increase backoff on transient failure (doubled, capped).
                let current = BACKOFF_SECS.load(Ordering::SeqCst);
                let next = (current * 2).min(MAX_BACKOFF_SECS);
                BACKOFF_SECS.store(next, Ordering::SeqCst);
                eprintln!("[SYNC] ❌ raw usage sync failed: {e} (backoff: {next}s)");
                let _ = app2.emit(
                    USAGE_SYNC_STATUS,
                    &SyncResult {
                        ok: false,
                        message: format!("{reason_owned}: {e}"),
                        completed_at: now,
                    },
                );
                // If the error was auth-related, emit auth-changed so the UI prompts re-sign-in.
                if e.contains("Token expired") || e.contains("Not signed in") {
                    let _ = app2.emit(AUTH_CHANGED, ());
                }
            }
        }
        *AUTOSYNC_STATUS.lock() = status;
        // Release the single-flight guard.
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

/// Start the auto-sync background loop. Idempotent. Ticks every
/// `autoSyncIntervalMinutes` and on each tick re-checks gates + freshness.
pub fn start_autosync_loop(app: AppHandle) {
    eprintln!("[SYNC] start_autosync_loop called");
    if AUTOSYNC_RUNNING.swap(true, Ordering::SeqCst) {
        eprintln!("[SYNC] autosync already running — skipping");
        return;
    }
    eprintln!("[SYNC] autosync loop starting…");
    thread::spawn(move || {
        let mut first_tick = true;
        loop {
            if !AUTOSYNC_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            let interval_minutes = autosync_status().interval_minutes.max(1);
            // First tick = startup: sync unconditionally (skip freshness check)
            // so the user's data flows immediately on app launch. Subsequent
            // ticks use the server freshness check to avoid redundant pushes.
            trigger_sync(
                app.clone(),
                if first_tick { "startup" } else { "hourly" },
                first_tick,
            );
            first_tick = false;
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

/// Blocking final sync on app exit. Bypasses debounce + freshness — just
/// pushes everything if gates pass. Called from `RunEvent::ExitRequested` so
/// the app doesn't exit until the push completes (or times out after 10s).
/// Best-effort: errors are logged, never propagated — we must not block exit.
pub fn sync_on_exit() {
    eprintln!("[SYNC] sync_on_exit — final push before exit");
    if !gates_pass() {
        eprintln!("[SYNC] sync_on_exit: gates fail — skipping");
        return;
    }
    // Stop the autosync loop so it doesn't race with this final push.
    stop_autosync_loop();
    // Blocking sync with a timeout — we can't hang the exit forever.
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let raw = sync_raw_usage_native();
        let msgs = sync_envelope_native();
        eprintln!(
            "[SYNC] sync_on_exit: raw={:?}, msgs={:?}",
            raw.is_ok(),
            msgs.is_ok()
        );
        let _ = tx.send(());
    });
    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(()) => eprintln!("[SYNC] sync_on_exit: final push complete"),
        Err(_) => eprintln!("[SYNC] sync_on_exit: timed out after 10s — exiting anyway"),
    }
}
fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

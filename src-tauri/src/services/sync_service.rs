use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::{AUTH_CHANGED, USAGE_SYNC_STATUS};
use crate::models::usage_envelope::{build_envelope, SourceKind, UsageBatch, ENVELOPE_VERSION};
use crate::models::usage_sync::{
    AutoSyncStatus, LiveUsage, LiveUsageRow, PlanSummaries, PlanSummary, PlanTimeline,
    PlanTimelineWindow, ProjectedUsage, SourceSyncStatus, SyncAttribution, SyncOffReason,
    SyncOverallOutcome, SyncResult, UsageSnapshot, UsageSnapshotRow,
};
use crate::services::analytics_service::AnalyticsService;
use crate::services::auth_service::{AuthService, GuestSyncAuth};
use crate::services::execution_advisor_service::ExecutionAdvisorService;
use crate::services::omp_service::OmpService;
use crate::services::settings_service::SettingsService;
use crate::services::storage_service::StorageService;

const MCP_URL: &str = "https://basebuild.net/api/mcp";
const GUEST_BOOTSTRAP_URL: &str = "https://basebuild.net/api/auth/guest/bootstrap";
/// Minimum gap between sync pushes in seconds, even if a trigger fires.
const MIN_INTER_SYNC_GAP_SECS: i64 = 60;
/// Default interval (minutes) when the setting is missing or zero.
const DEFAULT_INTERVAL_MINUTES: i64 = 60;
/// Maximum backoff in seconds (15 minutes).
const MAX_BACKOFF_SECS: u64 = 900;
/// Initial backoff in seconds.
const INITIAL_BACKOFF_SECS: u64 = 30;
/// Managed-trigger evaluation cadence (seconds). The autosync loop wakes
/// every 5 minutes between full interval ticks to check whether a
/// never-synced device, a provider-set change, or a significant usage
/// delta should fire an early sync.
const MANAGED_TRIGGER_EVAL_SECS: u64 = 300;
/// Request-count delta that fires a managed-trigger sync: ≥25 absolute
/// OR ≥20% relative vs the last pushed total.
const MANAGED_TRIGGER_ABS_DELTA: i64 = 25;
const MANAGED_TRIGGER_REL_PCT: f64 = 0.20;

/// Every usage write carries a bearer token. Account tokens preserve private
/// attribution; guest tokens represent only a random local installation UUID.
enum AuthMode {
    AccountToken(String),
    GuestToken(String),
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuestBootstrapResponse {
    access_token: String,
    expires_at: String,
    scopes: Vec<String>,
}

fn bootstrap_guest_sync_auth() -> Result<GuestSyncAuth, String> {
    for attempt in 0..2 {
        let installation_id = uuid::Uuid::new_v4().to_string();
        let response = reqwest::blocking::Client::new()
            .post(GUEST_BOOTSTRAP_URL)
            .header("Content-Type", "application/json")
            .json(&json!({ "installationId": installation_id }))
            .send()
            .map_err(|error| format!("Failed to bootstrap guest usage sync: {error}"))?;
        let status = response.status();
        let text = response.text().unwrap_or_default();
        if status == reqwest::StatusCode::CONFLICT && attempt == 0 {
            continue;
        }
        if !status.is_success() {
            return Err(format!("Guest usage bootstrap failed ({status}): {text}"));
        }
        let parsed: GuestBootstrapResponse = serde_json::from_str(&text)
            .map_err(|error| format!("Failed to parse guest usage bootstrap: {error}"))?;
        if !parsed.access_token.starts_with("bb_guest_")
            || parsed.scopes.as_slice() != ["usage:write"]
        {
            return Err("Guest usage bootstrap returned an invalid credential".to_string());
        }
        let auth = GuestSyncAuth {
            installation_id,
            access_token: parsed.access_token,
            expires_at: parsed.expires_at,
            scopes: parsed.scopes,
        };
        AuthService::save_guest_sync_auth(&auth)?;
        return Ok(auth);
    }
    Err("Guest usage bootstrap could not register an installation".to_string())
}

fn resolve_auth_mode() -> Result<AuthMode, String> {
    if let Ok(Some(token)) = AuthService::get_access_token() {
        if !token.is_empty() {
            return Ok(AuthMode::AccountToken(token));
        }
    }
    if let Some(auth) = AuthService::load_guest_sync_auth()? {
        if auth.access_token.starts_with("bb_guest_") && auth.scopes.as_slice() == ["usage:write"] {
            return Ok(AuthMode::GuestToken(auth.access_token));
        }
        AuthService::clear_guest_sync_auth()?;
    }
    Ok(AuthMode::GuestToken(
        bootstrap_guest_sync_auth()?.access_token,
    ))
}

fn has_account_token() -> bool {
    AuthService::get_access_token()
        .ok()
        .flatten()
        .is_some_and(|token| !token.is_empty())
}

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
    off_reason: Some(SyncOffReason::ConsentRequired),
    attribution: SyncAttribution::PrivateInstallation,
    interval_minutes: DEFAULT_INTERVAL_MINUTES,
    last_sync_at: None,
    last_error: None,
    sync_mode: String::new(),
    overall_outcome: None,
    sources: Vec::new(),
});

/// Sync raw OMP usage for signed-in accounts. Private-installation principals
/// are write-only for the closed envelope and never upload raw OMP blobs.
pub fn sync_raw_usage_native() -> Result<String, String> {
    // OMP raw-usage collection is optional enrichment: `omp stats/usage`
    // attribute OMP-driven usage. When OMP is not installed there is nothing
    // to collect, so skip gracefully instead of erroring — the sync loop must
    // never record a failure tied to a missing optional dependency. Native
    // per-message usage is carried by `sync_messages_native`.
    if !OmpService::status().installed {
        return Ok("skipped: OMP not installed (native message sync carries usage)".to_string());
    }
    let mode = resolve_auth_mode()?;
    if matches!(&mode, AuthMode::GuestToken(_)) {
        return Ok("skipped: raw OMP upload is available to signed-in accounts only".to_string());
    }

    // Collect OMP stats and usage
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

    post_mcp(&mode, &rpc_body)
}

/// Sync per-message usage rows to basebuild.net via the `sync_messages` MCP
/// tool. Reads native chat request metrics since the last message-sync cursor
/// and sends them either as raw rows (server rolls up + owns aggregation) or as
/// client-side summaries, per the `usage_sync_mode` setting. Advances the
/// cursor only on a successful push. Returns a human-readable result message.
pub fn sync_messages_native() -> Result<String, String> {
    use crate::services::native_chat_service::NativeChatService;

    let mode = resolve_auth_mode()?;

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

    let result = post_mcp(&mode, &rpc_body)?;
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
        .map(|metric| {
            let duration_ms = metric.duration_ms.unwrap_or(0).clamp(0, i32::MAX as i64);
            let ttft_ms = metric.ttft_ms.unwrap_or(0).clamp(0, i32::MAX as i64);
            let cost_total = metric
                .cost_total
                .filter(|cost| cost.is_finite() && *cost >= 0.0)
                .unwrap_or(0.0)
                .min(1_000_000.0);
            json!({
                "kind": "model_usage",
                "provider": metric.provider_id,
                "model": metric.model_id,
                "effort": match metric.effort_level.as_str() {
                    "none" | "low" | "medium" | "high" | "xhigh" => Some(metric.effort_level.as_str()),
                    _ => None,
                },
                "subscriptionTier": metric.subscription_tier.as_deref().filter(|tier| matches!(*tier, "plus" | "pro" | "max" | "free" | "api" | "team" | "enterprise")),
                "subscriptionSource": metric.subscription_source.as_deref().filter(|source| matches!(*source, "declared" | "provider-api" | "api-key" | "inferred" | "unknown")),
                "planName": metric.plan_name.as_deref().filter(|name| name.chars().count() <= 256),
                "requests": 1,
                "inputTokens": metric.input_tokens.clamp(0, i32::MAX as i64),
                "outputTokens": metric.output_tokens.clamp(0, i32::MAX as i64),
                "cacheReadTokens": metric.cache_read_tokens.clamp(0, i32::MAX as i64),
                "cacheWriteTokens": metric.cache_write_tokens.clamp(0, i32::MAX as i64),
                "costTotal": cost_total,
                "durationMs": duration_ms,
                "durationCount": i64::from(metric.duration_ms.is_some()),
                "ttftMs": ttft_ms,
                "ttftCount": i64::from(metric.ttft_ms.is_some()),
                "errors": i64::from(metric.outcome != "success"),
            })
        })
        .collect();

    let window_start = metrics.iter().map(|m| m.created_at).min().unwrap_or(since);
    let window_end = metrics.iter().map(|m| m.created_at).max().unwrap_or(since);

    Ok(UsageBatch {
        source: SourceKind::Native,
        idempotency_key: format!("native:{window_start}:{window_end}:v1"),
        window_start,
        window_end,
        rows,
    })
}

/// Sync every available closed-envelope source. Private installations include
/// OMP aggregates here; signed-in accounts use the richer raw OMP path and
/// exclude OMP from the envelope to prevent duplicate attribution.
pub fn sync_envelope_native() -> Result<String, String> {
    let mode = resolve_auth_mode()?;
    let include_omp = matches!(&mode, AuthMode::GuestToken(_));
    let collections = crate::services::usage_source_service::collect_all_sources(include_omp);
    for collection in &collections {
        let state = if collection.batch.is_some() {
            "pending batch"
        } else {
            "no batch"
        };
        eprintln!("[SYNC] source {}: {state}", collection.source.as_str());
        if collection.diagnostic.contains(" error:") {
            record_source_error(collection.source, "Could not read local aggregate usage");
        }
    }
    let batches: Vec<UsageBatch> = collections
        .into_iter()
        .filter_map(|collection| collection.batch)
        .collect();
    if batches.is_empty() {
        return Ok("no new envelope usage data".to_string());
    }

    let envelope = build_envelope(batches, now_seconds())
        .map_err(|error| format!("envelope validation failed: {error}"))?;
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "sync_usage_envelope",
            "arguments": serde_json::to_value(&envelope)
                .map_err(|error| format!("Failed to serialize usage envelope: {error}"))?,
        }
    });

    let result_text = match post_mcp(&mode, &rpc_body) {
        Ok(result) => result,
        Err(error) => {
            for batch in &envelope.batches {
                record_source_error(batch.source, "Upload failed; retry is pending");
            }
            return Err(error);
        }
    };
    let acknowledgment: Value = serde_json::from_str(&result_text)
        .map_err(|error| format!("Invalid usage-envelope acknowledgment: {error}"))?;
    if acknowledgment.get("ok").and_then(Value::as_bool) != Some(true) {
        for batch in &envelope.batches {
            record_source_error(batch.source, "Server did not accept this aggregate batch");
        }
        return Err("Usage envelope was not durably accepted".to_string());
    }
    let receipts = acknowledgment
        .get("receipts")
        .and_then(Value::as_array)
        .ok_or_else(|| "Usage-envelope acknowledgment omitted receipts".to_string())?;
    let sources = crate::services::usage_source_service::registered_sources();
    let mut accepted = 0usize;
    let mut rejected = 0usize;
    for batch in &envelope.batches {
        let receipt = receipts.iter().find(|receipt| {
            receipt.get("source").and_then(Value::as_str) == Some(batch.source.as_str())
                && receipt.get("idempotencyKey").and_then(Value::as_str)
                    == Some(batch.idempotency_key.as_str())
        });
        let receipt_status = receipt
            .and_then(|receipt| receipt.get("status"))
            .and_then(Value::as_str);
        if matches!(receipt_status, Some("accepted" | "already_accepted")) {
            if let Some(source) = sources.iter().find(|source| source.kind() == batch.source) {
                source.advance_checkpoint(batch).map_err(|error| {
                    record_source_error(
                        batch.source,
                        "Accepted usage could not advance its local cursor",
                    );
                    format!(
                        "{} usage was accepted but its local cursor could not advance: {error}",
                        batch.source.as_str()
                    )
                })?;
            }
            let processed_at = receipt
                .and_then(|receipt| receipt.get("processedAt"))
                .and_then(Value::as_i64);
            record_source_success(batch.source, now_seconds(), processed_at);
            accepted += 1;
        } else {
            record_source_error(batch.source, "Server rejected this aggregate batch");
            rejected += 1;
        }
    }
    if rejected > 0 {
        return Err(format!(
            "Usage envelope partially accepted: {accepted} accepted, {rejected} rejected"
        ));
    }
    Ok(format!(
        "envelope v{ENVELOPE_VERSION}: {accepted} source batch(es) accepted"
    ))
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
            if t > 0 {
                acc.ttft_sum += t;
                acc.ttft_n += 1;
            }
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
                "errors": a.errors,
                "durationMs": a.dur_sum,
                "durationN": a.dur_n,
                "ttftMs": a.ttft_sum,
                "ttftN": a.ttft_n,
            })
        })
        .collect()
}
fn post_mcp(mode: &AuthMode, rpc_body: &Value) -> Result<String, String> {
    let token = match mode {
        AuthMode::AccountToken(token) | AuthMode::GuestToken(token) => token,
    };
    let response = reqwest::blocking::Client::new()
        .post(MCP_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(rpc_body)
        .send()
        .map_err(|error| format!("Failed to connect to basebuild.net: {error}"))?;
    let status = response.status();
    let text = response.text().unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        match mode {
            AuthMode::AccountToken(_) => {
                let _ = AuthService::clear_auth();
                return Err("Account token expired or was revoked. Please sign in again.".into());
            }
            AuthMode::GuestToken(_) => {
                let _ = AuthService::clear_guest_sync_auth();
                return Err(
                    "Guest sync credential expired or was revoked; retry to register a new credential."
                        .into(),
                );
            }
        }
    }
    if !status.is_success() {
        return Err(format!("MCP sync failed ({status}): {text}"));
    }
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Failed to parse MCP response: {error}"))?;
    if let Some(error) = parsed.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP error: {message}"));
    }
    let result = parsed
        .get("result")
        .ok_or_else(|| "MCP response omitted result".to_string())?;
    let result_text = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .ok_or_else(|| "MCP response omitted result content".to_string())?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(format!("MCP tool rejected usage: {result_text}"));
    }
    Ok(result_text.to_string())
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

/// Fetch the full projected-usage payload for the Account page and retain a
/// privacy-safe last-good local cache for the execution advisor.
pub fn fetch_projected_usage() -> Result<ProjectedUsage, String> {
    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    let live_result = call_mcp_tool(&token, "get_my_live_usage", json!({}));
    let snapshot_result = call_mcp_tool(&token, "get_my_usage", json!({}));
    let plans_result = call_mcp_tool(&token, "list_my_plans", json!({}));
    let timeline_result = call_mcp_tool(&token, "get_my_plan_timeline", json!({}));
    let success_count = [
        live_result.is_ok(),
        snapshot_result.is_ok(),
        plans_result.is_ok(),
        timeline_result.is_ok(),
    ]
    .into_iter()
    .filter(|success| *success)
    .count();

    if success_count == 0 {
        let error =
            "All projected-usage reads failed; using the last-good local cache when available.";
        mark_projected_usage_cache_error(error);
        if let Some((cached, _, _)) = cached_projected_usage()? {
            return Ok(cached);
        }
    }

    let usage = ProjectedUsage {
        live: live_result.map(parse_live_usage).unwrap_or_default(),
        snapshot: snapshot_result
            .map(parse_usage_snapshot)
            .unwrap_or_default(),
        plans: plans_result.map(parse_plan_summaries).unwrap_or_default(),
        timeline: timeline_result.map(parse_plan_timeline).unwrap_or_default(),
        assembled_at: now_seconds(),
    };
    save_projected_usage_cache(&usage)?;
    Ok(usage)
}

pub fn cached_projected_usage() -> Result<Option<(ProjectedUsage, i64, Option<String>)>, String> {
    let conn = StorageService::connect()?;
    let row = conn
        .query_row(
            "SELECT usage_json, fetched_at, error FROM execution_usage_cache WHERE key = 'projected'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((json, fetched_at, error)) = row else {
        return Ok(None);
    };
    let usage = serde_json::from_str(&json)
        .map_err(|error| format!("Cached projected usage is invalid: {error}"))?;
    Ok(Some((usage, fetched_at, error)))
}

fn save_projected_usage_cache(usage: &ProjectedUsage) -> Result<(), String> {
    let json = serde_json::to_string(usage).map_err(|error| error.to_string())?;
    let conn = StorageService::connect()?;
    conn.execute(
        "INSERT INTO execution_usage_cache (key, usage_json, fetched_at, error)
         VALUES ('projected', ?1, ?2, NULL)
         ON CONFLICT(key) DO UPDATE SET
            usage_json = excluded.usage_json,
            fetched_at = excluded.fetched_at,
            error = NULL",
        params![json, usage.assembled_at],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn mark_projected_usage_cache_error(error: &str) {
    let Ok(conn) = StorageService::connect() else {
        return;
    };
    let bounded = error.chars().take(1_000).collect::<String>();
    let _ = conn.execute(
        "UPDATE execution_usage_cache SET error = ?1 WHERE key = 'projected'",
        params![bounded],
    );
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
    let mode = resolve_auth_mode()?;
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
    post_mcp(&mode, &rpc_body)
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

fn advisor_feedback_upload_ready() -> bool {
    AnalyticsService::upload_enabled()
        && ExecutionAdvisorService::feedback_consent()
            .map(|consent| consent.enabled)
            .unwrap_or(false)
        && ExecutionAdvisorService::list_feedback()
            .map(|events| !events.is_empty())
            .unwrap_or(false)
}

fn sync_execution_advisor_feedback_native() -> Result<usize, String> {
    if !AnalyticsService::upload_enabled() {
        return Ok(0);
    }
    if !ExecutionAdvisorService::feedback_consent()?.enabled {
        return Ok(0);
    }
    let events = ExecutionAdvisorService::list_feedback()?;
    if events.is_empty() {
        return Ok(0);
    }
    let token = AuthService::get_access_token()?.ok_or_else(|| "Not signed in".to_string())?;
    let mut submitted = 0;
    for event in events {
        call_mcp_tool(
            &token,
            "submit_execution_feedback",
            json!({
                "schemaVersion": event.schema_version,
                "role": event.role,
                "recommendedProviderId": event.recommended_provider_id,
                "recommendedModelId": event.recommended_model_id,
                "selectedProviderId": event.selected_provider_id,
                "selectedModelId": event.selected_model_id,
                "outcome": event.outcome,
                "confidence": event.confidence,
                "difficultyBucket": event.difficulty_bucket,
                "effortBucket": event.effort_bucket,
            }),
        )?;
        if ExecutionAdvisorService::delete_feedback_event(&event.id)? {
            submitted += 1;
        }
    }
    Ok(submitted)
}

// ─── Auto-sync driver ──────────────────────────────────────────────────────

/// Check the persisted completion-gated consent and auto-sync switches.
/// This function is side-effect free: it never bootstraps credentials or
/// performs network I/O.
pub fn gates_pass() -> bool {
    let consent = match AnalyticsService::get_consent() {
        Ok(consent) => consent,
        Err(error) => {
            eprintln!("[SYNC] gates: consent read failed: {error}");
            return false;
        }
    };
    if consent.consented_at.is_none() || !consent.upload_enabled {
        eprintln!("[SYNC] gates: aggregate usage upload has not been completed");
        return false;
    }
    let settings = match SettingsService::get_usage_sync_settings() {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("[SYNC] gates: usage sync settings read failed: {error}");
            return false;
        }
    };
    if !settings.auto_sync_usage {
        eprintln!("[SYNC] gates: auto_sync_usage=false");
        return false;
    }
    true
}

fn current_source_statuses(previous: &[SourceSyncStatus]) -> Vec<SourceSyncStatus> {
    crate::services::usage_source_service::registered_sources()
        .into_iter()
        .map(|source| {
            let available = source.available();
            let old = previous
                .iter()
                .find(|status| status.source == source.kind().as_str());
            SourceSyncStatus {
                source: source.kind().as_str().to_string(),
                available,
                availability_reason: (!available).then(|| match source.kind() {
                    SourceKind::Omp => "Oh My Pi is not installed".to_string(),
                    SourceKind::Native => "Native usage ledger is unavailable".to_string(),
                    _ => "No local aggregate history was detected".to_string(),
                }),
                pending_retry: old.is_some_and(|status| status.pending_retry),
                last_success_at: old.and_then(|status| status.last_success_at),
                last_processed_at: old.and_then(|status| status.last_processed_at),
                last_error: old.and_then(|status| status.last_error.clone()),
            }
        })
        .collect()
}

fn record_source_success(source: SourceKind, accepted_at: i64, processed_at: Option<i64>) {
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.sources = current_source_statuses(&status.sources);
    if let Some(entry) = status
        .sources
        .iter_mut()
        .find(|entry| entry.source == source.as_str())
    {
        entry.pending_retry = false;
        entry.last_success_at = Some(accepted_at);
        entry.last_processed_at = processed_at.or(entry.last_processed_at);
        entry.last_error = None;
    }
    *AUTOSYNC_STATUS.lock() = status;
}

fn record_source_error(source: SourceKind, message: &str) {
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.sources = current_source_statuses(&status.sources);
    if let Some(entry) = status
        .sources
        .iter_mut()
        .find(|entry| entry.source == source.as_str())
    {
        entry.pending_retry = true;
        entry.last_error = Some(message.to_string());
    }
    *AUTOSYNC_STATUS.lock() = status;
}

/// Read the current auto-sync status without performing network I/O.
pub fn autosync_status() -> AutoSyncStatus {
    let settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    let consent = AnalyticsService::get_consent().unwrap_or_default();
    let mut status = AUTOSYNC_STATUS.lock().clone();
    status.enabled = settings.auto_sync_usage;
    status.interval_minutes = settings.auto_sync_interval_minutes.max(1);
    status.sync_mode = settings.usage_sync_mode.clone();
    status.attribution = if has_account_token() {
        SyncAttribution::Account
    } else {
        SyncAttribution::PrivateInstallation
    };
    status.sources = current_source_statuses(&status.sources);
    status.off_reason = if consent.consented_at.is_none() {
        Some(SyncOffReason::ConsentRequired)
    } else if !consent.upload_enabled {
        Some(SyncOffReason::UsageSharingDisabled)
    } else if !settings.auto_sync_usage {
        Some(SyncOffReason::AutoSyncDisabled)
    } else if status.sources.iter().all(|source| !source.available) {
        Some(SyncOffReason::NoSourcesAvailable)
    } else {
        None
    };
    status.gates_pass = status.off_reason.is_none();
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
    let _ = autosync_status();
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
fn coordinated_usage_outcome(
    omp: &Result<String, String>,
    envelope: &Result<String, String>,
) -> SyncOverallOutcome {
    let omp_work = omp
        .as_ref()
        .is_ok_and(|message| !message.starts_with("skipped:"));
    let envelope_work = envelope
        .as_ref()
        .is_ok_and(|message| !message.starts_with("no new"));
    let successes = usize::from(omp_work) + usize::from(envelope_work);
    let failures = usize::from(omp.is_err()) + usize::from(envelope.is_err());
    match (successes, failures) {
        (0, 0) => SyncOverallOutcome::NothingToSync,
        (_, 0) => SyncOverallOutcome::Success,
        (0, _) => SyncOverallOutcome::Failed,
        _ => SyncOverallOutcome::Partial,
    }
}

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
    // Only account principals can use the read-side freshness tool. Guest
    // principals push the bounded envelope directly; server receipts dedupe it.
    let should_push = if skip_freshness {
        true
    } else if has_account_token() {
        match AuthService::get_access_token() {
            Ok(Some(token)) => {
                eprintln!("[SYNC] checking server freshness…");
                let usage_is_stale = call_mcp_tool(&token, "get_my_live_usage", json!({}))
                    .ok()
                    .and_then(|v| v.get("shouldSync").and_then(|v| v.as_bool()))
                    .unwrap_or(true);
                let feedback_is_pending = advisor_feedback_upload_ready();
                let should_sync = usage_is_stale || feedback_is_pending;
                eprintln!(
                    "[SYNC] server shouldSync={usage_is_stale}, advisor feedback pending={feedback_is_pending}"
                );
                should_sync
            }
            _ => {
                eprintln!("[SYNC] token disappeared — aborting");
                false
            }
        }
    } else {
        eprintln!("[SYNC] guest envelope push — no read-side freshness permission");
        true
    };

    if !should_push {
        eprintln!("[SYNC] should_push=false — aborting");
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    }
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
        eprintln!("[SYNC] calling sync_execution_advisor_feedback_native…");
        let feedback_result = sync_execution_advisor_feedback_native();
        eprintln!(
            "[SYNC] advisor feedback sync: {}",
            match &feedback_result {
                Ok(count) => format!("ok: {count} submitted"),
                Err(error) => format!("ERR: {error}"),
            }
        );
        match &result {
            Ok(message) if !message.starts_with("skipped:") => {
                record_source_success(SourceKind::Omp, now, None);
            }
            Err(_) => record_source_error(SourceKind::Omp, "OMP upload failed; retry is pending"),
            _ => {}
        }

        let outcome = coordinated_usage_outcome(&result, &messages_result);
        let mut status = AUTOSYNC_STATUS.lock().clone();
        status.overall_outcome = Some(outcome);
        let usage_error = match (&result, &messages_result) {
            (Err(omp), Err(envelope)) => Some(format!("OMP: {omp}; aggregates: {envelope}")),
            (Err(omp), _) => Some(format!("OMP: {omp}")),
            (_, Err(envelope)) => Some(format!("Aggregates: {envelope}")),
            _ => None,
        };
        let completed_any = matches!(
            outcome,
            SyncOverallOutcome::Success
                | SyncOverallOutcome::Partial
                | SyncOverallOutcome::NothingToSync
        );
        if completed_any {
            status.last_sync_at = Some(now);
            if let Ok(mut settings) = SettingsService::get_usage_sync_settings() {
                settings.last_usage_sync_at = Some(now);
                settings.last_provider_fingerprint = current_provider_fingerprint();
                settings.last_known_request_total = current_request_total();
                let _ = SettingsService::set_usage_sync_settings(&settings);
            }
        }
        if matches!(
            outcome,
            SyncOverallOutcome::Success | SyncOverallOutcome::NothingToSync
        ) {
            status.last_error = None;
            BACKOFF_SECS.store(INITIAL_BACKOFF_SECS, Ordering::SeqCst);
        } else {
            status.last_error = Some(match outcome {
                SyncOverallOutcome::Partial => {
                    "Some usage sources failed; retry is pending".to_string()
                }
                _ => "Usage sync failed; retry is pending".to_string(),
            });
            let current = BACKOFF_SECS.load(Ordering::SeqCst);
            BACKOFF_SECS.store((current * 2).min(MAX_BACKOFF_SECS), Ordering::SeqCst);
        }

        let environment_note = if env_result.is_ok() {
            "environment metadata handled"
        } else {
            "environment metadata not uploaded"
        };
        let feedback_note = if feedback_result.is_ok() {
            "advisor feedback handled"
        } else {
            "advisor feedback not uploaded"
        };
        let message = format!(
            "{reason_owned}: usage {}; {environment_note}; {feedback_note}",
            match outcome {
                SyncOverallOutcome::Success => "synced",
                SyncOverallOutcome::Partial => "partially synced; retry pending",
                SyncOverallOutcome::Failed => "failed; retry pending",
                SyncOverallOutcome::NothingToSync => "already current",
            }
        );
        let ok = matches!(
            outcome,
            SyncOverallOutcome::Success | SyncOverallOutcome::NothingToSync
        );
        let _ = app2.emit(
            USAGE_SYNC_STATUS,
            &SyncResult {
                ok,
                message,
                completed_at: now,
            },
        );
        if usage_error
            .as_deref()
            .is_some_and(|error| error.contains("Token expired") || error.contains("Not signed in"))
        {
            let _ = app2.emit(AUTH_CHANGED, ());
        }
        *AUTOSYNC_STATUS.lock() = status;
        // Release the single-flight guard.
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

/// Compute the current provider fingerprint: a stable, order-independent
/// hash of the set of connected provider/account identities (provider id +
/// credential label only — never tokens). Used by managed triggers to
/// detect "a new provider was added" between evaluations.
fn current_provider_fingerprint() -> Option<String> {
    let mut creds = crate::services::native_chat_service::NativeChatService::list_credentials()
        .unwrap_or_default()
        .into_iter()
        .map(|c| format!("{}|{}", c.provider_id, c.label))
        .collect::<Vec<_>>();
    creds.sort();
    if creds.is_empty() {
        return None;
    }
    Some(creds.join(","))
}

/// Approximate total request count across all local usage sources. Used by
/// the significant-usage-change managed trigger. Reads native chat metrics
/// totals + OMP stats when available; never sends data here.
fn current_request_total() -> Option<i64> {
    let mut total: i64 = 0;
    if let Ok(metrics) =
        crate::services::native_chat_service::NativeChatService::metrics_since(0, 1_000_000)
    {
        total += metrics.len() as i64;
    }
    if let Ok(stats) = crate::services::omp_service::OmpService::run_json(&["stats", "--json"]) {
        if stats.success {
            if let Some(json) = &stats.json {
                if let Some(by_model) = json.get("byModel").and_then(|v| v.as_array()) {
                    for row in by_model {
                        if let Some(count) = row.get("requests").and_then(|v| v.as_i64()) {
                            total += count;
                        }
                    }
                }
            }
        }
    }
    Some(total)
}

/// Evaluate managed-trigger conditions against persisted state. Returns
/// true when an event-driven sync should fire before the next scheduled
/// tick. Also updates the persisted fingerprint/totals so a restart does
/// not re-fire the same condition. Conditions:
/// - never-synced: `last_usage_sync_at` is null
/// - provider-set change: fingerprint differs from the last recorded
/// - significant usage delta: ≥25 absolute OR ≥20% relative
fn managed_trigger_should_fire() -> bool {
    if !gates_pass() {
        return false;
    }
    let mut settings = match SettingsService::get_usage_sync_settings() {
        Ok(s) => s,
        Err(_) => return false,
    };
    let never_synced = settings.last_usage_sync_at.is_none();
    let fingerprint = current_provider_fingerprint();
    let provider_changed = settings.last_provider_fingerprint.as_deref() != fingerprint.as_deref();
    let total = current_request_total();
    let usage_delta = match (settings.last_known_request_total, total) {
        (Some(last), Some(now)) => {
            let abs = (now - last).abs();
            let rel = if last > 0 {
                (now - last).unsigned_abs() as f64 / last as f64
            } else {
                0.0
            };
            abs >= MANAGED_TRIGGER_ABS_DELTA || rel >= MANAGED_TRIGGER_REL_PCT
        }
        (None, Some(_)) => true, // first time we can measure — treat as a trigger
        _ => false,
    };
    let fire = never_synced || provider_changed || usage_delta;
    if fire {
        // Record the new baseline so we don't re-fire for the same state.
        settings.last_provider_fingerprint = fingerprint;
        settings.last_known_request_total = total;
        let _ = SettingsService::set_usage_sync_settings(&settings);
    }
    fire
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
            // so the device's data flows immediately on app launch. Subsequent
            // ticks use the server freshness check (authed) or push directly
            // (anonymous — server dedups by computerId).
            trigger_sync(
                app.clone(),
                if first_tick { "startup" } else { "hourly" },
                first_tick,
            );
            first_tick = false;
            // Sleep for the interval, waking every MANAGED_TRIGGER_EVAL_SECS
            // to evaluate event-driven triggers (never-synced, provider-set
            // change, significant usage delta) and to exit promptly when stopped.
            let sleep_secs = (interval_minutes as u64) * 60;
            let mut slept = 0u64;
            while slept < sleep_secs {
                if !AUTOSYNC_RUNNING.load(Ordering::SeqCst) {
                    break;
                }
                let chunk = std::cmp::min(MANAGED_TRIGGER_EVAL_SECS, sleep_secs - slept);
                thread::sleep(Duration::from_secs(chunk));
                slept += chunk;
                // Only evaluate managed triggers between full ticks (not at
                // the very start — the first_tick already fired above).
                if slept < sleep_secs && managed_trigger_should_fire() {
                    eprintln!("[SYNC] managed trigger fired — early sync");
                    trigger_sync(app.clone(), "managed-trigger", true);
                }
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
        let feedback = sync_execution_advisor_feedback_native();
        eprintln!(
            "[SYNC] sync_on_exit: raw={:?}, msgs={:?}, advisor_feedback={:?}",
            raw.is_ok(),
            msgs.is_ok(),
            feedback.is_ok()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(message: &str) -> Result<String, String> {
        Ok(message.to_string())
    }

    fn error() -> Result<String, String> {
        Err("transport failed".to_string())
    }

    #[test]
    fn coordinated_outcome_does_not_let_skipped_omp_hide_envelope_failure() {
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &error()),
            SyncOverallOutcome::Failed
        );
    }

    #[test]
    fn coordinated_outcome_reports_partial_when_one_source_succeeds() {
        assert_eq!(
            coordinated_usage_outcome(&ok("OMP synced"), &error()),
            SyncOverallOutcome::Partial
        );
        assert_eq!(
            coordinated_usage_outcome(&error(), &ok("envelope v1: 1 source accepted")),
            SyncOverallOutcome::Partial
        );
    }

    #[test]
    fn coordinated_outcome_reports_nothing_to_sync_only_without_failures() {
        assert_eq!(
            coordinated_usage_outcome(
                &ok("skipped: OMP not installed"),
                &ok("no new envelope usage data"),
            ),
            SyncOverallOutcome::NothingToSync
        );
    }
}

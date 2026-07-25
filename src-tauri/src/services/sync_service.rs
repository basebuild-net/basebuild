use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::{AUTH_CHANGED, USAGE_SYNC_STATUS};
use crate::models::usage_envelope::{
    assemble_envelope, clamp_window, SourceKind, UsageBatch, ENVELOPE_VERSION,
};
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
/// JSON-RPC error code the server returns for a revoked, expired, or
/// under-scoped bearer. It arrives with HTTP 200, so status alone never
/// reveals an auth failure.
const MCP_UNAUTHORIZED_CODE: i64 = -32001;
/// Minimum gap between sync pushes in seconds, even if a trigger fires.
const MIN_INTER_SYNC_GAP_SECS: i64 = 60;
/// Default interval (minutes) when the setting is missing or zero.
const DEFAULT_INTERVAL_MINUTES: i64 = 60;
/// Maximum backoff in seconds (15 minutes).
const MAX_BACKOFF_SECS: u64 = 900;
/// Initial backoff in seconds.
const INITIAL_BACKOFF_SECS: u64 = 30;
/// Managed-trigger evaluation cadence (seconds). The sync loop wakes on this
/// short cadence between periodic backstop ticks so new usage trickles out
/// promptly (a never-synced device, a provider-set change, or fresh usage).
/// `MIN_INTER_SYNC_GAP_SECS` still debounces the actual pushes.
const MANAGED_TRIGGER_EVAL_SECS: u64 = 60;
/// Request-count delta that fires a trickle sync: >=5 absolute OR >=20%
/// relative vs the last pushed total. Small so active usage flows out quickly.
const MANAGED_TRIGGER_ABS_DELTA: i64 = 5;
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
    last_attempt_at: None,
    retry_after: None,
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
    if !OmpService::is_installed_cached() {
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

    let result = post_mcp(&mode, &rpc_body)?;
    if result.is_error {
        return Err(format!("OMP raw usage was rejected: {}", result.text));
    }
    Ok(result.text)
}

/// Sync per-message usage rows to basebuild.net via the `sync_messages` MCP
/// tool — the RAW half of the data contract. The aggregate envelope answers
/// "how much", these rows preserve the per-request detail the website needs
/// for distribution and percentile analysis, and they land in a different
/// server table (`AppMessageUsage`) than the envelope's rollups.
///
/// Account-only: the server denies `sync_messages` to guest principals, so a
/// private installation skips it rather than burning a request on a refusal.
/// Advances its own cursor — independent of the envelope's — only after the
/// server accepts the batch.
pub fn sync_messages_native() -> Result<String, String> {
    use crate::services::native_chat_service::NativeChatService;

    let mode = resolve_auth_mode()?;
    if matches!(&mode, AuthMode::GuestToken(_)) {
        return Ok("skipped: raw message rows are available to signed-in accounts only".to_string());
    }

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
    if result.is_error {
        return Err(format!("raw message rows were rejected: {}", result.text));
    }
    // Advance the cursor only after the server accepted the batch.
    settings.last_message_sync_at = Some(window_end);
    let _ = SettingsService::set_usage_sync_settings(&settings);
    Ok(format!("{} rows: {}", metrics.len(), result.text))
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
    let since = settings.last_envelope_sync_at.unwrap_or(0);
    let metrics = NativeChatService::metrics_since(since, 5000)?;

    let window_start = metrics.iter().map(|m| m.created_at).min().unwrap_or(since);
    let window_end = metrics.iter().map(|m| m.created_at).max().unwrap_or(since);
    // A device that has been offline (or stuck) for months carries a window
    // wider than the server accepts. Clamp instead of shipping a batch that
    // could only come back as `invalid_window`.
    let (window_start, window_end) =
        clamp_window(window_start, window_end, now_seconds()).unwrap_or((window_end, window_end));

    let rows = aggregate_model_usage_rows(&metrics);

    Ok(UsageBatch {
        source: SourceKind::Native,
        idempotency_key: format!("native:{window_start}:{window_end}:v1"),
        window_start,
        window_end,
        rows,
    })
}

/// Roll per-message native metrics up into aggregated `model_usage` rows,
/// grouped by (provider, model, effort, tier, source, planName). One row per
/// message previously overflowed the envelope's 500-row cap for active users
/// (failing the whole batch); rolling up keeps the batch tiny and sends only
/// aggregate counters. The server sums `requests` and divides
/// durationMs/ttftMs by their counts, so a rolled-up row is equivalent to the
/// messages it summarizes. All counters are clamped to the envelope
/// validator's caps and per-group counts never exceed `requests`.
fn aggregate_model_usage_rows(
    metrics: &[crate::models::native_chat::NativeRequestMetric],
) -> Vec<Value> {
    use std::collections::BTreeMap;
    #[derive(Default)]
    struct Agg {
        requests: i64,
        input: i64,
        output: i64,
        cache_read: i64,
        cache_write: i64,
        cost: f64,
        duration_ms: i64,
        duration_n: i64,
        ttft_ms: i64,
        ttft_n: i64,
        errors: i64,
    }
    // Key components are the already-validated, enum-filtered attribution
    // fields; an empty string is the "absent" sentinel (emitted as null).
    type Key = (String, String, String, String, String, String);
    let mut groups: BTreeMap<Key, Agg> = BTreeMap::new();

    let clamp = |v: i64| v.clamp(0, i32::MAX as i64);
    for m in metrics {
        let effort = match m.effort_level.as_str() {
            "none" | "low" | "medium" | "high" | "xhigh" => m.effort_level.clone(),
            _ => String::new(),
        };
        let tier = m
            .subscription_tier
            .as_deref()
            .filter(|t| matches!(*t, "plus" | "pro" | "max" | "free" | "api" | "team" | "enterprise"))
            .unwrap_or_default()
            .to_string();
        let source = m
            .subscription_source
            .as_deref()
            .filter(|s| matches!(*s, "declared" | "provider-api" | "api-key" | "inferred" | "unknown"))
            .unwrap_or_default()
            .to_string();
        let plan = m
            .plan_name
            .as_deref()
            .filter(|name| name.chars().count() <= 256)
            .unwrap_or_default()
            .to_string();
        let acc = groups
            .entry((m.provider_id.clone(), m.model_id.clone(), effort, tier, source, plan))
            .or_default();
        acc.requests += 1;
        acc.input = clamp(acc.input + clamp(m.input_tokens));
        acc.output = clamp(acc.output + clamp(m.output_tokens));
        acc.cache_read = clamp(acc.cache_read + clamp(m.cache_read_tokens));
        acc.cache_write = clamp(acc.cache_write + clamp(m.cache_write_tokens));
        acc.cost = (acc.cost
            + m.cost_total.filter(|c| c.is_finite() && *c >= 0.0).unwrap_or(0.0))
        .min(1_000_000.0);
        if let Some(d) = m.duration_ms {
            acc.duration_ms = clamp(acc.duration_ms + clamp(d));
            acc.duration_n += 1;
        }
        if let Some(t) = m.ttft_ms {
            acc.ttft_ms = clamp(acc.ttft_ms + clamp(t));
            acc.ttft_n += 1;
        }
        if m.outcome != "success" {
            acc.errors += 1;
        }
    }

    let opt = |s: String| if s.is_empty() { Value::Null } else { Value::String(s) };
    groups
        .into_iter()
        .map(|((provider, model, effort, tier, source, plan), a)| {
            json!({
                "kind": "model_usage",
                "provider": provider,
                "model": model,
                "effort": opt(effort),
                "subscriptionTier": opt(tier),
                "subscriptionSource": opt(source),
                "planName": opt(plan),
                "requests": a.requests,
                "inputTokens": a.input,
                "outputTokens": a.output,
                "cacheReadTokens": a.cache_read,
                "cacheWriteTokens": a.cache_write,
                "costTotal": a.cost,
                "durationMs": a.duration_ms,
                "durationCount": a.duration_n,
                "ttftMs": a.ttft_ms,
                "ttftCount": a.ttft_n,
                "errors": a.errors,
            })
        })
        .collect()
}

/// Outcome of one aggregate-envelope push, split by what the caller must do
/// next. `Err` is reserved for "nothing reached the server at all".
#[derive(Debug, Default, Clone)]
pub struct EnvelopeSyncReport {
    /// Source batches the server durably accepted (or had already accepted).
    pub accepted: usize,
    /// Batches abandoned because no retry could ever succeed. Their cursors
    /// were advanced, so they will not be offered again.
    pub skipped: usize,
    /// Batches that failed for a transient reason and stay queued.
    pub retryable: usize,
    pub message: String,
}

impl EnvelopeSyncReport {
    /// True when the push moved no data and left nothing owed — the caller
    /// reports "already current" rather than success.
    pub fn is_idle(&self) -> bool {
        self.accepted == 0 && self.skipped == 0 && self.retryable == 0
    }
}

/// Server rejection codes that a byte-identical retry can never clear. The
/// batch is abandoned and its cursor advanced; anything else stays queued.
/// Kept deliberately explicit — an unrecognized code is treated as transient
/// so a server-side change never silently discards a user's usage.
fn rejection_is_permanent(code: Option<&str>) -> bool {
    matches!(
        code,
        Some(
            "invalid_window"
                | "invalid_rows"
                | "invalid_row"
                | "invalid_batch"
                | "invalid_idempotency_key"
                | "source_not_allowed"
                | "idempotency_conflict"
        )
    )
}

/// Sync every available closed-envelope source. Private installations include
/// OMP aggregates here; signed-in accounts use the richer raw OMP path and
/// exclude OMP from the envelope to prevent duplicate attribution.
///
/// Every stage is fault-isolated per source: a source that cannot be read, a
/// batch this client cannot represent, and a batch the server refuses each
/// affect only themselves. Before this, any one of them failed the whole
/// envelope and starved every other source indefinitely.
pub fn sync_envelope_native() -> Result<EnvelopeSyncReport, String> {
    let mode = resolve_auth_mode()?;
    let include_omp = matches!(&mode, AuthMode::GuestToken(_));
    let collections = crate::services::usage_source_service::collect_all_sources(include_omp);
    let sources = crate::services::usage_source_service::registered_sources();
    let discard = |batch: &UsageBatch| {
        if let Some(source) = sources.iter().find(|source| source.kind() == batch.source) {
            if let Err(error) = source.discard_batch(batch) {
                eprintln!(
                    "[SYNC] source {}: could not discard batch: {error}",
                    batch.source.as_str()
                );
            }
        }
    };

    let mut report = EnvelopeSyncReport::default();
    let mut batches: Vec<UsageBatch> = Vec::new();
    for collection in collections {
        if let Some(error) = collection.error {
            eprintln!(
                "[SYNC] source {}: collect failed: {error}",
                collection.source.as_str()
            );
            record_source_error(collection.source, "Could not read local aggregate usage");
            report.retryable += 1;
            continue;
        }
        eprintln!(
            "[SYNC] source {}: {}",
            collection.source.as_str(),
            if collection.batch.is_some() {
                "pending batch"
            } else {
                "no batch"
            }
        );
        if let Some(batch) = collection.batch {
            batches.push(batch);
        }
    }
    if batches.is_empty() {
        return Ok(EnvelopeSyncReport {
            message: "no new envelope usage data".to_string(),
            ..report
        });
    }

    let (envelope, rejected) = assemble_envelope(batches, now_seconds());
    for rejection in rejected {
        if rejection.deferred {
            eprintln!(
                "[SYNC] source {}: {} — deferred to the next window",
                rejection.batch.source.as_str(),
                rejection.reason
            );
            record_source_error(rejection.batch.source, "Deferred to the next sync window");
            report.retryable += 1;
        } else {
            // Unrepresentable locally, so it is unrepresentable on the wire.
            // Advance past it or this source never syncs again.
            eprintln!(
                "[SYNC] source {}: skipping unshippable batch — {}",
                rejection.batch.source.as_str(),
                rejection.reason
            );
            discard(&rejection.batch);
            record_source_error(
                rejection.batch.source,
                "Skipped usage this device could not encode",
            );
            report.skipped += 1;
        }
    }
    let Some(envelope) = envelope else {
        report.message = "no shippable envelope batches".to_string();
        return Ok(report);
    };

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

    // The server signals a fully-rejected envelope with `isError`, so the
    // acknowledgment must be read on both paths — the payload is the answer,
    // not the error flag.
    let result = match post_mcp(&mode, &rpc_body) {
        Ok(result) => result,
        Err(error) => {
            for batch in &envelope.batches {
                record_source_error(batch.source, "Upload failed; retry is pending");
            }
            return Err(error);
        }
    };
    let acknowledgment: Value = serde_json::from_str(&result.text)
        .map_err(|error| format!("Invalid usage-envelope acknowledgment: {error}"))?;

    if acknowledgment.get("ok").and_then(Value::as_bool) != Some(true) {
        // Whole-envelope refusal: the server sends `code`/`message` and no
        // receipts. Surface its reason instead of a generic failure.
        let code = acknowledgment
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let message = acknowledgment
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the server did not accept this envelope");
        for batch in &envelope.batches {
            record_source_error(batch.source, "Server rejected this upload; retry is pending");
        }
        return Err(format!("usage envelope rejected ({code}): {message}"));
    }

    let receipts = acknowledgment
        .get("receipts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    for batch in &envelope.batches {
        let receipt = receipts.iter().find(|receipt| {
            receipt.get("source").and_then(Value::as_str) == Some(batch.source.as_str())
                && receipt.get("idempotencyKey").and_then(Value::as_str)
                    == Some(batch.idempotency_key.as_str())
        });
        let status = receipt
            .and_then(|receipt| receipt.get("status"))
            .and_then(Value::as_str);
        if matches!(status, Some("accepted" | "already_accepted")) {
            if let Some(source) = sources.iter().find(|source| source.kind() == batch.source) {
                if let Err(error) = source.advance_checkpoint(batch) {
                    // The server has the data; failing to move our cursor
                    // only means a duplicate next time, which its idempotency
                    // key absorbs. Never turn this into a sync failure.
                    eprintln!(
                        "[SYNC] source {}: accepted but cursor did not advance: {error}",
                        batch.source.as_str()
                    );
                }
            }
            let processed_at = receipt
                .and_then(|receipt| receipt.get("processedAt"))
                .and_then(Value::as_i64);
            record_source_success(batch.source, now_seconds(), processed_at);
            report.accepted += 1;
            continue;
        }

        let code = receipt
            .and_then(|receipt| receipt.get("code"))
            .and_then(Value::as_str);
        if status.is_none() {
            record_source_error(batch.source, "No server receipt; retry is pending");
            report.retryable += 1;
        } else if rejection_is_permanent(code) {
            eprintln!(
                "[SYNC] source {}: permanently rejected ({}) — skipping window",
                batch.source.as_str(),
                code.unwrap_or("unknown")
            );
            discard(batch);
            record_source_error(batch.source, "Server rejected this usage; window skipped");
            report.skipped += 1;
        } else {
            record_source_error(batch.source, "Server deferred this usage; retry is pending");
            report.retryable += 1;
        }
    }

    report.message = format!(
        "envelope v{ENVELOPE_VERSION}: {} accepted, {} skipped, {} pending",
        report.accepted, report.skipped, report.retryable
    );
    Ok(report)
}

fn message_row_json(m: &crate::models::native_chat::NativeRequestMetric) -> Value {
    json!({
        "id": m.id,
        // `AppMessageUsage.ts` is milliseconds server-side; `created_at` is
        // seconds. Sending seconds silently skewed every distribution query
        // by three orders of magnitude.
        "ts": m.created_at.saturating_mul(1000),
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
/// A successful MCP `tools/call` round trip. `is_error` is the tool's own
/// business verdict — the payload still carries the reason, so callers that
/// understand the tool parse `text` either way.
pub struct McpToolResult {
    pub text: String,
    pub is_error: bool,
}

/// Clear whichever credential the request used and describe the loss.
fn invalidate_credential(mode: &AuthMode) -> String {
    match mode {
        AuthMode::AccountToken(_) => {
            let _ = AuthService::clear_auth();
            "Account token expired or was revoked. Please sign in again.".to_string()
        }
        AuthMode::GuestToken(_) => {
            let _ = AuthService::clear_guest_sync_auth();
            "Guest sync credential expired or was revoked; retry to register a new credential."
                .to_string()
        }
    }
}

fn post_mcp(mode: &AuthMode, rpc_body: &Value) -> Result<McpToolResult, String> {
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
        return Err(invalidate_credential(mode));
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
        // The server answers a revoked, expired or under-scoped bearer with
        // HTTP 200 and JSON-RPC -32001, so the HTTP 401 branch above never
        // fires for it. Without this, a dead token retried forever.
        if error.get("code").and_then(Value::as_i64) == Some(MCP_UNAUTHORIZED_CODE) {
            return Err(invalidate_credential(mode));
        }
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
    Ok(McpToolResult {
        text: result_text.to_string(),
        is_error: result.get("isError").and_then(Value::as_bool) == Some(true),
    })
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
        // -32001 arrives with HTTP 200, so the status branch above misses it.
        if error.get("code").and_then(Value::as_i64) == Some(MCP_UNAUTHORIZED_CODE) {
            let _ = AuthService::clear_auth();
            return Err("Token expired or revoked. Please sign in again.".into());
        }
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
    if matches!(&mode, AuthMode::GuestToken(_)) {
        // The server restricts guest tokens to envelope writes; calling this
        // only earns a -32001 that would clear a perfectly good credential.
        return Ok("skipped: environment metadata requires a signed-in account".to_string());
    }
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
    let result = post_mcp(&mode, &rpc_body)?;
    if result.is_error {
        return Err(format!("environment metadata was rejected: {}", result.text));
    }
    Ok(result.text)
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
    // The visible "Share anonymous aggregate usage" toggle IS the consent.
    // Older builds set `upload_enabled` without stamping `consented_at`; do not
    // block those installs. `consented_at` is backfilled by `set_consent` and
    // kept only as an audit timestamp, never as a second gate.
    if !consent.upload_enabled {
        eprintln!("[SYNC] gates: aggregate usage upload is disabled");
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

/// Rebuild the per-source rows, carrying forward whatever history we have.
///
/// History is seeded from disk when the in-memory table is empty, which is
/// every fresh launch. Without that, a device that has synced for weeks
/// reports "no new usage yet" for every source until the next accepted
/// upload — the status was true only of the current process.
fn current_source_statuses(previous: &[SourceSyncStatus]) -> Vec<SourceSyncStatus> {
    let persisted;
    let history = if previous.is_empty() {
        persisted = SettingsService::get_usage_source_status();
        persisted.as_slice()
    } else {
        previous
    };
    crate::services::usage_source_service::registered_sources()
        .into_iter()
        .map(|source| {
            let available = source.available();
            let old = history
                .iter()
                .find(|status| status.source == source.kind().as_str());
            SourceSyncStatus {
                source: source.kind().as_str().to_string(),
                available,
                availability_reason: (!available).then(|| match source.kind() {
                    SourceKind::Omp => "Oh My Pi is not installed".to_string(),
                    SourceKind::Native => "Native usage ledger is unavailable".to_string(),
                    SourceKind::ClaudeCode => "Claude Code is not installed".to_string(),
                    SourceKind::Codex => "Codex CLI is not installed".to_string(),
                    SourceKind::OpenCode => "OpenCode is not installed".to_string(),
                }),
                pending_retry: old.is_some_and(|status| status.pending_retry),
                last_success_at: old.and_then(|status| status.last_success_at),
                last_processed_at: old.and_then(|status| status.last_processed_at),
                last_error: old.and_then(|status| status.last_error.clone()),
                pending_requests: available.then(|| source.pending_requests()).flatten(),
            }
        })
        .collect()
}

/// Apply a mutation to one source's status row under a single lock, then
/// persist. The rows are refreshed first so a source registered since the
/// last read still gets its update.
fn update_source_status(source: SourceKind, apply: impl FnOnce(&mut SourceSyncStatus)) {
    let snapshot = {
        let mut status = AUTOSYNC_STATUS.lock();
        let refreshed = current_source_statuses(&status.sources);
        status.sources = refreshed;
        if let Some(entry) = status
            .sources
            .iter_mut()
            .find(|entry| entry.source == source.as_str())
        {
            apply(entry);
        }
        status.sources.clone()
    };
    // Outside the lock: a slow disk must not stall a concurrent status read.
    let _ = SettingsService::set_usage_source_status(&snapshot);
}

fn record_source_success(source: SourceKind, accepted_at: i64, processed_at: Option<i64>) {
    update_source_status(source, |entry| {
        entry.pending_retry = false;
        entry.last_success_at = Some(accepted_at);
        entry.last_processed_at = processed_at.or(entry.last_processed_at);
        entry.last_error = None;
    });
}

fn record_source_error(source: SourceKind, message: &str) {
    update_source_status(source, |entry| {
        entry.pending_retry = true;
        entry.last_error = Some(message.to_string());
    });
}

/// Pure decision for why usage sync is off, given the resolved gate inputs.
/// Extracted from `autosync_status` so the consent semantics are unit-testable
/// without a database. An enabled upload toggle IS the consent; a missing
/// `consented_at` on an otherwise-disabled install distinguishes "never chose"
/// (prompt) from an explicit opt-out (respect silently).
fn resolve_off_reason(
    upload_enabled: bool,
    has_consent_record: bool,
    auto_sync_usage: bool,
    any_source_available: bool,
) -> Option<SyncOffReason> {
    if !upload_enabled {
        if has_consent_record {
            Some(SyncOffReason::UsageSharingDisabled)
        } else {
            Some(SyncOffReason::ConsentRequired)
        }
    } else if !auto_sync_usage {
        Some(SyncOffReason::AutoSyncDisabled)
    } else if !any_source_available {
        Some(SyncOffReason::NoSourcesAvailable)
    } else {
        None
    }
}

/// Read the current auto-sync status without performing network I/O.
pub fn autosync_status() -> AutoSyncStatus {
    let settings = SettingsService::get_usage_sync_settings().unwrap_or_default();
    let consent = AnalyticsService::get_consent().unwrap_or_default();
    let attribution = if has_account_token() {
        SyncAttribution::Account
    } else {
        SyncAttribution::PrivateInstallation
    };
    // Single locked section: a clone-mutate-store would drop any per-source
    // update the sync thread recorded while this ran.
    let mut status = AUTOSYNC_STATUS.lock();
    status.enabled = settings.auto_sync_usage;
    status.interval_minutes = settings.auto_sync_interval_minutes.max(1);
    status.sync_mode = settings.usage_sync_mode.clone();
    status.attribution = attribution;
    let refreshed = current_source_statuses(&status.sources);
    status.sources = refreshed;
    let any_source_available = status.sources.iter().any(|source| source.available);
    status.retry_after = match (status.last_error.is_some(), status.last_attempt_at) {
        (true, Some(attempt)) => Some(attempt + BACKOFF_SECS.load(Ordering::SeqCst) as i64),
        _ => None,
    };
    status.off_reason = resolve_off_reason(
        consent.upload_enabled,
        consent.consented_at.is_some(),
        settings.auto_sync_usage,
        any_source_available,
    );
    // Gates still pass during a backoff window — the schedule is simply
    // waiting, and "Retry sync" bypasses it. Reporting `retry_backoff` here
    // tells the user why nothing is happening without disabling the controls.
    status.gates_pass = status.off_reason.is_none();
    if status.gates_pass {
        if let Some(retry_after) = status.retry_after {
            if retry_after > now_seconds() {
                status.off_reason = Some(SyncOffReason::RetryBackoff);
            }
        }
    }
    status.clone()
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

/// Releases the single-flight guard on every exit path, including a panic in
/// the sync thread. A leaked flag used to wedge sync until the next restart.
struct SyncInFlightGuard;

impl SyncInFlightGuard {
    /// `None` when a sync is already running — the caller coalesces into it.
    fn acquire() -> Option<Self> {
        (!SYNC_IN_FLIGHT.swap(true, Ordering::SeqCst)).then_some(Self)
    }
}

impl Drop for SyncInFlightGuard {
    fn drop(&mut self) {
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// Decide the coordinated outcome from each path's own verdict.
///
/// The native aggregate envelope is the PRIMARY source. OMP raw usage and the
/// raw per-message rows are enrichment: their failure is recorded per-source
/// but never downgrades the coordinator, so a flaky OMP install or an
/// account-only tool skipped by a guest does not raise a coordinator error
/// when the aggregates went through.
fn coordinated_usage_outcome(
    omp: &Result<String, String>,
    envelope: &Result<EnvelopeSyncReport, String>,
) -> SyncOverallOutcome {
    let omp_work = omp
        .as_ref()
        .is_ok_and(|message| !message.starts_with("skipped:"));
    match envelope {
        // Nothing reached the server at all.
        Err(_) => SyncOverallOutcome::Failed,
        Ok(report) if report.retryable > 0 => {
            if report.accepted > 0 || report.skipped > 0 || omp_work {
                SyncOverallOutcome::Partial
            } else {
                SyncOverallOutcome::Failed
            }
        }
        Ok(report) if report.is_idle() => {
            if omp_work {
                SyncOverallOutcome::Success
            } else {
                SyncOverallOutcome::NothingToSync
            }
        }
        Ok(_) => SyncOverallOutcome::Success,
    }
}

/// Whether the failure backoff window has elapsed. Backoff was previously
/// computed and never consulted, so a permanently failing sync retried at
/// full cadence forever.
fn backoff_elapsed(now: i64) -> bool {
    let status = AUTOSYNC_STATUS.lock();
    let Some(last) = status.last_attempt_at else {
        return true;
    };
    if status.last_error.is_none() {
        return true;
    }
    now - last >= BACKOFF_SECS.load(Ordering::SeqCst) as i64
}

pub fn trigger_sync(app: AppHandle, reason: &str, skip_freshness: bool) {
    eprintln!("[SYNC] trigger_sync reason={reason} skip_freshness={skip_freshness}");
    if !gates_pass() {
        eprintln!("[SYNC] gates_pass=false — aborting (need: signed in + upload permission + auto-sync enabled)");
        return;
    }
    // Single-flight: if a sync is already in flight, coalesce this trigger
    // into the pending one rather than launching a duplicate.
    let Some(guard) = SyncInFlightGuard::acquire() else {
        eprintln!("[SYNC] single-flight: a sync is already in flight — coalescing");
        return;
    };
    eprintln!("[SYNC] gates_pass=true");
    let now = now_seconds();
    // Debounce: enforce a minimum gap between pushes.
    if let Some(last) = AUTOSYNC_STATUS.lock().last_sync_at {
        if now - last < MIN_INTER_SYNC_GAP_SECS {
            eprintln!(
                "[SYNC] debounced — last sync was {}s ago, min gap is {}s",
                now - last,
                MIN_INTER_SYNC_GAP_SECS
            );
            return;
        }
    }
    // Honour the failure backoff unless the user explicitly asked to retry.
    if !skip_freshness && !backoff_elapsed(now) {
        eprintln!(
            "[SYNC] backing off — {}s window has not elapsed",
            BACKOFF_SECS.load(Ordering::SeqCst)
        );
        return;
    }
    AUTOSYNC_STATUS.lock().last_attempt_at = Some(now);

    let app2 = app.clone();
    let reason_owned = reason.to_string();
    thread::spawn(move || {
        // Moved into the thread so the flag clears when this closure ends,
        // however it ends.
        let _guard = guard;
        // The freshness check runs HERE, off the caller thread, so command-path
        // triggers ("Sync now" / retry) never block the UI on a network call.
        // Account principals use the read-side freshness tool; guests push the
        // bounded envelope directly (server receipts dedupe it).
        let should_push = if skip_freshness {
            true
        } else if has_account_token() {
            match AuthService::get_access_token() {
                Ok(Some(token)) => {
                    let usage_is_stale = call_mcp_tool(&token, "get_my_live_usage", json!({}))
                        .ok()
                        .and_then(|v| v.get("shouldSync").and_then(|v| v.as_bool()))
                        .unwrap_or(true);
                    usage_is_stale || advisor_feedback_upload_ready()
                }
                _ => {
                    eprintln!("[SYNC] token disappeared — aborting");
                    false
                }
            }
        } else {
            true
        };
        if !should_push {
            eprintln!("[SYNC] should_push=false — aborting");
            return;
        }
        eprintln!("[SYNC] thread started — calling sync_envelope_native (native first)…");
        let envelope_result = sync_envelope_native();
        eprintln!(
            "[SYNC] sync_envelope_native: {}",
            match &envelope_result {
                Ok(report) => format!("ok: {}", report.message),
                Err(e) => format!("ERR: {e}"),
            }
        );
        // Raw per-message rows travel alongside the aggregates: the envelope
        // gives the website rollups, these give it the underlying detail.
        eprintln!("[SYNC] calling sync_messages_native (raw rows)…");
        let messages_result = sync_messages_native();
        eprintln!(
            "[SYNC] sync_messages_native: {}",
            match &messages_result {
                Ok(m) => format!("ok: {m}"),
                Err(e) => format!("ERR: {e}"),
            }
        );
        eprintln!("[SYNC] calling sync_raw_usage_native…");
        let result = sync_raw_usage_native();
        eprintln!(
            "[SYNC] sync_raw_usage_native: {}",
            match &result {
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

        let outcome = coordinated_usage_outcome(&result, &envelope_result);
        let usage_error = match (&result, &envelope_result) {
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
            if let Ok(mut settings) = SettingsService::get_usage_sync_settings() {
                settings.last_usage_sync_at = Some(now);
                settings.last_provider_fingerprint = current_provider_fingerprint();
                settings.last_known_request_total = current_request_total();
                let _ = SettingsService::set_usage_sync_settings(&settings);
            }
        }

        // One locked read-modify-write. The previous clone-mutate-store lost
        // any per-source update a concurrent path recorded in between.
        {
            let mut status = AUTOSYNC_STATUS.lock();
            status.overall_outcome = Some(outcome);
            if completed_any {
                status.last_sync_at = Some(now);
            }
            match outcome {
                SyncOverallOutcome::Success | SyncOverallOutcome::NothingToSync => {
                    status.last_error = None;
                    BACKOFF_SECS.store(INITIAL_BACKOFF_SECS, Ordering::SeqCst);
                }
                SyncOverallOutcome::Partial => {
                    status.last_error =
                        Some("Some usage sources failed; retry is pending".to_string());
                    let current = BACKOFF_SECS.load(Ordering::SeqCst);
                    BACKOFF_SECS.store((current * 2).min(MAX_BACKOFF_SECS), Ordering::SeqCst);
                }
                SyncOverallOutcome::Failed => {
                    // Carry the real reason, not a generic banner: the server
                    // and transport both name what went wrong.
                    status.last_error = Some(
                        usage_error
                            .clone()
                            .unwrap_or_else(|| "Usage sync failed; retry is pending".to_string()),
                    );
                    let current = BACKOFF_SECS.load(Ordering::SeqCst);
                    BACKOFF_SECS.store((current * 2).min(MAX_BACKOFF_SECS), Ordering::SeqCst);
                }
            }
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
        let raw_note = match &messages_result {
            Ok(message) if message.starts_with("skipped:") => "raw rows not applicable",
            Ok(message) if message.starts_with("no new") => "raw rows already current",
            Ok(_) => "raw rows synced",
            Err(_) => "raw rows not uploaded",
        };
        let message = format!(
            "{reason_owned}: usage {}; {raw_note}; {environment_note}; {feedback_note}",
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
                if first_tick { "startup" } else { "periodic" },
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
        let envelope = sync_envelope_native();
        let rows = sync_messages_native();
        let raw = sync_raw_usage_native();
        let feedback = sync_execution_advisor_feedback_native();
        eprintln!(
            "[SYNC] sync_on_exit: envelope={:?}, rows={:?}, raw={:?}, advisor_feedback={:?}",
            envelope.is_ok(),
            rows.is_ok(),
            raw.is_ok(),
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

    fn envelope_error() -> Result<EnvelopeSyncReport, String> {
        Err("transport failed".to_string())
    }

    fn report(accepted: usize, skipped: usize, retryable: usize) -> Result<EnvelopeSyncReport, String> {
        Ok(EnvelopeSyncReport {
            accepted,
            skipped,
            retryable,
            message: "test".to_string(),
        })
    }

    fn envelope_idle() -> Result<EnvelopeSyncReport, String> {
        Ok(EnvelopeSyncReport {
            message: "no new envelope usage data".to_string(),
            ..Default::default()
        })
    }

    #[test]
    fn upgraded_install_with_toggle_on_but_no_timestamp_passes_gates() {
        // Reproduces the reported bug: an install upgraded from an older build
        // has the "Share anonymous aggregate usage" toggle ON but no
        // `consented_at` stamp. Sync must NOT be blocked as consent-required.
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        let blob = serde_json::json!({
            "collectionEnabled": true,
            "uploadEnabled": true,
            "consentVersion": serde_json::Value::Null,
            "consentedAt": serde_json::Value::Null,
        })
        .to_string();
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('analytics_consent', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![blob],
        )
        .unwrap();
        drop(conn);

        // The blob round-trips with the toggle on and no timestamp.
        let consent = AnalyticsService::get_consent().unwrap();
        assert!(consent.upload_enabled);
        assert!(consent.consented_at.is_none());

        // auto_sync_usage defaults to true, so the enabled toggle is the only
        // remaining gate — sync is unblocked.
        assert!(
            gates_pass(),
            "an enabled upload toggle must pass gates even without a timestamp"
        );
        let reason = autosync_status().off_reason;
        assert_ne!(reason, Some(SyncOffReason::ConsentRequired));
        assert_ne!(reason, Some(SyncOffReason::UsageSharingDisabled));
    }

    #[test]
    fn coordinated_outcome_does_not_let_skipped_omp_hide_envelope_failure() {
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &envelope_error()),
            SyncOverallOutcome::Failed
        );
    }

    #[test]
    fn coordinated_outcome_treats_omp_as_best_effort_native_primary() {
        // Native envelope failed → overall Failed regardless of OMP.
        assert_eq!(
            coordinated_usage_outcome(&ok("OMP synced"), &envelope_error()),
            SyncOverallOutcome::Failed
        );
        // Native envelope accepted, OMP raw failed → still Success (OMP is
        // best-effort enrichment and never downgrades the coordinator).
        assert_eq!(
            coordinated_usage_outcome(&error(), &report(1, 0, 0)),
            SyncOverallOutcome::Success
        );
    }

    #[test]
    fn coordinated_outcome_reports_nothing_to_sync_only_without_failures() {
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &envelope_idle()),
            SyncOverallOutcome::NothingToSync
        );
    }

    #[test]
    fn coordinated_outcome_is_partial_when_one_source_still_owes_data() {
        // The point of fault isolation: a source that failed must not erase
        // the sources that succeeded, and must not be reported as clean.
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &report(1, 0, 1)),
            SyncOverallOutcome::Partial
        );
        // Nothing landed and something is still owed → a real failure.
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &report(0, 0, 1)),
            SyncOverallOutcome::Failed
        );
    }

    #[test]
    fn coordinated_outcome_counts_a_permanently_skipped_batch_as_progress() {
        // A window the server will never accept is abandoned, not retried.
        // Reporting it as failure would keep the device in a loop it cannot
        // exit — the whole bug this replaced.
        assert_eq!(
            coordinated_usage_outcome(&ok("skipped: OMP not installed"), &report(0, 1, 0)),
            SyncOverallOutcome::Success
        );
    }

    #[test]
    fn permanent_rejections_are_abandoned_and_unknown_ones_are_retried() {
        for code in [
            "invalid_window",
            "invalid_rows",
            "invalid_row",
            "invalid_batch",
            "invalid_idempotency_key",
            "source_not_allowed",
            "idempotency_conflict",
        ] {
            assert!(rejection_is_permanent(Some(code)), "{code} must not retry");
        }
        // Transient and unrecognized codes keep the data queued — a server
        // change must never silently discard a user's usage.
        for code in [
            Some("quota_exceeded"),
            Some("processing_failed"),
            Some("token_revoked"),
            Some("something_new"),
            None,
        ] {
            assert!(!rejection_is_permanent(code), "{code:?} must retry");
        }
    }

    /// End-to-end local proof of the outage: a Claude Code history containing
    /// `<synthetic>` used to fail envelope assembly, which took native usage
    /// down with it and left the device unable to sync anything, forever.
    #[test]
    fn a_poisoned_harness_history_no_longer_blocks_native_usage() {
        use crate::models::usage_envelope::{assemble_envelope, validate_envelope};

        let (_dir, _guard) = crate::test_util::test::isolated_home();
        let home = tempfile::TempDir::new().unwrap();
        let projects = home.path().join(".claude").join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        let now = now_seconds();
        let stamp = |offset: i64| {
            // Claude Code writes ISO-8601; keep it inside the retention window.
            let secs = now - offset;
            chrono_like_iso(secs)
        };
        std::fs::write(
            projects.join("session.jsonl"),
            format!(
                "{}\n{}\n",
                json!({
                    "type": "assistant",
                    "message": {"model": "<synthetic>", "usage": {"input_tokens": 3, "output_tokens": 1}},
                    "timestamp": stamp(600)
                }),
                json!({
                    "type": "assistant",
                    "message": {"model": "claude-opus-4-8", "usage": {"input_tokens": 40, "output_tokens": 9}},
                    "timestamp": stamp(300)
                }),
            ),
        )
        .unwrap();
        // Restore on unwind too: a leaked HOME would follow every later test
        // in this process.
        let _home_guard = HomeVarGuard::set(home.path());

        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id,
                 model_id, effort_level, status, run_state, created_at, updated_at)
             VALUES ('s1', '/test', 'Chat', 'basebuild-native', 'openai', 'gpt-5.1', 'medium',
                 'ready', 'idle', ?1, ?1)",
            rusqlite::params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO native_request_metrics (id, session_id, provider_id, model_id,
                 effort_level, started_at, input_tokens, output_tokens, outcome, created_at)
             VALUES ('m1', 's1', 'openai', 'gpt-5.1', 'medium', ?1, 100, 50, 'success', ?2)",
            rusqlite::params![now * 1000, now - 120],
        )
        .unwrap();
        drop(conn);

        let collections =
            crate::services::usage_source_service::collect_all_sources(false);
        let batches: Vec<_> = collections
            .into_iter()
            .filter_map(|collection| collection.batch)
            .collect();
        assert!(
            batches.iter().any(|b| b.source == SourceKind::ClaudeCode),
            "the harness history must still be collected, not skipped wholesale"
        );

        let (envelope, rejected) = assemble_envelope(batches, now);
        let envelope = envelope.expect("an envelope must be shippable");
        validate_envelope(&envelope).expect("assembled envelope must be wire-valid");
        assert!(
            rejected.is_empty(),
            "nothing should be dropped: {:?}",
            rejected.iter().map(|r| &r.reason).collect::<Vec<_>>()
        );
        assert!(
            envelope.batches.iter().any(|b| b.source == SourceKind::Native),
            "native usage must ship alongside the harness batch"
        );
    }

    /// Scoped `HOME` override. The harness readers resolve their data
    /// directories from it, and the variable is process-global, so a test
    /// that leaks it on failure poisons everything that runs after.
    struct HomeVarGuard(Option<std::ffi::OsString>);

    impl HomeVarGuard {
        fn set(path: &std::path::Path) -> Self {
            let previous = std::env::var_os("HOME");
            std::env::set_var("HOME", path);
            Self(previous)
        }
    }

    impl Drop for HomeVarGuard {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    /// Minimal UTC ISO-8601 formatter — the harness reader's parser only
    /// needs `YYYY-MM-DDTHH:MM:SSZ`, and the crate has no chrono dependency.
    fn chrono_like_iso(epoch_secs: i64) -> String {
        let days = epoch_secs.div_euclid(86_400);
        let rem = epoch_secs.rem_euclid(86_400);
        // Civil-from-days (Howard Hinnant), the inverse of the reader's.
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = era * 400 + yoe + i64::from(month <= 2);
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            rem / 3600,
            (rem % 3600) / 60,
            rem % 60
        )
    }

    /// The panel said "no new usage yet" for a device that had been syncing
    /// for weeks, and kept saying it right after the user sent a message.
    /// Two causes: per-source history lived only in this process, and a
    /// caught-up source was indistinguishable from one with a queue.
    #[test]
    fn source_status_survives_restart_and_counts_queued_usage() {
        let (_dir, _guard) = crate::test_util::test::isolated_home();
        let now = now_seconds();

        // A source that synced an hour ago, recorded the way the coordinator
        // records it.
        record_source_success(SourceKind::Native, now - 3600, None);

        // Simulate a relaunch: the in-memory table is empty again.
        AUTOSYNC_STATUS.lock().sources = Vec::new();
        let native = || {
            current_source_statuses(&[])
                .into_iter()
                .find(|entry| entry.source == "native")
                .expect("native source is always registered")
        };
        assert_eq!(
            native().last_success_at,
            Some(now - 3600),
            "last success must be read back from disk, not forgotten on restart"
        );
        assert_eq!(
            native().pending_requests,
            Some(0),
            "a caught-up source reports a measured zero, not 'unknown'"
        );

        // The user sends a message: one metric lands after the cursor.
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id,
                 model_id, effort_level, status, run_state, created_at, updated_at)
             VALUES ('s1', '/test', 'Chat', 'basebuild-native', 'openai', 'gpt-5.1', 'medium',
                 'ready', 'idle', ?1, ?1)",
            rusqlite::params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO native_request_metrics (id, session_id, provider_id, model_id,
                 effort_level, started_at, input_tokens, output_tokens, outcome, created_at)
             VALUES ('m1', 's1', 'openai', 'gpt-5.1', 'medium', ?1, 10, 5, 'success', ?2)",
            rusqlite::params![now * 1000, now],
        )
        .unwrap();
        drop(conn);

        assert_eq!(
            native().pending_requests,
            Some(1),
            "a message just sent must show as queued, not as 'no new usage'"
        );
    }

    /// Live contract check against basebuild.net. Not part of the default
    /// suite (it needs network and registers a guest installation); run it
    /// deliberately after touching the envelope wire format:
    ///
    /// ```text
    /// cargo test --lib live_envelope_round_trip -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "network: talks to basebuild.net and registers a guest installation"]
    fn live_envelope_round_trip_is_accepted_by_the_server() {
        let (_dir, _guard) = crate::test_util::test::isolated_home();
        let now = now_seconds();

        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id,
                 model_id, effort_level, status, run_state, created_at, updated_at)
             VALUES ('s1', '/test', 'Chat', 'basebuild-native', 'local-models',
                 'lmstudio:google/gemma-4-e4b', 'high', 'ready', 'idle', ?1, ?1)",
            rusqlite::params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO native_request_metrics (id, session_id, provider_id, model_id,
                 effort_level, started_at, duration_ms, input_tokens, output_tokens,
                 cost_total, outcome, subscription_source, created_at)
             VALUES ('m1', 's1', 'local-models', 'lmstudio:google/gemma-4-e4b', 'high',
                 ?1, 1200, 100, 50, 0.0, 'success', 'unknown', ?2)",
            rusqlite::params![now * 1000, now - 120],
        )
        .unwrap();
        drop(conn);

        let report = sync_envelope_native().expect("envelope push must reach the server");
        eprintln!("[live] {}", report.message);
        // The harness sources read the developer's real history, so the batch
        // count varies by machine; what must hold is that everything offered
        // was accepted and nothing was dropped or left owing.
        assert!(report.accepted >= 1, "server must accept the native batch");
        assert_eq!(report.retryable, 0, "nothing may be left pending");
        assert_eq!(report.skipped, 0, "nothing may be dropped as unshippable");

        // The cursors advanced, so an immediate second pass has nothing owed —
        // proof the accept path is wired, not just the transport.
        let again = sync_envelope_native().expect("second pass must succeed");
        assert!(again.is_idle(), "expected nothing to sync, got {again:?}");
    }

    #[test]
    fn off_reason_enabled_upload_passes_without_consent_timestamp() {
        // An older install with the toggle on but no `consented_at` must sync.
        assert_eq!(resolve_off_reason(true, false, true, true), None);
    }

    #[test]
    fn off_reason_never_chose_requires_consent() {
        assert_eq!(
            resolve_off_reason(false, false, true, true),
            Some(SyncOffReason::ConsentRequired)
        );
    }

    #[test]
    fn off_reason_explicit_optout_is_respected_not_reprompted() {
        assert_eq!(
            resolve_off_reason(false, true, true, true),
            Some(SyncOffReason::UsageSharingDisabled)
        );
    }

    #[test]
    fn off_reason_reports_autosync_and_sources_only_when_shared() {
        assert_eq!(
            resolve_off_reason(true, true, false, true),
            Some(SyncOffReason::AutoSyncDisabled)
        );
        assert_eq!(
            resolve_off_reason(true, true, true, false),
            Some(SyncOffReason::NoSourcesAvailable)
        );
    }

    fn metric(
        provider: &str,
        model: &str,
        tier: Option<&str>,
        outcome: &str,
        input: i64,
        dur: Option<i64>,
    ) -> crate::models::native_chat::NativeRequestMetric {
        crate::models::native_chat::NativeRequestMetric {
            id: "m".into(),
            session_id: "s".into(),
            provider_id: provider.into(),
            model_id: model.into(),
            effort_level: "high".into(),
            started_at: 0,
            completed_at: Some(0),
            duration_ms: dur,
            ttft_ms: dur.map(|_| 100),
            ttlt_ms: None,
            input_tokens: input,
            output_tokens: input * 2,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            tokens_per_second: None,
            cost_total: Some(0.5),
            outcome: outcome.into(),
            error_class: None,
            created_at: 0,
            subscription_tier: tier.map(Into::into),
            subscription_source: Some("declared".into()),
            plan_name: None,
            account_id: None,
        }
    }

    #[test]
    fn aggregate_rolls_up_by_group_and_stays_envelope_valid() {
        use crate::models::usage_envelope::validate_row;
        let metrics = vec![
            metric("anthropic", "claude", Some("max"), "success", 100, Some(1000)),
            metric("anthropic", "claude", Some("max"), "error", 200, Some(3000)),
            metric("anthropic", "claude", Some("pro"), "success", 50, None),
        ];
        let rows = aggregate_model_usage_rows(&metrics);
        // Two tiers → two rows; each must pass the transport validator.
        assert_eq!(rows.len(), 2);
        for row in &rows {
            validate_row(row).expect("aggregated row must be envelope-valid");
        }
        let max_row = rows.iter().find(|r| r["subscriptionTier"] == "max").unwrap();
        assert_eq!(max_row["requests"], 2);
        assert_eq!(max_row["inputTokens"], 300);
        assert_eq!(max_row["errors"], 1);
        assert_eq!(max_row["durationMs"], 4000);
        assert_eq!(max_row["durationCount"], 2);
        let pro_row = rows.iter().find(|r| r["subscriptionTier"] == "pro").unwrap();
        assert_eq!(pro_row["requests"], 1);
        assert_eq!(pro_row["durationCount"], 0);
    }
}

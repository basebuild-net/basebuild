use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::usage_envelope::{
    clamp_v2_rows, normalize_identifier, CollectorCoverageRow, QuotaSnapshotRow, SourceKind, V2Row,
    V2UsageBatch, MAX_BATCHES_PER_ENVELOPE, MAX_ROWS_PER_BATCH, MAX_ROWS_PER_ENVELOPE,
};
use crate::services::analytics_service::AnalyticsService;
use crate::services::storage_service::StorageService;

/// Collect cadence while the machine is idle.
const COLLECT_INTERVAL_SECS: u64 = 300;
/// Collect cadence while spans are still arriving. Matches the quota debounce
/// so an active window is re-read every pass: two readings that bracket a burst
/// are what turn a quota bar into a drain rate.
const ACTIVE_COLLECT_INTERVAL_SECS: u64 = 60;
const QUOTA_DEBOUNCE_MS: i64 = 60_000;
const MAX_PENDING_BATCHES: i64 = 1_000;
/// How long retained quota readings stay useful for solving a drain rate.
/// Long enough to span many reset windows, short enough to stay small.
const QUOTA_SAMPLE_RETENTION_MS: i64 = 30 * 86_400_000;
const STATE_HEARTBEAT_MS: &str = "coverage_heartbeat_ms";
const STATE_RUNNING: &str = "coverage_running";
const STATE_SPOOL_GAP: &str = "spool_gap";
const STATE_LAST_SPANS: &str = "last_span_count";
const STATE_HISTORY_BACKFILL: &str = "quota_history_backfilled_through";
/// How far back to pull OMP's recorded quota history on first run.
const HISTORY_BACKFILL_DAYS: i64 = 30;
const HISTORY_REFRESH_MIN_MS: i64 = 2 * 3_600_000;
const DAY_MS: i64 = 86_400_000;

static COLLECTOR_RUNNING: AtomicBool = AtomicBool::new(false);

pub struct UsageV2CollectorService;

impl UsageV2CollectorService {
    /// Persist every collected batch before any transport attempt.
    pub fn collect_and_spool() -> Result<usize, String> {
        // Startup, focus-loss sync, and the background loop can arrive
        // together. OMP history collection is expensive and cursor-based;
        // concurrent passes duplicate minutes of work and race the same
        // checkpoints. One pass owns collection, later callers replay whatever
        // is already durable in the spool.
        static COLLECTING: std::sync::LazyLock<parking_lot::Mutex<()>> =
            std::sync::LazyLock::new(|| parking_lot::Mutex::new(()));
        let Some(_collecting) = COLLECTING.try_lock() else {
            eprintln!("[SYNC V2] collector: collection already running — coalesced");
            return Ok(0);
        };
        eprintln!("[SYNC V2] collector: collecting local sources");
        if !AnalyticsService::get_consent()?.collection_enabled {
            eprintln!("[SYNC V2] collector: collection consent disabled");
            return Ok(0);
        }
        let now_ms = now_millis();
        // Seed from OMP's own recorded quota history before collecting. Cheap
        // after the first pass (it only reads forward of what it already has)
        // and it is what stops a fresh install from being unable to report a
        // drain rate until it has watched two windows go by.
        if let Err(error) = backfill_quota_history(now_ms) {
            eprintln!("[SYNC V2] quota history: backfill failed: {error}");
        }
        let mut batches = crate::services::usage_source_service::collect_all_sources_v2()
            .into_iter()
            .filter_map(|collection| {
                if let Some(error) = collection.error {
                    eprintln!(
                        "[SYNC V2] collector: source {} failed: {error}",
                        collection.source.as_str()
                    );
                    return None;
                }
                eprintln!(
                    "[SYNC V2] collector: source {} {}",
                    collection.source.as_str(),
                    if collection.batch.is_some() {
                        "produced a batch"
                    } else {
                        "had no rows"
                    }
                );
                collection.batch
            })
            .collect::<Vec<_>>();

        let coverage_rows = Self::heartbeat(now_ms)?;
        append_native_rows(&mut batches, coverage_rows, now_ms)?;
        if let Some(quota_batch) = Self::collect_omp_quota_batch(now_ms)? {
            batches.push(quota_batch);
        }

        let mut persisted = 0usize;
        for batch in &batches {
            Self::persist_batch(batch)?;
            persisted += 1;
        }
        let dropped = Self::trim_spool()?;
        let pruned = prune_quota_samples(now_ms)?;
        // Retained traffic ages out on the same horizon: with no reading left to
        // pair against, it can no longer contribute to a rate.
        let pruned_traffic = crate::services::usage_source_service::prune_span_traffic(
            now_ms.saturating_sub(QUOTA_SAMPLE_RETENTION_MS),
        )?;
        if pruned > 0 || pruned_traffic > 0 {
            eprintln!(
                "[SYNC V2] collector: pruned {pruned} quota samples, {pruned_traffic} retained spans"
            );
        }
        if let Some((started_at, ended_at)) = dropped {
            set_state(STATE_SPOOL_GAP, &format!("{started_at}:{ended_at}"), now_ms)?;
            eprintln!("[SYNC V2] collector: spool cap dropped oldest batches");
        }
        // Remember whether this pass saw traffic. A quota window only yields a
        // drain rate when two readings bracket real requests, so the loop
        // samples fast while spans are arriving and backs off when idle.
        let spans = batches
            .iter()
            .flat_map(|batch| batch.rows.iter())
            .filter(|row| matches!(row, V2Row::RequestSpan(_)))
            .count();
        set_state(STATE_LAST_SPANS, &spans.to_string(), now_ms)?;
        eprintln!("[SYNC V2] collector: persisted {persisted} batches, {spans} spans");
        Ok(persisted)
    }

    pub fn persist_batch(batch: &V2UsageBatch) -> Result<(), String> {
        let rows_json = serde_json::to_string(&batch.rows).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT OR IGNORE INTO usage_v2_pending_batches
                (idempotency_key, source, window_start, window_end, rows_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                batch.idempotency_key,
                batch.source.as_str(),
                batch.window_start,
                batch.window_end,
                rows_json,
                now_millis()
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Oldest pending batch per source, bounded to one valid envelope.
    pub fn pending_batches() -> Result<Vec<V2UsageBatch>, String> {
        let conn = StorageService::connect()?;
        let mut statement = conn
            .prepare(
                "SELECT source, idempotency_key, window_start, window_end, rows_json
                 FROM usage_v2_pending_batches
                 ORDER BY created_at ASC, idempotency_key ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut sources = HashSet::new();
        let mut result = Vec::new();
        let mut row_count = 0usize;
        for row in rows {
            let (source, idempotency_key, window_start, window_end, rows_json) =
                row.map_err(|error| error.to_string())?;
            let Some(source) = parse_source(&source) else {
                continue;
            };
            if sources.contains(&source) {
                continue;
            }
            let batch_rows: Vec<V2Row> =
                serde_json::from_str(&rows_json).map_err(|error| error.to_string())?;
            if result.len() >= MAX_BATCHES_PER_ENVELOPE
                || row_count + batch_rows.len() > MAX_ROWS_PER_ENVELOPE
            {
                continue;
            }
            row_count += batch_rows.len();
            sources.insert(source);
            result.push(V2UsageBatch {
                source,
                idempotency_key,
                window_start,
                window_end,
                rows: batch_rows,
            });
        }
        Ok(result)
    }

    pub fn delete_batch(idempotency_key: &str) -> Result<(), String> {
        StorageService::connect()?
            .execute(
                "DELETE FROM usage_v2_pending_batches WHERE idempotency_key = ?1",
                params![idempotency_key],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Move a batch out of the retry loop without destroying it.
    ///
    /// Used when the server says it stored nothing and never will for this
    /// payload. Deleting would be data loss — these rows exist nowhere else —
    /// and leaving it pending would wedge the source, re-offering the same
    /// refused bytes forever.
    pub fn quarantine_batch(
        batch: &V2UsageBatch,
        code: Option<&str>,
        message: &str,
    ) -> Result<(), String> {
        let rows_json = serde_json::to_string(&batch.rows).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT OR REPLACE INTO usage_v2_quarantined_batches
                (idempotency_key, source, window_start, window_end, rows_json, code, message,
                 quarantined_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                batch.idempotency_key,
                batch.source.as_str(),
                batch.window_start,
                batch.window_end,
                rows_json,
                code,
                message,
                now_millis()
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "DELETE FROM usage_v2_pending_batches WHERE idempotency_key = ?1",
            params![batch.idempotency_key],
        )
        .map_err(|error| error.to_string())?;
        eprintln!(
            "[SYNC V2] source {}: quarantined batch ({}) — rows retained locally, not retried",
            batch.source.as_str(),
            code.unwrap_or("unknown")
        );
        Ok(())
    }

    /// How many batches are held in quarantine, for status reporting.
    pub fn quarantined_count() -> Result<i64, String> {
        StorageService::connect()?
            .query_row(
                "SELECT COUNT(*) FROM usage_v2_quarantined_batches",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    pub fn start(now_ms: i64) -> Result<Vec<V2Row>, String> {
        eprintln!("[SYNC V2] collector: start at {now_ms}");
        let heartbeat = get_state(STATE_HEARTBEAT_MS)?.and_then(|value| value.parse().ok());
        let mut rows = Vec::new();
        if let Some(previous) = heartbeat.filter(|previous| *previous < now_ms) {
            let reason = "collector_stopped";
            rows.push(V2Row::CollectorCoverage(coverage_row(
                previous,
                now_ms,
                "gap",
                Some(reason),
            )));
        }
        set_state(STATE_RUNNING, "1", now_ms)?;
        set_state(STATE_HEARTBEAT_MS, &now_ms.to_string(), now_ms)?;
        Ok(rows)
    }

    pub fn heartbeat(now_ms: i64) -> Result<Vec<V2Row>, String> {
        let running = get_state(STATE_RUNNING)?.as_deref() == Some("1");
        if !running {
            return Self::start(now_ms);
        }
        let previous = get_state(STATE_HEARTBEAT_MS)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(now_ms);
        let mut rows = Vec::new();
        if previous < now_ms {
            rows.push(V2Row::CollectorCoverage(coverage_row(
                previous, now_ms, "complete", None,
            )));
        }
        if let Some(gap) = get_state(STATE_SPOOL_GAP)? {
            if let Some((start, end)) = parse_gap(&gap) {
                rows.push(V2Row::CollectorCoverage(coverage_row(
                    start,
                    end,
                    "gap",
                    Some("exporter_error"),
                )));
            }
            delete_state(STATE_SPOOL_GAP)?;
        }
        set_state(STATE_HEARTBEAT_MS, &now_ms.to_string(), now_ms)?;
        Ok(rows)
    }

    pub fn stop(now_ms: i64) -> Result<Vec<V2Row>, String> {
        eprintln!("[SYNC V2] collector: stop at {now_ms}");
        let previous = get_state(STATE_HEARTBEAT_MS)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(now_ms);
        let rows = if previous < now_ms {
            vec![V2Row::CollectorCoverage(coverage_row(
                previous, now_ms, "complete", None,
            ))]
        } else {
            Vec::new()
        };
        set_state(STATE_RUNNING, "0", now_ms)?;
        set_state(STATE_HEARTBEAT_MS, &now_ms.to_string(), now_ms)?;
        Ok(rows)
    }

    /// How long to wait before the next collect pass.
    ///
    /// Idle machines do not need a tight loop, but an active one does: a quota
    /// reading is only useful next to another reading of the same window with
    /// known traffic between them. Sampling every five minutes through a burst
    /// yields one coarse interval; sampling every minute yields several, and
    /// the drain rate is solved from their spread.
    fn next_interval_secs() -> u64 {
        let active = get_state(STATE_LAST_SPANS)
            .ok()
            .flatten()
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|spans| spans > 0);
        if active {
            ACTIVE_COLLECT_INTERVAL_SECS
        } else {
            COLLECT_INTERVAL_SECS
        }
    }

    pub fn start_background_loop() {
        if COLLECTOR_RUNNING.swap(true, Ordering::SeqCst) {
            eprintln!("[SYNC V2] collector: start skipped, already running");
            return;
        }
        eprintln!("[SYNC V2] collector: background loop started");
        tauri::async_runtime::spawn(async {
            if AnalyticsService::get_consent()
                .map(|consent| consent.collection_enabled)
                .unwrap_or(false)
            {
                let _ = tauri::async_runtime::spawn_blocking(Self::collect_and_spool).await;
            }
            while COLLECTOR_RUNNING.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_secs(Self::next_interval_secs())).await;
                if !COLLECTOR_RUNNING.load(Ordering::SeqCst) {
                    break;
                }
                let collection_enabled = AnalyticsService::get_consent()
                    .map(|consent| consent.collection_enabled)
                    .unwrap_or(false);
                if !collection_enabled {
                    eprintln!("[SYNC V2] collector: collection consent disabled");
                    continue;
                }
                let _ = tauri::async_runtime::spawn_blocking(Self::collect_and_spool).await;
            }
            eprintln!("[SYNC V2] collector: background loop stopped");
        });
    }

    pub fn stop_background_loop() {
        COLLECTOR_RUNNING.store(false, Ordering::SeqCst);
    }

    pub fn stop_and_spool() -> Result<(), String> {
        Self::stop_background_loop();
        if !AnalyticsService::get_consent()?.collection_enabled {
            eprintln!("[SYNC V2] collector: stop event skipped, collection consent disabled");
            return Ok(());
        }
        let now_ms = now_millis();
        let rows = Self::stop(now_ms)?;
        let mut batches = Vec::new();
        append_native_rows(&mut batches, rows, now_ms)?;
        for batch in &batches {
            Self::persist_batch(batch)?;
        }
        Ok(())
    }

    pub fn record_native_quota_windows(
        provider: &str,
        account_id: Option<&str>,
        windows: &[crate::services::provider_client::ProviderQuotaWindow],
    ) -> Result<(), String> {
        if windows.is_empty() || !AnalyticsService::get_consent()?.collection_enabled {
            return Ok(());
        }
        let Some(provider) = normalize_identifier(provider) else {
            return Ok(());
        };
        let now_ms = now_millis();
        let debounce_key = format!("native_quota_last_ms:{provider}");
        let last_sample = get_state(&debounce_key)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if now_ms.saturating_sub(last_sample) < QUOTA_DEBOUNCE_MS {
            eprintln!("[SYNC V2] quota: native provider {provider} debounced");
            return Ok(());
        }
        let account_hash = account_id.map(|account_id| {
            let digest = Sha256::digest(format!("{provider}:{account_id}").as_bytes());
            format!("{digest:x}")[..32].to_string()
        });
        let mut rows = windows
            .iter()
            .filter_map(|window| {
                let limit_id = normalize_identifier(&window.limit_id)?;
                let identity = format!("{provider}:{limit_id}:{now_ms}");
                let digest = Sha256::digest(identity.as_bytes());
                Some(V2Row::QuotaSnapshot(QuotaSnapshotRow {
                    snapshot_id: format!("quota:{digest:x}"),
                    provider: provider.clone(),
                    account_hash: account_hash.clone(),
                    limit_id,
                    window_label: window.window_label.as_deref().and_then(safe_label),
                    observed_at: now_ms,
                    used_fraction: window.used_fraction.clamp(0.0, 1.0),
                    remaining_fraction: window.remaining_fraction.clamp(0.0, 1.0),
                    resets_at: window.resets_at,
                    window_duration_ms: window.window_duration_ms,
                    plan_type: None,
                }))
            })
            .take(MAX_ROWS_PER_BATCH)
            .collect::<Vec<_>>();
        if rows.is_empty() {
            return Ok(());
        }
        rows.sort_by(|left, right| {
            let left_id = match left {
                V2Row::QuotaSnapshot(row) => row.snapshot_id.as_str(),
                _ => "",
            };
            let right_id = match right {
                V2Row::QuotaSnapshot(row) => row.snapshot_id.as_str(),
                _ => "",
            };
            left_id.cmp(right_id)
        });
        let digest = Sha256::digest(serde_json::to_vec(&rows).map_err(|error| error.to_string())?);
        let Some((rows, window_start, window_end)) = clamp_v2_rows(rows, now_ms / 1000) else {
            return Ok(());
        };
        Self::persist_batch(&V2UsageBatch {
            source: SourceKind::Native,
            idempotency_key: format!("native:quota:v2:{digest:x}"),
            window_start,
            window_end,
            rows,
        })?;
        set_state(&debounce_key, &now_ms.to_string(), now_ms)?;
        eprintln!("[SYNC V2] quota: captured native provider {provider} headers");
        Ok(())
    }

    fn collect_omp_quota_batch(now_ms: i64) -> Result<Option<V2UsageBatch>, String> {
        if !crate::services::omp_service::OmpService::is_installed_cached() {
            return Ok(None);
        }
        let output = match crate::services::omp_service::OmpService::run_json(&["usage", "--json"])
        {
            Ok(output) if output.success => output,
            Ok(_) => return Ok(None),
            Err(error) => {
                eprintln!("[SYNC V2] quota: OMP usage sampling failed: {error}");
                return Ok(None);
            }
        };
        let Some(payload) = output.json else {
            return Ok(None);
        };
        let rows = quota_rows_from_payload(&payload, now_ms)?;
        if rows.is_empty() {
            return Ok(None);
        }
        let digest = Sha256::digest(serde_json::to_vec(&rows).map_err(|error| error.to_string())?);
        let Some((rows, window_start, window_end)) = clamp_v2_rows(rows, now_ms / 1000) else {
            return Ok(None);
        };
        Ok(Some(V2UsageBatch {
            source: SourceKind::Omp,
            idempotency_key: format!("omp:quota:v2:{digest:x}"),
            window_start,
            window_end,
            rows,
        }))
    }

    fn trim_spool() -> Result<Option<(i64, i64)>, String> {
        let mut conn = StorageService::connect()?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_v2_pending_batches", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        // An under-cap spool must be left alone. `saturating_sub` bottoms out
        // at `i64::MIN`, not at zero, and SQLite reads a negative LIMIT as "no
        // limit" — so testing for `== 0` here once deleted the whole spool on
        // every collect.
        if count <= MAX_PENDING_BATCHES {
            return Ok(None);
        }
        let excess = count - MAX_PENDING_BATCHES;
        let transaction = conn.transaction().map_err(|error| error.to_string())?;
        let bounds = transaction
            .query_row(
                "SELECT MIN(window_start), MAX(window_end)
                 FROM (
                    SELECT window_start, window_end FROM usage_v2_pending_batches
                    ORDER BY created_at ASC, idempotency_key ASC LIMIT ?1
                 )",
                params![excess],
                |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM usage_v2_pending_batches WHERE idempotency_key IN (
                    SELECT idempotency_key FROM usage_v2_pending_batches
                    ORDER BY created_at ASC, idempotency_key ASC LIMIT ?1
                 )",
                params![excess],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(match bounds {
            (Some(start), Some(end)) => {
                Some((start.saturating_mul(1000), end.saturating_mul(1000)))
            }
            _ => None,
        })
    }
}

/// One quota reading, flattened out of whatever shape the sampler emitted.
///
/// `model_id` never reaches the wire — `QuotaSnapshotRow` is a closed schema —
/// but it is what makes local correlation possible: a per-model quota window
/// attributes its own drain, while an account-wide window has to be solved
/// against whatever mix of models was running.
struct QuotaObservation {
    provider: String,
    limit_id: String,
    model_id: Option<String>,
    window_label: Option<String>,
    plan_type: Option<String>,
    used_fraction: f64,
    remaining_fraction: f64,
    resets_at: Option<i64>,
    window_duration_ms: Option<i64>,
    /// Hashed provider account, never the raw id.
    account_hash: Option<String>,
}

/// Flatten `omp usage --json` into quota observations.
///
/// The real payload nests `reports[] -> limits[]`, where each limit carries
/// `scope` (provider/model/tier), `window` (id/label/resetsAt), and `amount`
/// (used/remaining fractions). An earlier version of this parser read a flat
/// top-level `windows`/`usage` array, which the sampler has never emitted — so
/// every reading was silently discarded. Both shapes are accepted now: the
/// nested one because it is what actually arrives, the flat one because it is
/// the shape provider response headers are normalized into.
fn quota_observations_from_payload(payload: &Value) -> Vec<QuotaObservation> {
    let mut observations = Vec::new();
    for report in payload
        .get("reports")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let report_provider = report.get("provider").and_then(Value::as_str);
        // `metadata` carries the account identity and, on some providers, the
        // only statement of plan type. It also carries the account email, which
        // is deliberately never read: it is not usage and must not be persisted.
        let metadata = report.get("metadata");
        let raw_account = metadata
            .and_then(|metadata| metadata.get("accountId"))
            .and_then(Value::as_str);
        let metadata_plan = metadata
            .and_then(|metadata| metadata.get("planType"))
            .and_then(Value::as_str)
            .and_then(safe_label);
        for limit in report
            .get("limits")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let scope = limit.get("scope");
            let amount = limit.get("amount");
            let window = limit.get("window");
            let provider = scope
                .and_then(|scope| scope.get("provider"))
                .and_then(Value::as_str)
                .or(report_provider);
            let Some(provider) = provider.and_then(normalize_identifier) else {
                continue;
            };
            let raw_limit = limit
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    format!(
                        "{provider}:{}",
                        window
                            .and_then(|window| window.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("window")
                    )
                });
            let Some(limit_id) = normalize_identifier(&raw_limit) else {
                continue;
            };
            let used_fraction = fraction(amount.and_then(|amount| amount.get("usedFraction")));
            let remaining_fraction =
                fraction(amount.and_then(|amount| amount.get("remainingFraction")))
                    .or_else(|| used_fraction.map(|used| 1.0 - used));
            // A limit with neither fraction carries no drain signal at all.
            let Some(used_fraction) = used_fraction.or_else(|| {
                remaining_fraction.map(|remaining| (1.0 - remaining).clamp(0.0, 1.0))
            }) else {
                continue;
            };
            let window_label = window
                .and_then(|window| window.get("label"))
                .or_else(|| limit.get("label"))
                .and_then(Value::as_str)
                .and_then(safe_label);
            let hashed_account = raw_account.and_then(|account| account_hash(&provider, account));
            observations.push(QuotaObservation {
                model_id: scope
                    .and_then(|scope| scope.get("modelId"))
                    .and_then(Value::as_str)
                    .and_then(normalize_identifier),
                // `scope.tier` is the per-window label; `metadata.planType` is
                // the account's plan. Prefer the narrower one when present.
                plan_type: scope
                    .and_then(|scope| scope.get("tier"))
                    .and_then(Value::as_str)
                    .and_then(safe_label)
                    .or_else(|| metadata_plan.clone()),
                used_fraction,
                remaining_fraction: remaining_fraction
                    .unwrap_or(1.0 - used_fraction)
                    .clamp(0.0, 1.0),
                resets_at: timestamp_millis(window.and_then(|window| window.get("resetsAt"))),
                window_duration_ms: window
                    .and_then(|window| window.get("windowDurationMs"))
                    .and_then(Value::as_i64)
                    .or_else(|| window_label.as_deref().and_then(duration_from_label)),
                window_label,
                account_hash: hashed_account,
                provider,
                limit_id,
            });
        }
    }
    for window in payload
        .get("windows")
        .or_else(|| payload.get("usage"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let Some(provider) = window
            .get("provider")
            .and_then(Value::as_str)
            .and_then(normalize_identifier)
        else {
            continue;
        };
        let used_fraction = fraction(window.get("usedFraction")).unwrap_or(0.0);
        let window_label = window
            .get("windowLabel")
            .or_else(|| window.get("label"))
            .and_then(Value::as_str)
            .and_then(safe_label);
        let plan_type = window
            .get("planType")
            .and_then(Value::as_str)
            .and_then(safe_label);
        let raw_limit = window
            .get("limitId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "{}:{}:{}",
                    provider,
                    plan_type.as_deref().unwrap_or("unknown"),
                    window_label.as_deref().unwrap_or("window")
                )
            });
        let Some(limit_id) = normalize_identifier(&raw_limit) else {
            continue;
        };
        observations.push(QuotaObservation {
            provider,
            limit_id,
            model_id: window
                .get("modelId")
                .and_then(Value::as_str)
                .and_then(normalize_identifier),
            plan_type,
            used_fraction,
            remaining_fraction: fraction(window.get("remainingFraction"))
                .unwrap_or(1.0 - used_fraction)
                .clamp(0.0, 1.0),
            resets_at: timestamp_millis(window.get("resetsAt")),
            window_duration_ms: window
                .get("windowDurationMs")
                .and_then(Value::as_i64)
                .or_else(|| window_label.as_deref().and_then(duration_from_label)),
            window_label,
            // The normalized header shape carries no account identity.
            account_hash: None,
        });
    }
    observations
}

fn fraction(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, 1.0))
}

/// Persist one quota reading for local drain-rate solving.
///
/// Readings are immutable and keyed by their observation instant, so a repeated
/// sample of an unchanged window is a no-op rather than an update.
///
/// `ingested_through` is captured with the reading, not inferred later: it is
/// the only way to tell a genuinely idle stretch from traffic the collector had
/// not yet read off disk, and that distinction decides whether the newest
/// interval is usable or garbage.
fn record_quota_sample(
    observation: &QuotaObservation,
    observed_at: i64,
    ingested_through: Option<i64>,
) -> Result<(), String> {
    StorageService::connect()?
        .execute(
            "INSERT OR IGNORE INTO usage_quota_samples
                (provider, limit_id, observed_at, model_id, window_label, plan_type,
                 used_fraction, remaining_fraction, resets_at, window_duration_ms,
                 ingested_through, account_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                observation.provider,
                observation.limit_id,
                observed_at,
                observation.model_id,
                observation.window_label,
                observation.plan_type,
                observation.used_fraction,
                observation.remaining_fraction,
                observation.resets_at,
                observation.window_duration_ms,
                ingested_through,
                observation.account_hash,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Hash a provider account id the way the wire schema requires.
///
/// 32 hex chars of SHA-256 over `provider:account`. The raw id and the email
/// that sits beside it in OMP's history are never persisted: which account owns
/// a quota window is not usage data.
fn account_hash(provider: &str, account_id: &str) -> Option<String> {
    if account_id.is_empty() {
        return None;
    }
    let digest = Sha256::digest(format!("{provider}:{account_id}").as_bytes());
    Some(format!("{digest:x}")[..32].to_string())
}

/// Test hook: seed from OMP's recorded history and report how many readings
/// were offered. Exposed so the correlation service can exercise the real
/// cold-start path end to end.
#[cfg(test)]
impl UsageV2CollectorService {
    pub fn backfill_history_for_test() -> Result<usize, String> {
        backfill_quota_history(now_millis())
    }
}

/// Seed retained readings from OMP's own recorded quota history.
///
/// OMP already keeps hourly quota snapshots (`omp usage --history`), which is
/// weeks of the exact signal the solver needs. Without this a fresh install
/// starts blind and cannot report a rate until it has watched two windows go by;
/// with it, a first run has hundreds of intervals immediately.
///
/// Idempotent: readings are keyed by observation instant. A recent checkpoint
/// skips the CLI entirely; older checkpoints request only the missing boundary
/// days instead of re-emitting 30 days on every collection pass.
fn history_backfill_days(now_ms: i64, already: i64) -> Option<i64> {
    if already <= 0 {
        return Some(HISTORY_BACKFILL_DAYS);
    }
    let age_ms = now_ms.saturating_sub(already);
    if age_ms < HISTORY_REFRESH_MIN_MS {
        return None;
    }
    // Include both boundary days so an hourly reading near midnight is not
    // clipped. OMP does the filtering; a smaller payload is dramatically
    // cheaper than re-emitting all 30 days on every collection pass.
    Some(
        (age_ms / DAY_MS + 2)
            .clamp(1, HISTORY_BACKFILL_DAYS),
    )
}

fn backfill_quota_history(now_ms: i64) -> Result<usize, String> {
    if !crate::services::omp_service::OmpService::is_installed_cached() {
        return Ok(0);
    }
    let already = get_state(STATE_HISTORY_BACKFILL)?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let Some(days) = history_backfill_days(now_ms, already) else {
        return Ok(0);
    };
    let days = days.to_string();
    let output = match crate::services::omp_service::OmpService::run_json(&[
        "usage",
        "--history",
        "--json",
        "--days",
        &days,
    ]) {
        Ok(output) if output.success => output,
        Ok(_) => return Ok(0),
        Err(error) => {
            eprintln!("[SYNC V2] quota history: sampling failed: {error}");
            return Ok(0);
        }
    };
    let Some(payload) = output.json else {
        return Ok(0);
    };
    let inserted = backfill_entries(
        &payload,
        already,
        // Everything historical is already on disk in the traffic store, so
        // these readings are fully ingested by definition.
        crate::services::usage_source_service::omp_ingestion_horizon(),
    )?;
    if inserted > 0 {
        eprintln!("[SYNC V2] quota history: backfilled {inserted} recorded readings");
    }
    Ok(inserted)
}

/// Seed retained readings from a history payload. Split out from the OMP call so
/// the parsing and privacy guarantees are testable without spawning a process.
///
/// Returns how many entries were offered; duplicates are ignored by the store
/// rather than counted separately, so a repeat run reports the same number and
/// inserts nothing.
fn backfill_entries(
    payload: &Value,
    already: i64,
    ingested_through: Option<i64>,
) -> Result<usize, String> {
    let entries = payload
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut inserted = 0usize;
    let mut newest = already;
    for entry in entries {
        let Some(recorded_at) = timestamp_millis(entry.get("recordedAt")) else {
            continue;
        };
        if recorded_at <= already {
            continue;
        }
        let Some(provider) = entry
            .get("provider")
            .and_then(Value::as_str)
            .and_then(normalize_identifier)
        else {
            continue;
        };
        let Some(limit_id) = entry
            .get("limitId")
            .and_then(Value::as_str)
            .and_then(normalize_identifier)
        else {
            continue;
        };
        let Some(used_fraction) = entry
            .get("usedFraction")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(0.0, 1.0))
        else {
            continue;
        };
        let window_label = entry
            .get("windowLabel")
            .or_else(|| entry.get("label"))
            .and_then(Value::as_str)
            .and_then(safe_label);
        let observation = QuotaObservation {
            model_id: None,
            plan_type: None,
            used_fraction,
            // History records only the used side.
            remaining_fraction: (1.0 - used_fraction).clamp(0.0, 1.0),
            resets_at: timestamp_millis(entry.get("resetsAt")),
            window_duration_ms: window_label.as_deref().and_then(duration_from_label),
            // `accountId` is hashed and the `email` beside it is never read.
            account_hash: entry
                .get("accountId")
                .and_then(Value::as_str)
                .and_then(|account| account_hash(&provider, account)),
            window_label,
            provider,
            limit_id,
        };
        record_quota_sample(&observation, recorded_at, ingested_through)?;
        inserted += 1;
        newest = newest.max(recorded_at);
    }
    if newest > already {
        set_state(STATE_HISTORY_BACKFILL, &newest.to_string(), now_millis())?;
    }
    Ok(inserted)
}

/// Drop quota samples older than the retention horizon.
fn prune_quota_samples(now_ms: i64) -> Result<usize, String> {
    let cutoff = now_ms.saturating_sub(QUOTA_SAMPLE_RETENTION_MS);
    StorageService::connect()?
        .execute(
            "DELETE FROM usage_quota_samples WHERE observed_at < ?1",
            params![cutoff],
        )
        .map_err(|error| error.to_string())
}

fn quota_rows_from_payload(payload: &Value, now_ms: i64) -> Result<Vec<V2Row>, String> {
    let observations = quota_observations_from_payload(payload);
    if observations.is_empty() {
        eprintln!("[SYNC V2] quota: payload carried no readable quota windows");
        return Ok(Vec::new());
    }
    // Read once per pass: how far the traffic store has been tailed. Captured
    // with the readings so a later solve can tell idleness from ingestion lag.
    let ingested_through = crate::services::usage_source_service::omp_ingestion_horizon();
    let mut rows = Vec::new();
    let mut sampled_providers = HashSet::new();
    for observation in &observations {
        if rows.len() >= MAX_ROWS_PER_BATCH {
            break;
        }
        let debounce_key = format!("quota_last_ms:{}", observation.provider);
        let last_sample = get_state(&debounce_key)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if now_ms.saturating_sub(last_sample) < QUOTA_DEBOUNCE_MS {
            continue;
        }
        // Retain the reading locally before it is spooled. The wire row is
        // deleted once the server accepts it, so without this the drain rate
        // could only ever be solved server-side.
        record_quota_sample(observation, now_ms, ingested_through)?;
        let identity = format!("{}:{}:{now_ms}", observation.provider, observation.limit_id);
        let digest = Sha256::digest(identity.as_bytes());
        rows.push(V2Row::QuotaSnapshot(QuotaSnapshotRow {
            snapshot_id: format!("quota:{digest:x}"),
            provider: observation.provider.clone(),
            // Hashed, never the raw id. The schema accepts this and it had been
            // sent as null, so per-account windows were indistinguishable.
            account_hash: observation.account_hash.clone(),
            limit_id: observation.limit_id.clone(),
            window_label: observation.window_label.clone(),
            observed_at: now_ms,
            used_fraction: observation.used_fraction,
            remaining_fraction: observation.remaining_fraction,
            resets_at: observation.resets_at,
            window_duration_ms: observation.window_duration_ms,
            plan_type: observation.plan_type.clone(),
        }));
        sampled_providers.insert((debounce_key, observation.provider.clone()));
    }
    for (key, provider) in sampled_providers {
        set_state(&key, &now_ms.to_string(), now_ms)?;
        eprintln!("[SYNC V2] quota: sampled provider {provider}");
    }
    rows.sort_by(|left, right| {
        let left_id = match left {
            V2Row::QuotaSnapshot(row) => row.snapshot_id.as_str(),
            _ => "",
        };
        let right_id = match right {
            V2Row::QuotaSnapshot(row) => row.snapshot_id.as_str(),
            _ => "",
        };
        left_id.cmp(right_id)
    });
    Ok(rows)
}

/// Merge collector-owned rows (coverage intervals) into the native batch.
///
/// The window is recomputed over the merged rows: a coverage interval can
/// start before the spans it accompanies, and the server rejects any row that
/// falls outside its batch window.
fn append_native_rows(
    batches: &mut Vec<V2UsageBatch>,
    rows: Vec<V2Row>,
    now_ms: i64,
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let now_seconds = now_ms / 1000;
    let merged = match batches
        .iter()
        .position(|batch| batch.source == SourceKind::Native)
    {
        Some(index) => {
            let mut batch = batches.remove(index);
            batch.rows.extend(rows);
            batch.rows
        }
        None => rows,
    };
    let Some((merged, window_start, window_end)) = clamp_v2_rows(merged, now_seconds) else {
        return Ok(());
    };
    let digest = Sha256::digest(serde_json::to_vec(&merged).map_err(|error| error.to_string())?);
    batches.push(V2UsageBatch {
        source: SourceKind::Native,
        idempotency_key: format!("native:v2:{digest:x}"),
        window_start,
        window_end,
        rows: merged,
    });
    Ok(())
}

fn coverage_row(
    started_at: i64,
    ended_at: i64,
    status: &str,
    reason: Option<&str>,
) -> CollectorCoverageRow {
    let identity = format!(
        "{started_at}:{ended_at}:{status}:{}",
        reason.unwrap_or("none")
    );
    let digest = Sha256::digest(identity.as_bytes());
    CollectorCoverageRow {
        coverage_id: format!("coverage:{digest:x}"),
        started_at,
        ended_at,
        status: status.to_string(),
        reason: reason.map(str::to_string),
    }
}

fn get_state(key: &str) -> Result<Option<String>, String> {
    StorageService::connect()?
        .query_row(
            "SELECT value FROM usage_v2_collector_state WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn set_state(key: &str, value: &str, updated_at: i64) -> Result<(), String> {
    StorageService::connect()?
        .execute(
            "INSERT INTO usage_v2_collector_state (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn delete_state(key: &str) -> Result<(), String> {
    StorageService::connect()?
        .execute(
            "DELETE FROM usage_v2_collector_state WHERE key = ?1",
            params![key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn parse_source(source: &str) -> Option<SourceKind> {
    match source {
        "native" => Some(SourceKind::Native),
        "omp" => Some(SourceKind::Omp),
        "claude-code" => Some(SourceKind::ClaudeCode),
        "codex" => Some(SourceKind::Codex),
        "opencode" => Some(SourceKind::OpenCode),
        _ => None,
    }
}

fn safe_label(value: &str) -> Option<String> {
    if value.is_empty() || value.contains(['\r', '\n']) || value.chars().any(char::is_control) {
        return None;
    }
    Some(value.chars().take(128).collect())
}

fn timestamp_millis(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_i64().map(|timestamp| {
            if timestamp < 100_000_000_000 {
                timestamp.saturating_mul(1000)
            } else {
                timestamp
            }
        }),
        Some(Value::String(value)) => {
            crate::services::harness_usage_service::parse_iso_to_epoch(value)
                .map(|timestamp| timestamp.saturating_mul(1000))
        }
        _ => None,
    }
    .filter(|timestamp| *timestamp >= 0)
}

fn duration_from_label(label: &str) -> Option<i64> {
    match label.trim().to_ascii_lowercase().as_str() {
        "5h" | "5 hour" | "5 hours" => Some(18_000_000),
        "daily" | "24h" => Some(86_400_000),
        "weekly" | "7d" => Some(604_800_000),
        "monthly" | "30d" => Some(2_592_000_000),
        _ => None,
    }
}

fn parse_gap(value: &str) -> Option<(i64, i64)> {
    let (start, end) = value.split_once(':')?;
    Some((start.parse().ok()?, end.parse().ok()?))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::usage_envelope::validate_v2_row;
    use serde_json::json;

    fn coverage_batch() -> V2UsageBatch {
        V2UsageBatch {
            source: SourceKind::Native,
            idempotency_key: "native:coverage:test:v2".to_string(),
            window_start: 1,
            window_end: 2,
            rows: vec![V2Row::CollectorCoverage(coverage_row(
                1_000, 2_000, "complete", None,
            ))],
        }
    }

    #[test]
    fn durable_spool_persists_and_replays_batches() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let batch = coverage_batch();
        UsageV2CollectorService::persist_batch(&batch).unwrap();

        let replayed = UsageV2CollectorService::pending_batches().unwrap();
        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].idempotency_key, batch.idempotency_key);
        assert_eq!(replayed[0].rows, batch.rows);

        UsageV2CollectorService::delete_batch(&batch.idempotency_key).unwrap();
        assert!(UsageV2CollectorService::pending_batches()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn trimming_an_under_cap_spool_keeps_every_batch() {
        // A negative LIMIT is "no limit" in SQLite, so an under-cap trim that
        // computed a negative excess silently deleted the entire spool — every
        // collected row was destroyed before it could ever be shipped.
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        for index in 0..3 {
            UsageV2CollectorService::persist_batch(&V2UsageBatch {
                source: SourceKind::Native,
                idempotency_key: format!("native:coverage:test:{index}"),
                window_start: 1,
                window_end: 2,
                rows: vec![V2Row::CollectorCoverage(coverage_row(
                    1_000, 2_000, "complete", None,
                ))],
            })
            .unwrap();
        }

        assert_eq!(UsageV2CollectorService::trim_spool().unwrap(), None);

        let remaining: i64 = StorageService::connect()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM usage_v2_pending_batches", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 3, "an under-cap spool must not be trimmed");
    }

    #[test]
    fn quota_sampling_is_debounced_per_provider_and_keeps_reset_identity() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let payload = json!({
            "windows": [{
                "provider": "anthropic",
                "limitId": "anthropic:claude-max:5h",
                "windowLabel": "5h",
                "planType": "Claude Max",
                "usedFraction": 0.4,
                "remainingFraction": 0.6,
                "resetsAt": 1_800_018_000_000i64
            }]
        });
        let observed_at = 1_800_000_000_000i64;
        let first = quota_rows_from_payload(&payload, observed_at).unwrap();
        assert_eq!(first.len(), 1);
        let V2Row::QuotaSnapshot(snapshot) = &first[0] else {
            panic!("expected quota snapshot")
        };
        assert_eq!(snapshot.resets_at, Some(1_800_018_000_000));
        assert_eq!(snapshot.window_duration_ms, Some(18_000_000));
        validate_v2_row(&first[0]).unwrap();

        assert!(quota_rows_from_payload(&payload, observed_at + 30_000)
            .unwrap()
            .is_empty());
        assert_eq!(
            quota_rows_from_payload(&payload, observed_at + QUOTA_DEBOUNCE_MS)
                .unwrap()
                .len(),
            1
        );
    }

    /// The shape `omp usage --json` actually emits. An earlier parser read a
    /// flat top-level `windows` array that the sampler has never produced, so
    /// every quota reading was silently dropped and the drain-rate signal the
    /// collector exists to capture never arrived.
    #[test]
    fn quota_parser_reads_the_nested_reports_shape_omp_actually_emits() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let payload = json!({
            "generatedAt": 1_800_000_000_000i64,
            "reports": [{
                "provider": "anthropic",
                "fetchedAt": 1_800_000_000_000i64,
                "limits": [{
                    "id": "claude-opus-5:reset-1800018000000",
                    "label": "Claude claude-opus-5",
                    "scope": {
                        "provider": "anthropic",
                        "modelId": "claude-opus-5",
                        "tier": "Max",
                        "windowId": "reset-1800018000000"
                    },
                    "window": {
                        "id": "reset-1800018000000",
                        "label": "5h",
                        "resetsAt": 1_800_018_000_000i64
                    },
                    "amount": {
                        "unit": "percent",
                        "used": 40,
                        "remaining": 60,
                        "limit": 100,
                        "usedFraction": 0.4,
                        "remainingFraction": 0.6
                    }
                }]
            }]
        });
        let observed_at = 1_800_000_000_000i64;
        let rows = quota_rows_from_payload(&payload, observed_at).unwrap();
        assert_eq!(rows.len(), 1, "nested reports[].limits[] must yield a row");
        let V2Row::QuotaSnapshot(snapshot) = &rows[0] else {
            panic!("expected quota snapshot")
        };
        assert_eq!(snapshot.provider, "anthropic");
        assert_eq!(snapshot.limit_id, "claude-opus-5:reset-1800018000000");
        assert_eq!(snapshot.used_fraction, 0.4);
        assert_eq!(snapshot.remaining_fraction, 0.6);
        // The reset identity is what proves two snapshots share one window.
        assert_eq!(snapshot.resets_at, Some(1_800_018_000_000));
        assert_eq!(snapshot.plan_type.as_deref(), Some("Max"));
        validate_v2_row(&rows[0]).unwrap();

        // The reading is retained locally, with the model id the wire row
        // cannot carry, or no drain rate can ever be solved on this machine.
        let (model, used): (Option<String>, f64) = StorageService::connect()
            .unwrap()
            .query_row(
                "SELECT model_id, used_fraction FROM usage_quota_samples
                 WHERE provider = 'anthropic'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(model.as_deref(), Some("claude-opus-5"));
        assert_eq!(used, 0.4);
    }

    #[test]
    fn quota_parser_skips_limits_with_no_drain_signal() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let payload = json!({
            "reports": [{
                "provider": "openai-codex",
                "limits": [
                    { "id": "no-amount", "scope": { "provider": "openai-codex" } },
                    {
                        "id": "remaining-only",
                        "scope": { "provider": "openai-codex" },
                        "amount": { "remainingFraction": 0.25 }
                    }
                ]
            }]
        });
        let rows = quota_rows_from_payload(&payload, 1_800_000_000_000).unwrap();
        assert_eq!(rows.len(), 1, "only the limit carrying a fraction survives");
        let V2Row::QuotaSnapshot(snapshot) = &rows[0] else {
            panic!("expected quota snapshot")
        };
        assert_eq!(snapshot.limit_id, "remaining-only");
        // `used` is derived from `remaining` when the sampler reports only one.
        assert_eq!(snapshot.used_fraction, 0.75);
        assert_eq!(snapshot.remaining_fraction, 0.25);
    }

    /// The account identity lives in `metadata`, alongside the account email.
    /// The id must be hashed and the email must never leave the payload — a
    /// quota window belongs to an account, but which human owns it is not usage.
    #[test]
    fn quota_parser_hashes_the_account_and_never_reads_the_email() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let payload = json!({
            "reports": [{
                "provider": "anthropic",
                "metadata": {
                    "accountId": "fbff1c2c-342a-4193-b058-8fd9216678c6",
                    "email": "person@example.com",
                    "planType": "plus"
                },
                "limits": [{
                    "id": "anthropic:5h",
                    "scope": { "provider": "anthropic", "shared": true },
                    "window": { "resetsAt": 1_800_018_000_000i64 },
                    "amount": { "usedFraction": 0.31, "remainingFraction": 0.69 }
                }]
            }]
        });
        let rows = quota_rows_from_payload(&payload, 1_800_000_000_000).unwrap();
        let V2Row::QuotaSnapshot(snapshot) = &rows[0] else {
            panic!("expected quota snapshot")
        };
        let hash = snapshot
            .account_hash
            .as_deref()
            .expect("the account must be identified, in hashed form");
        assert_eq!(hash.len(), 32, "32 hex chars, as the wire schema requires");
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(
            !hash.contains("fbff1c2c"),
            "the raw account id must not survive hashing"
        );
        // `scope.tier` is absent here, so the plan falls back to metadata.
        assert_eq!(snapshot.plan_type.as_deref(), Some("plus"));
        validate_v2_row(&rows[0]).unwrap();

        // Nothing anywhere in the serialized row, or in what was retained
        // locally, may carry the email.
        let wire = serde_json::to_string(&rows[0]).unwrap();
        assert!(!wire.contains("person@example.com"), "email reached the wire");
        assert!(!wire.contains("@"), "no address-shaped value may appear: {wire}");
        let retained: String = StorageService::connect()
            .unwrap()
            .query_row(
                "SELECT group_concat(COALESCE(account_hash, '') || '|' || provider)
                 FROM usage_quota_samples",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!retained.contains('@'), "email was persisted: {retained}");
    }

    #[test]
    fn history_backfill_skips_recent_checkpoints_and_bounds_catch_up() {
        let now = 2_000_000_000_000i64;
        assert_eq!(history_backfill_days(now, 0), Some(30));
        assert_eq!(
            history_backfill_days(now, now - 3_600_000),
            None,
            "an hourly checkpoint is already current"
        );
        assert_eq!(
            history_backfill_days(now, now - 25 * 3_600_000),
            Some(3),
            "catch-up includes both calendar-day boundaries"
        );
        assert_eq!(
            history_backfill_days(now, now - 90 * DAY_MS),
            Some(30),
            "catch-up never asks OMP for more than retention keeps"
        );
    }

    /// OMP already records hourly quota snapshots. Seeding from them is what
    /// lets a fresh install report a drain rate immediately instead of waiting
    /// days to observe two windows itself.
    #[test]
    fn history_backfill_is_idempotent_and_hashes_accounts() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let entries = json!({
            "entries": [
                {
                    "recordedAt": 1_800_000_000_000i64,
                    "provider": "anthropic",
                    "accountId": "acct-1",
                    "email": "person@example.com",
                    "limitId": "anthropic:5h",
                    "windowLabel": "5h",
                    "usedFraction": 0.20,
                    "resetsAt": 1_800_018_000_000i64
                },
                {
                    "recordedAt": 1_800_003_600_000i64,
                    "provider": "anthropic",
                    "accountId": "acct-1",
                    "limitId": "anthropic:5h",
                    "windowLabel": "5h",
                    "usedFraction": 0.26,
                    "resetsAt": 1_800_018_000_000i64
                },
                // Unusable: no fraction to derive a drain from.
                {
                    "recordedAt": 1_800_007_200_000i64,
                    "provider": "anthropic",
                    "limitId": "anthropic:5h"
                }
            ]
        });
        let inserted = backfill_entries(&entries, 0, None).unwrap();
        assert_eq!(inserted, 2, "only readings carrying a fraction are seeded");

        let (count, emails): (i64, String) = StorageService::connect()
            .unwrap()
            .query_row(
                "SELECT COUNT(*), COALESCE(group_concat(account_hash), '')
                 FROM usage_quota_samples",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 2);
        assert!(!emails.contains('@'), "history email was persisted: {emails}");
        assert!(!emails.contains("acct-1"), "raw account id was persisted");

        // Re-running seeds nothing: readings are keyed by their instant.
        let again = backfill_entries(&entries, 0, None).unwrap();
        assert_eq!(again, 2, "the same rows are re-offered");
        let after: i64 = StorageService::connect()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM usage_quota_samples", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(after, 2, "but none are duplicated");

        // A watermark skips what was already seeded.
        assert_eq!(
            backfill_entries(&entries, 1_800_000_000_000, None).unwrap(),
            1,
            "only readings newer than the watermark are considered"
        );
    }

    #[test]
    fn native_quota_capture_hashes_account_and_debounces_spool_writes() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        AnalyticsService::set_consent(&crate::models::permission::AnalyticsConsent {
            collection_enabled: true,
            upload_enabled: false,
            consent_version: Some("test".to_string()),
            consented_at: Some(1),
        })
        .unwrap();
        let windows = vec![crate::services::provider_client::ProviderQuotaWindow {
            limit_id: "openai:api:requests".to_string(),
            window_label: Some("requests".to_string()),
            used_fraction: 0.25,
            remaining_fraction: 0.75,
            resets_at: Some(1_800_000_060_000),
            window_duration_ms: None,
        }];
        UsageV2CollectorService::record_native_quota_windows(
            "openai",
            Some("local-account-id"),
            &windows,
        )
        .unwrap();
        UsageV2CollectorService::record_native_quota_windows(
            "openai",
            Some("local-account-id"),
            &windows,
        )
        .unwrap();
        let pending = UsageV2CollectorService::pending_batches().unwrap();
        assert_eq!(pending.len(), 1);
        let V2Row::QuotaSnapshot(snapshot) = &pending[0].rows[0] else {
            panic!("expected quota snapshot")
        };
        let account_hash = snapshot.account_hash.as_deref().unwrap();
        assert_eq!(account_hash.len(), 32);
        assert!(account_hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
        validate_v2_row(&pending[0].rows[0]).unwrap();
    }

    #[test]
    fn coverage_generation_records_complete_and_stopped_intervals() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        assert!(UsageV2CollectorService::start(1_000).unwrap().is_empty());

        let complete = UsageV2CollectorService::heartbeat(2_000).unwrap();
        assert_eq!(complete.len(), 1);
        validate_v2_row(&complete[0]).unwrap();
        let V2Row::CollectorCoverage(complete_row) = &complete[0] else {
            panic!("expected coverage row")
        };
        assert_eq!(complete_row.status, "complete");
        assert_eq!(complete_row.reason, None);

        let stopped = UsageV2CollectorService::stop(3_000).unwrap();
        assert_eq!(stopped.len(), 1);
        let restarted = UsageV2CollectorService::start(4_000).unwrap();
        assert_eq!(restarted.len(), 1);
        let V2Row::CollectorCoverage(gap) = &restarted[0] else {
            panic!("expected coverage gap")
        };
        assert_eq!(gap.status, "gap");
        assert_eq!(gap.reason.as_deref(), Some("collector_stopped"));
        validate_v2_row(&restarted[0]).unwrap();
    }
}

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

const COLLECT_INTERVAL_SECS: u64 = 300;
const QUOTA_DEBOUNCE_MS: i64 = 60_000;
const MAX_PENDING_BATCHES: i64 = 1_000;
const STATE_HEARTBEAT_MS: &str = "coverage_heartbeat_ms";
const STATE_RUNNING: &str = "coverage_running";
const STATE_SPOOL_GAP: &str = "spool_gap";

static COLLECTOR_RUNNING: AtomicBool = AtomicBool::new(false);

pub struct UsageV2CollectorService;

impl UsageV2CollectorService {
    /// Persist every collected batch before any transport attempt.
    pub fn collect_and_spool() -> Result<usize, String> {
        eprintln!("[SYNC V2] collector: collecting local sources");
        if !AnalyticsService::get_consent()?.collection_enabled {
            eprintln!("[SYNC V2] collector: collection consent disabled");
            return Ok(0);
        }
        let now_ms = now_millis();
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
        if let Some((started_at, ended_at)) = dropped {
            set_state(STATE_SPOOL_GAP, &format!("{started_at}:{ended_at}"), now_ms)?;
            eprintln!("[SYNC V2] collector: spool cap dropped oldest batches");
        }
        eprintln!("[SYNC V2] collector: persisted {persisted} batches");
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
                tokio::time::sleep(Duration::from_secs(COLLECT_INTERVAL_SECS)).await;
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

fn quota_rows_from_payload(payload: &Value, now_ms: i64) -> Result<Vec<V2Row>, String> {
    let windows = payload
        .get("windows")
        .or_else(|| payload.get("usage"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut rows = Vec::new();
    let mut sampled_providers = HashSet::new();
    for window in windows {
        if rows.len() >= MAX_ROWS_PER_BATCH {
            break;
        }
        let Some(provider) = window
            .get("provider")
            .and_then(Value::as_str)
            .and_then(normalize_identifier)
        else {
            continue;
        };
        let debounce_key = format!("quota_last_ms:{provider}");
        let last_sample = get_state(&debounce_key)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if now_ms.saturating_sub(last_sample) < QUOTA_DEBOUNCE_MS {
            continue;
        }
        let used_fraction = window
            .get("usedFraction")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let remaining_fraction = window
            .get("remainingFraction")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(1.0 - used_fraction)
            .clamp(0.0, 1.0);
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
        let resets_at = timestamp_millis(window.get("resetsAt"));
        let window_duration_ms = window
            .get("windowDurationMs")
            .and_then(Value::as_i64)
            .or_else(|| window_label.as_deref().and_then(duration_from_label));
        let identity = format!("{provider}:{limit_id}:{now_ms}");
        let digest = Sha256::digest(identity.as_bytes());
        rows.push(V2Row::QuotaSnapshot(QuotaSnapshotRow {
            snapshot_id: format!("quota:{digest:x}"),
            provider: provider.clone(),
            account_hash: None,
            limit_id,
            window_label,
            observed_at: now_ms,
            used_fraction,
            remaining_fraction,
            resets_at,
            window_duration_ms,
            plan_type,
        }));
        sampled_providers.insert((debounce_key, provider));
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

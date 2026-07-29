//! Typed usage-source registry.
//!
//! Each source (OMP, Basebuild Native) is registered with independent
//! availability and checkpoint state. Missing OMP cannot block native
//! usage, and native failures cannot block OMP usage.

use std::collections::BTreeMap;
use std::path::PathBuf;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::models::usage_envelope::{
    clamp_v2_rows, clamp_window, normalize_identifier, RequestSpanRow, SourceKind, UsageBatch,
    V2Row, V2UsageBatch, MAX_ROWS_PER_BATCH,
};
use crate::services::storage_service::StorageService;

/// Result of collecting a usage batch from a source.
#[derive(Debug)]
pub struct SourceCollection {
    /// The source kind.
    pub source: SourceKind,
    /// The collected batch, if any. `None` means the source is available
    /// but has no new data since the last checkpoint.
    pub batch: Option<UsageBatch>,
    /// Diagnostic message for status reporting (never contains user content).
    pub diagnostic: String,
    /// Why this source produced nothing, when the cause was a failure rather
    /// than an empty window. Typed so the coordinator never has to sniff the
    /// diagnostic string to tell "no data" from "broken".
    pub error: Option<String>,
}

/// Result of collecting a typed version 2 batch from one source.
#[derive(Debug)]
pub struct SourceCollectionV2 {
    pub source: SourceKind,
    pub batch: Option<V2UsageBatch>,
    pub diagnostic: String,
    pub error: Option<String>,
}

/// return batches but never mutate process state.
pub trait UsageSource: Send + Sync {
    /// Which source kind this is.
    fn kind(&self) -> SourceKind;

    /// Whether the source is available (e.g., OMP is installed, native
    /// chat DB is readable). Does not perform network I/O.
    fn available(&self) -> bool;

    /// Collect a usage batch since the last checkpoint. Returns `None` if
    /// there is no new data. Never reads or serializes chat text, reasoning,
    /// tool content, credentials, or project paths.
    fn collect(&self) -> Result<Option<UsageBatch>, String>;

    /// Collect request-level version 2 rows when this source supports them.
    /// Unsupported sources remain on the unchanged version 1 path.
    fn collect_v2(&self) -> Result<Option<V2UsageBatch>, String> {
        Ok(None)
    }

    /// Advance the checkpoint after the server acknowledged the batch.
    /// Only called after a successful push.
    fn advance_checkpoint(&self, batch: &UsageBatch) -> Result<(), String>;

    /// Abandon a batch the server (or the local validator) will never accept,
    /// advancing past it so the same poison window is not replayed forever.
    /// Defaults to the accept path, which is correct for cursor-only sources.
    fn discard_batch(&self, batch: &UsageBatch) -> Result<(), String> {
        self.advance_checkpoint(batch)
    }

    /// Advance the independent version 2 checkpoint after a terminal receipt.
    fn advance_v2_checkpoint(&self, _batch: &V2UsageBatch) -> Result<(), String> {
        Ok(())
    }

    /// Locally recorded usage not yet accepted by the server, when it can be
    /// answered CHEAPLY — this runs on every status read, so an
    /// implementation must never re-parse its store. Default `None` means
    /// "not measurable", which the UI renders as "waiting", not "nothing".
    fn pending_requests(&self) -> Option<i64> {
        None
    }

    /// Human-readable diagnostic for status reporting.
    fn diagnostic(&self) -> String;
}

/// OMP usage source. Converts cumulative `omp stats --json` counters into
/// acknowledged deltas. A pending batch is persisted before transport and is
/// replayed unchanged until the server accepts it, so retries and restarts do
/// not duplicate or lose usage.
pub struct OmpSource;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OmpCounter {
    provider: String,
    model: String,
    requests: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    cost_total: f64,
}

impl OmpSource {
    fn load_cursor(&self) -> Result<(BTreeMap<String, OmpCounter>, Option<String>), String> {
        let conn = StorageService::connect()?;
        let row = conn
            .query_row(
                "SELECT state_json, pending_batch_json
                 FROM usage_source_cursors WHERE source = 'omp'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((state_json, pending_batch)) = row else {
            return Ok((BTreeMap::new(), None));
        };
        let state = serde_json::from_str(&state_json).map_err(|error| error.to_string())?;
        Ok((state, pending_batch))
    }

    fn persist_pending(
        &self,
        state: &BTreeMap<String, OmpCounter>,
        batch: &UsageBatch,
    ) -> Result<(), String> {
        let state_json = serde_json::to_string(state).map_err(|error| error.to_string())?;
        let batch_json = serde_json::to_string(batch).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO usage_source_cursors
                (source, state_json, pending_state_json, pending_batch_json, updated_at)
             VALUES ('omp', '{}', ?1, ?2, ?3)
             ON CONFLICT(source) DO UPDATE SET
                pending_state_json = excluded.pending_state_json,
                pending_batch_json = excluded.pending_batch_json,
                updated_at = excluded.updated_at",
            params![state_json, batch_json, now_seconds()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn persist_baseline(&self, state: &BTreeMap<String, OmpCounter>) -> Result<(), String> {
        let state_json = serde_json::to_string(state).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO usage_source_cursors
                (source, state_json, pending_state_json, pending_batch_json, updated_at)
             VALUES ('omp', ?1, NULL, NULL, ?2)
             ON CONFLICT(source) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = excluded.updated_at",
            params![state_json, now_seconds()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }
}

impl UsageSource for OmpSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Omp
    }

    fn available(&self) -> bool {
        crate::services::omp_service::OmpService::is_installed_cached()
    }

    fn collect(&self) -> Result<Option<UsageBatch>, String> {
        let (previous, pending_batch) = self.load_cursor()?;
        if let Some(pending) = pending_batch {
            return serde_json::from_str(&pending)
                .map(Some)
                .map_err(|error| error.to_string());
        }

        let output = crate::services::omp_service::OmpService::run_json(&["stats", "--json"])?;
        if !output.success {
            return Err("OMP aggregate collection failed".to_string());
        }
        let stats = output
            .json
            .ok_or_else(|| "OMP returned no aggregate usage data".to_string())?;
        let current = parse_omp_counters(&stats);
        if current.is_empty() {
            return Ok(None);
        }

        let rows = omp_delta_rows(&previous, &current);
        if rows.is_empty() {
            self.persist_baseline(&current)?;
            return Ok(None);
        }

        let window_end = now_seconds();
        let window_start = if previous.is_empty() {
            // A first-ever collect reports the whole cumulative counter; the
            // widest window the server accepts is 31 days.
            window_end.saturating_sub(crate::models::usage_envelope::MAX_WINDOW_SECS)
        } else {
            window_end.saturating_sub(1)
        };
        let (window_start, window_end) = clamp_window(window_start, window_end, window_end)
            .ok_or_else(|| "OMP usage window is outside the accepted range".to_string())?;
        let serialized_rows = serde_json::to_vec(&rows).map_err(|error| error.to_string())?;
        let digest = Sha256::digest(serialized_rows);
        let idempotency_key = format!("omp:v1:{digest:x}");
        let batch = UsageBatch {
            source: SourceKind::Omp,
            idempotency_key,
            window_start,
            window_end,
            rows,
        };
        self.persist_pending(&current, &batch)?;
        Ok(Some(batch))
    }

    /// Collect per-request spans straight from OMP's `stats.db`.
    ///
    /// `omp stats --json` only exposes cumulative per-model counters, which is
    /// why the v1 path has to diff them. The underlying `messages` table is
    /// already one row per request and carries the two fields no other source
    /// can supply: a real `cost_total` and a measured `ttft`.
    ///
    /// The cursor is `messages.rowid`, not a timestamp. Rows are only ever
    /// appended, so a monotonic rowid cannot skip a row that was inserted while
    /// a batch was in flight — which is exactly the failure a wall-clock cursor
    /// invites. It is banked against the batch key and only adopted once the
    /// server accepts, so a crash mid-flight re-offers rows instead of losing
    /// them.
    fn collect_v2(&self) -> Result<Option<V2UsageBatch>, String> {
        let Some(path) = omp_stats_db_path() else {
            return Ok(None);
        };
        if !path.exists() {
            return Ok(None);
        }
        let since = v2_rowid_cursor()?;
        let (rows, max_rowid) = read_omp_spans(&path, since, MAX_ROWS_PER_BATCH)?;
        if rows.is_empty() {
            return Ok(None);
        }
        let now = now_seconds();
        let Some((rows, window_start, window_end)) = clamp_v2_rows(rows, now) else {
            // Everything readable is older than the retention horizon. Bank the
            // rowid so the dead tail is not re-read on every pass.
            set_v2_rowid_cursor(max_rowid)?;
            return Ok(None);
        };
        let digest = Sha256::digest(serde_json::to_vec(&rows).map_err(|e| e.to_string())?);
        let idempotency_key = format!("omp:v2:{digest:x}");
        bank_v2_rowid(&idempotency_key, max_rowid)?;
        Ok(Some(V2UsageBatch {
            source: SourceKind::Omp,
            idempotency_key,
            window_start,
            window_end,
            rows,
        }))
    }

    /// Adopt the banked rowid for the batch the server just accepted.
    fn advance_v2_checkpoint(&self, batch: &V2UsageBatch) -> Result<(), String> {
        if let Some(rowid) = take_banked_v2_rowid(&batch.idempotency_key)? {
            set_v2_rowid_cursor(rowid)?;
        }
        Ok(())
    }

    /// Clear the pending batch without adopting its counters as the new
    /// baseline. The delta stays owed and is re-offered on the next collect
    /// with a fresh window, instead of replaying a window the server refused.
    fn discard_batch(&self, batch: &UsageBatch) -> Result<(), String> {
        let conn = StorageService::connect()?;
        let stored: Option<String> = conn
            .query_row(
                "SELECT pending_batch_json FROM usage_source_cursors WHERE source = 'omp'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        let Some(stored) = stored else {
            return Ok(());
        };
        let stored: UsageBatch =
            serde_json::from_str(&stored).map_err(|error| error.to_string())?;
        if stored.idempotency_key != batch.idempotency_key {
            return Ok(());
        }
        conn.execute(
            "UPDATE usage_source_cursors
             SET pending_state_json = NULL, pending_batch_json = NULL, updated_at = ?1
             WHERE source = 'omp'",
            params![now_seconds()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn advance_checkpoint(&self, batch: &UsageBatch) -> Result<(), String> {
        let conn = StorageService::connect()?;
        let pending = conn
            .query_row(
                "SELECT pending_state_json, pending_batch_json
                 FROM usage_source_cursors WHERE source = 'omp'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((Some(pending_state), Some(pending_batch))) = pending else {
            return Ok(());
        };
        let stored: UsageBatch =
            serde_json::from_str(&pending_batch).map_err(|error| error.to_string())?;
        if stored.idempotency_key != batch.idempotency_key {
            return Err("OMP checkpoint did not match the acknowledged batch".to_string());
        }
        conn.execute(
            "UPDATE usage_source_cursors
             SET state_json = ?1, pending_state_json = NULL,
                 pending_batch_json = NULL, updated_at = ?2
             WHERE source = 'omp'",
            params![pending_state, now_seconds()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn diagnostic(&self) -> String {
        let status = crate::services::omp_service::OmpService::status();
        if status.installed {
            format!("OMP installed (v{})", status.version.unwrap_or_default())
        } else {
            "OMP not installed".to_string()
        }
    }
}

fn parse_omp_counters(stats: &Value) -> BTreeMap<String, OmpCounter> {
    let rows = stats
        .get("byModel")
        .and_then(Value::as_array)
        .or_else(|| stats.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut counters = BTreeMap::new();
    for row in rows {
        let Some(provider) = row.get("provider").and_then(Value::as_str) else {
            continue;
        };
        let Some(model) = row
            .get("model")
            .or_else(|| row.get("modelId"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        // Coerce to the wire charset rather than discarding the row: OMP
        // reports whatever the upstream provider called the model, and
        // dropping it silently lost real usage.
        let (Some(provider), Some(model)) = (
            normalize_identifier(provider),
            normalize_identifier(model),
        ) else {
            continue;
        };
        let requests = nonnegative_i64(row, &["requests", "requestCount", "totalRequests"]);
        if requests == 0 {
            continue;
        }
        let counter = OmpCounter {
            provider: provider.clone(),
            model: model.clone(),
            requests,
            input_tokens: nonnegative_i64(row, &["inputTokens", "totalInputTokens"]),
            output_tokens: nonnegative_i64(row, &["outputTokens", "totalOutputTokens"]),
            cache_read_tokens: nonnegative_i64(row, &["cacheReadTokens", "totalCacheReadTokens"]),
            cache_write_tokens: nonnegative_i64(row, &["cacheWriteTokens", "totalCacheWriteTokens"]),
            cost_total: row
                .get("costTotal")
                .or_else(|| row.get("totalCost"))
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value >= 0.0)
                .unwrap_or(0.0),
        };
        counters.insert(format!("{provider}\u{1f}{model}"), counter);
    }
    counters
}

fn omp_delta_rows(
    previous: &BTreeMap<String, OmpCounter>,
    current: &BTreeMap<String, OmpCounter>,
) -> Vec<Value> {
    current
        .iter()
        .filter_map(|(key, now)| {
            let before = previous.get(key).cloned().unwrap_or_default();
            let reset = now.requests < before.requests;
            let delta = |current: i64, prior: i64| {
                if reset || current < prior {
                    current
                } else {
                    current - prior
                }
            };
            let requests = delta(now.requests, before.requests);
            if requests <= 0 {
                return None;
            }
            let cost = if reset || now.cost_total < before.cost_total {
                now.cost_total
            } else {
                now.cost_total - before.cost_total
            };
            Some(json!({
                "kind": "model_usage",
                "provider": now.provider,
                "model": now.model,
                "requests": requests.clamp(1, 1_000_000),
                "inputTokens": delta(now.input_tokens, before.input_tokens).clamp(0, i32::MAX as i64),
                "outputTokens": delta(now.output_tokens, before.output_tokens).clamp(0, i32::MAX as i64),
                "cacheReadTokens": delta(now.cache_read_tokens, before.cache_read_tokens).clamp(0, i32::MAX as i64),
                "cacheWriteTokens": delta(now.cache_write_tokens, before.cache_write_tokens).clamp(0, i32::MAX as i64),
                "costTotal": cost.clamp(0.0, 1_000_000.0),
                "durationMs": 0,
                "durationCount": 0,
                "ttftMs": 0,
                "ttftCount": 0,
                "errors": 0,
            }))
        })
        .collect()
}

fn nonnegative_i64(row: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| row.get(*key).and_then(Value::as_i64))
        .unwrap_or(0)
        .max(0)
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

/// Basebuild Native chat usage source. Reads from the request metrics
/// ledger without reading or serializing chat text.
pub struct NativeSource;

impl UsageSource for NativeSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Native
    }

    fn available(&self) -> bool {
        // The native chat DB is always available if the app is running.
        true
    }

    fn collect(&self) -> Result<Option<UsageBatch>, String> {
        // Delegates to the sync_service's batch collector.
        match crate::services::sync_service::collect_native_batch() {
            Ok(batch) if batch.rows.is_empty() => Ok(None),
            Ok(batch) => Ok(Some(batch)),
            Err(e) => Err(e),
        }
    }

    fn collect_v2(&self) -> Result<Option<V2UsageBatch>, String> {
        match crate::services::sync_service::collect_native_v2_batch() {
            Ok(batch) if batch.rows.is_empty() => Ok(None),
            Ok(batch) => Ok(Some(batch)),
            Err(error) => Err(error),
        }
    }

    fn advance_v2_checkpoint(&self, batch: &V2UsageBatch) -> Result<(), String> {
        if !batch
            .rows
            .iter()
            .any(|row| matches!(row, V2Row::RequestSpan(_)))
        {
            return Ok(());
        }
        use crate::services::settings_service::SettingsService;
        let mut settings = SettingsService::get_usage_sync_settings()?;
        settings.last_envelope_v2_sync_at = Some(batch.window_end);
        SettingsService::set_usage_sync_settings(&settings)
    }

    fn advance_checkpoint(&self, batch: &UsageBatch) -> Result<(), String> {
        use crate::services::settings_service::SettingsService;
        let mut settings = SettingsService::get_usage_sync_settings()?;
        settings.last_envelope_sync_at = Some(batch.window_end);
        SettingsService::set_usage_sync_settings(&settings)
    }

    fn pending_requests(&self) -> Option<i64> {
        use crate::services::settings_service::SettingsService;
        // One indexed COUNT against the cursor. This is the source the user
        // is looking at when they send a message, so "nothing new" has to be
        // a measurement, not an assumption.
        let since = SettingsService::get_usage_sync_settings()
            .ok()?
            .last_envelope_sync_at
            .unwrap_or(0);
        crate::services::native_chat_service::NativeChatService::metrics_count_since(since).ok()
    }

    fn diagnostic(&self) -> String {
        "Native chat metrics available".to_string()
    }
}

/// The registry of all known usage sources. Order: native chat first (the
/// primary first-party source), then OMP, then optional local harnesses
/// (Claude Code, Codex, OpenCode). A missing harness never blocks the others.
pub fn registered_sources() -> Vec<Box<dyn UsageSource>> {
    vec![
        Box::new(NativeSource),
        Box::new(OmpSource),
        Box::new(crate::services::harness_usage_service::HarnessSource::claude_code()),
        Box::new(crate::services::harness_usage_service::HarnessSource::codex()),
        Box::new(crate::services::harness_usage_service::HarnessSource::opencode()),
    ]
}

/// Collect from every available source independently. Aggregate envelope
/// publication and the richer authenticated raw-usage stream are separate
/// server projections, so signed-in accounts must not omit OMP here.
pub fn collect_all_sources() -> Vec<SourceCollection> {
    let sources = registered_sources();
    let mut results = Vec::new();
    for source in &sources {
        let kind = source.kind();
        if !source.available() {
            results.push(SourceCollection {
                source: kind,
                batch: None,
                diagnostic: format!("{} unavailable: {}", kind.as_str(), source.diagnostic()),
                error: None,
            });
            continue;
        }
        match source.collect() {
            Ok(batch) => results.push(SourceCollection {
                source: kind,
                batch,
                diagnostic: source.diagnostic(),
                error: None,
            }),
            Err(e) => results.push(SourceCollection {
                source: kind,
                batch: None,
                diagnostic: format!("{} error: {e}", kind.as_str()),
                error: Some(e),
            }),
        }
    }
    results
}

/// Collect typed version 2 rows from capable sources. OMP remains on version 1
/// because its public stats payload contains cumulative aggregates, not events.
pub fn collect_all_sources_v2() -> Vec<SourceCollectionV2> {
    let sources = registered_sources();
    let mut results = Vec::new();
    for source in &sources {
        let kind = source.kind();
        if !source.available() {
            results.push(SourceCollectionV2 {
                source: kind,
                batch: None,
                diagnostic: format!("{} unavailable: {}", kind.as_str(), source.diagnostic()),
                error: None,
            });
            continue;
        }
        match source.collect_v2() {
            Ok(batch) => results.push(SourceCollectionV2 {
                source: kind,
                batch,
                diagnostic: source.diagnostic(),
                error: None,
            }),
            Err(error) => results.push(SourceCollectionV2 {
                source: kind,
                batch: None,
                diagnostic: format!("{} v2 error: {error}", kind.as_str()),
                error: Some(error),
            }),
        }
    }
    results
}

/// Path to OMP's per-request statistics database.
fn omp_stats_db_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".omp").join("stats.db"))
}

const OMP_V2_CURSOR: &str = "omp:v2";

fn v2_rowid_cursor() -> Result<i64, String> {
    let value: Option<i64> = StorageService::connect()?
        .query_row(
            "SELECT last_ts FROM harness_sync_checkpoints WHERE source = ?1",
            params![OMP_V2_CURSOR],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(value.unwrap_or(0))
}

fn set_v2_rowid_cursor(rowid: i64) -> Result<(), String> {
    StorageService::connect()?
        .execute(
            "INSERT INTO harness_sync_checkpoints (source, last_ts) VALUES (?1, ?2)
             ON CONFLICT(source) DO UPDATE SET last_ts = excluded.last_ts",
            params![OMP_V2_CURSOR, rowid],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Remember which rowid a batch would advance the cursor to, without moving it.
fn bank_v2_rowid(idempotency_key: &str, rowid: i64) -> Result<(), String> {
    StorageService::connect()?
        .execute(
            "INSERT INTO harness_sync_checkpoints (source, last_ts) VALUES (?1, ?2)
             ON CONFLICT(source) DO UPDATE SET last_ts = excluded.last_ts",
            params![format!("{OMP_V2_CURSOR}:pending:{idempotency_key}"), rowid],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn take_banked_v2_rowid(idempotency_key: &str) -> Result<Option<i64>, String> {
    let key = format!("{OMP_V2_CURSOR}:pending:{idempotency_key}");
    let conn = StorageService::connect()?;
    let value: Option<i64> = conn
        .query_row(
            "SELECT last_ts FROM harness_sync_checkpoints WHERE source = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM harness_sync_checkpoints WHERE source = ?1",
        params![key],
    )
    .map_err(|error| error.to_string())?;
    Ok(value)
}

/// Read appended `messages` rows as typed spans.
///
/// Opened read-only: OMP owns this database and may be writing to it. Returns
/// the spans and the highest rowid read, which is the cursor the caller banks.
fn read_omp_spans(
    path: &std::path::Path,
    since_rowid: i64,
    limit: usize,
) -> Result<(Vec<V2Row>, i64), String> {
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        | rusqlite::OpenFlags::SQLITE_OPEN_URI
        | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let uri = format!("file:{}?immutable=0", path.to_string_lossy());
    let conn = rusqlite::Connection::open_with_flags(uri, flags)
        .map_err(|error| format!("could not open OMP stats.db: {error}"))?;
    let mut statement = conn
        .prepare(
            "SELECT rowid, provider, model, timestamp, duration, ttft, stop_reason,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    cost_total, session_file
             FROM messages WHERE rowid > ?1 ORDER BY rowid ASC LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let mut max_rowid = since_rowid;
    let mut rows = Vec::new();
    let mapped = statement
        .query_map(params![since_rowid, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for entry in mapped {
        let (
            rowid,
            provider,
            model,
            timestamp,
            duration,
            ttft,
            stop_reason,
            input,
            output,
            cache_read,
            cache_write,
            cost,
            session_file,
        ) = entry.map_err(|error| error.to_string())?;
        max_rowid = max_rowid.max(rowid);
        // Identity, provider, and model are mandatory; a row missing them
        // cannot be attributed and is skipped rather than shipped as "unknown".
        let (Some(provider), Some(model)) = (
            provider.as_deref().and_then(normalize_identifier),
            model.as_deref().and_then(normalize_identifier),
        ) else {
            continue;
        };
        let Some(started_at) = timestamp.filter(|value| *value > 0) else {
            continue;
        };
        let duration = duration.unwrap_or_default().clamp(0, 86_400_000);
        // `session_file` is a local path, so it is hashed rather than sent: it
        // identifies the session for correlation without leaking the filesystem.
        let session_id = session_file
            .as_deref()
            .map(|file| {
                let digest = Sha256::digest(file.as_bytes());
                format!("omp-{:.16}", format!("{digest:x}"))
            })
            .and_then(|value| normalize_identifier(&value))
            .unwrap_or_else(|| "unknown-session".to_string());
        let event_digest = Sha256::digest(format!("omp|{rowid}|{started_at}|{model}").as_bytes());
        let outcome = match stop_reason.as_deref() {
            Some("error") | Some("failed") => "error",
            Some("cancelled") | Some("canceled") | Some("interrupted") | Some("aborted") => {
                "cancelled"
            }
            _ => "success",
        };
        rows.push(V2Row::RequestSpan(RequestSpanRow {
            event_id: format!("omp:{event_digest:x}"),
            provider,
            account_hash: None,
            model,
            session_id,
            agent_id: None,
            provider_request_id: None,
            started_at,
            completed_at: started_at.saturating_add(duration),
            input_tokens: Some(input.unwrap_or_default().clamp(0, i32::MAX as i64)),
            output_tokens: Some(output.unwrap_or_default().clamp(0, i32::MAX as i64)),
            cache_read_tokens: Some(cache_read.unwrap_or_default().clamp(0, i32::MAX as i64)),
            cache_write_tokens: Some(cache_write.unwrap_or_default().clamp(0, i32::MAX as i64)),
            // The one source with a real cost. `None` stays `None` — an absent
            // cost is unknown, not free.
            cost_total: cost
                .filter(|value| value.is_finite() && *value >= 0.0)
                .map(|value| value.clamp(0.0, 1_000_000.0)),
            ttft_ms: ttft.map(|value| value.clamp(0, 86_400_000)),
            effort: None,
            outcome: outcome.to_string(),
        }));
    }
    Ok((rows, max_rowid))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a stand-in for OMP's `stats.db`, carrying only the columns the
    /// reader selects.
    fn seed_omp_stats(path: &std::path::Path, rows: &[(&str, &str, i64, i64, Option<f64>)]) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_file TEXT, entry_id TEXT, folder TEXT, model TEXT, provider TEXT,
                api TEXT, timestamp INTEGER, duration INTEGER, ttft INTEGER,
                stop_reason TEXT, error_message TEXT,
                input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER,
                total_tokens INTEGER, premium_requests INTEGER,
                cost_input REAL, cost_output REAL, cost_cache_read REAL,
                cost_cache_write REAL, cost_total REAL, agent_type TEXT)",
        )
        .unwrap();
        for (provider, model, timestamp, output, cost) in rows {
            conn.execute(
                "INSERT INTO messages
                    (session_file, model, provider, timestamp, duration, ttft, stop_reason,
                     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_total)
                 VALUES ('/home/u/.omp/sess.jsonl', ?1, ?2, ?3, 1500, 250, 'stop',
                         100, ?4, 4096, 64, ?5)",
                params![model, provider, timestamp, output, cost],
            )
            .unwrap();
        }
    }

    /// OMP's per-request table is the only source carrying a real cost and a
    /// measured TTFT. Both must survive into the span, and an absent cost must
    /// stay `None` rather than becoming a confident zero.
    #[test]
    fn omp_spans_carry_real_cost_and_ttft_and_hash_the_session_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_omp_stats(
            &db,
            &[
                ("anthropic", "claude-opus-5", 1_800_000_000_000, 500, Some(0.42)),
                ("devin", "glm-5-2", 1_800_000_060_000, 700, None),
            ],
        );
        let (rows, max_rowid) = read_omp_spans(&db, 0, 500).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(max_rowid, 2, "cursor is the highest rowid read");

        let V2Row::RequestSpan(first) = &rows[0] else {
            panic!("expected request span")
        };
        assert_eq!(first.provider, "anthropic");
        assert_eq!(first.model, "claude-opus-5");
        assert_eq!(first.cost_total, Some(0.42), "real cost must survive");
        assert_eq!(first.ttft_ms, Some(250), "measured TTFT must survive");
        assert_eq!(first.cache_read_tokens, Some(4096));
        assert_eq!(first.cache_write_tokens, Some(64));
        assert_eq!(first.completed_at, 1_800_000_001_500, "duration extends span");
        assert!(
            !first.session_id.contains('/') && !first.session_id.contains(".omp"),
            "session path must be hashed, not shipped: {}",
            first.session_id
        );

        let V2Row::RequestSpan(second) = &rows[1] else {
            panic!("expected request span")
        };
        assert_eq!(
            second.cost_total, None,
            "an absent cost is unknown, never a free request"
        );
        for row in &rows {
            crate::models::usage_envelope::validate_v2_row(row).unwrap();
        }
    }

    /// The cursor is a rowid, so a row appended while a batch is in flight is
    /// re-read rather than skipped — the failure mode is duplication, not loss.
    #[test]
    fn omp_span_cursor_advances_by_rowid_and_never_skips_a_late_insert() {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("stats.db");
        seed_omp_stats(
            &db,
            &[("anthropic", "claude-opus-5", 1_800_000_000_000, 500, Some(0.1))],
        );
        let (first, cursor) = read_omp_spans(&db, 0, 500).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(cursor, 1);

        // Nothing new past the cursor.
        let (empty, unchanged) = read_omp_spans(&db, cursor, 500).unwrap();
        assert!(empty.is_empty());
        assert_eq!(unchanged, cursor, "an empty read must not move the cursor");

        // A row inserted with an OLDER timestamp than the one already read is
        // still picked up, because the cursor is not a clock.
        seed_omp_stats_append(&db, "devin", "glm-5-2", 1_700_000_000_000);
        let (late, advanced) = read_omp_spans(&db, cursor, 500).unwrap();
        assert_eq!(late.len(), 1, "a back-dated append must not be skipped");
        assert_eq!(advanced, 2);
    }

    fn seed_omp_stats_append(path: &std::path::Path, provider: &str, model: &str, timestamp: i64) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute(
            "INSERT INTO messages
                (session_file, model, provider, timestamp, duration, ttft, stop_reason,
                 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_total)
             VALUES ('/home/u/.omp/late.jsonl', ?1, ?2, ?3, 10, 5, 'stop', 1, 1, 0, 0, NULL)",
            params![model, provider, timestamp],
        )
        .unwrap();
    }

    #[test]
    fn registered_sources_contains_all_sources() {
        let sources = registered_sources();
        let kinds: Vec<SourceKind> = sources.iter().map(|s| s.kind()).collect();
        assert!(kinds.contains(&SourceKind::Omp));
        assert!(kinds.contains(&SourceKind::Native));
        assert!(kinds.contains(&SourceKind::ClaudeCode));
        assert!(kinds.contains(&SourceKind::Codex));
        assert!(kinds.contains(&SourceKind::OpenCode));
        assert_eq!(kinds.len(), 5);
    }

    #[test]
    fn source_collection_never_filters_omp() {
        let collections = collect_all_sources();
        assert!(
            collections.iter().any(|collection| collection.source == SourceKind::Omp),
            "OMP must be offered to the public-cohort envelope for every auth mode"
        );
    }

    #[test]
    fn registered_sources_contains_omp_and_native() {
        let sources = registered_sources();
        let kinds: Vec<SourceKind> = sources.iter().map(|s| s.kind()).collect();
        assert!(kinds.contains(&SourceKind::Omp));
        assert!(kinds.contains(&SourceKind::Native));
    }

    #[test]
    fn omp_source_kind_is_omp() {
        let source = OmpSource;
        assert_eq!(source.kind(), SourceKind::Omp);
    }

    #[test]
    fn native_source_kind_is_native() {
        let source = NativeSource;
        assert_eq!(source.kind(), SourceKind::Native);
    }

    #[test]
    fn omp_stats_parser_keeps_only_allowlisted_aggregate_fields() {
        let counters = parse_omp_counters(&json!({
            "byModel": [{
                "provider": "anthropic",
                "model": "claude-sonnet-4",
                "requests": 3,
                "inputTokens": 120,
                "outputTokens": 45,
                "cacheReadTokens": 20,
                "costTotal": 0.12,
                "prompt": "must never survive"
            }]
        }));
        let counter = counters.values().next().expect("aggregate parsed");
        assert_eq!(counter.requests, 3);
        assert_eq!(counter.input_tokens, 120);
        let serialized = serde_json::to_string(counter).unwrap();
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("content"));
    }

    #[test]
    fn omp_stats_preserve_raw_opus_5_identity_for_server_normalization() {
        let counters = parse_omp_counters(&json!({
            "byModel": [{
                "provider": "anthropic",
                "model": "claude-opus-5",
                "totalRequests": 1032,
                "totalInputTokens": 117622,
                "totalOutputTokens": 772282,
                "totalCacheReadTokens": 313831811,
                "totalCacheWriteTokens": 2556036,
                "totalCost": 192.7862905,
            }]
        }));
        let counter = counters
            .get("anthropic\u{1f}claude-opus-5")
            .expect("Opus 5 aggregate must retain its source identity");
        assert_eq!(counter.provider, "anthropic");
        assert_eq!(counter.model, "claude-opus-5");
        assert_eq!(counter.requests, 1032);
        assert_eq!(counter.input_tokens, 117622);
        assert_eq!(counter.output_tokens, 772282);
        assert_eq!(counter.cache_read_tokens, 313831811);
        assert_eq!(counter.cache_write_tokens, 2556036);
        assert_eq!(counter.cost_total, 192.7862905);
    }

    #[test]
    fn native_source_available_is_true() {
        let source = NativeSource;
        assert!(source.available());
    }

    #[test]
    fn omp_delta_rows_are_incremental_and_reset_safe() {
        let previous = parse_omp_counters(&json!({
            "byModel": [{
                "provider": "anthropic",
                "model": "claude-sonnet-4",
                "requests": 10,
                "inputTokens": 1_000,
                "outputTokens": 400,
                "costTotal": 1.0
            }]
        }));
        let current = parse_omp_counters(&json!({
            "byModel": [{
                "provider": "anthropic",
                "model": "claude-sonnet-4",
                "requests": 13,
                "inputTokens": 1_300,
                "outputTokens": 460,
                "costTotal": 1.3
            }]
        }));
        let rows = omp_delta_rows(&previous, &current);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["requests"], 3);
        assert_eq!(rows[0]["inputTokens"], 300);
        assert_eq!(rows[0]["outputTokens"], 60);

        let reset = parse_omp_counters(&json!({
            "byModel": [{
                "provider": "anthropic",
                "model": "claude-sonnet-4",
                "requests": 2,
                "inputTokens": 200,
                "outputTokens": 50,
                "costTotal": 0.2
            }]
        }));
        let reset_rows = omp_delta_rows(&current, &reset);
        assert_eq!(reset_rows[0]["requests"], 2);
        assert_eq!(reset_rows[0]["inputTokens"], 200);
    }

    #[test]
    fn omp_source_diagnostic_does_not_contain_secrets() {
        let source = OmpSource;
        let diag = source.diagnostic();
        assert!(!diag.contains("token"));
        assert!(!diag.contains("key"));
        assert!(!diag.contains("secret"));
    }

    #[test]
    fn native_source_diagnostic_does_not_contain_secrets() {
        let source = NativeSource;
        let diag = source.diagnostic();
        assert!(!diag.contains("token"));
        assert!(!diag.contains("key"));
        assert!(!diag.contains("secret"));
    }
}

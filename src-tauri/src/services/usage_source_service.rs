//! Typed usage-source registry.
//!
//! Each source (OMP, Basebuild Native) is registered with independent
//! availability and checkpoint state. Missing OMP cannot block native
//! usage, and native failures cannot block OMP usage.

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::models::usage_envelope::{clamp_window, normalize_identifier, SourceKind, UsageBatch};
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

    /// Advance the checkpoint after the server acknowledged the batch.
    /// Only called after a successful push.
    fn advance_checkpoint(&self, batch: &UsageBatch) -> Result<(), String>;

    /// Abandon a batch the server (or the local validator) will never accept,
    /// advancing past it so the same poison window is not replayed forever.
    /// Defaults to the accept path, which is correct for cursor-only sources.
    fn discard_batch(&self, batch: &UsageBatch) -> Result<(), String> {
        self.advance_checkpoint(batch)
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
        let requests = row
            .get("requests")
            .or_else(|| row.get("requestCount"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        if requests == 0 {
            continue;
        }
        let counter = OmpCounter {
            provider: provider.clone(),
            model: model.clone(),
            requests,
            input_tokens: nonnegative_i64(row, "inputTokens"),
            output_tokens: nonnegative_i64(row, "outputTokens"),
            cache_read_tokens: nonnegative_i64(row, "cacheReadTokens"),
            cache_write_tokens: nonnegative_i64(row, "cacheWriteTokens"),
            cost_total: row
                .get("costTotal")
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

fn nonnegative_i64(row: &Value, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0).max(0)
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

/// Collect from available sources independently. Signed-in accounts keep OMP
/// on the richer raw-usage path; private installations include OMP in the
/// closed aggregate envelope. A failure in one source does not block others.
pub fn collect_all_sources(include_omp: bool) -> Vec<SourceCollection> {
    let sources = registered_sources();
    let mut results = Vec::new();
    for source in &sources {
        if source.kind() == SourceKind::Omp && !include_omp {
            continue;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

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

//! Local-harness usage readers (Claude Code, Codex CLI, OpenCode).
//!
//! Each reader aggregates local token/model usage into per-(provider, model)
//! summaries. Readers are read-only and never emit message content, prompts,
//! file paths, or credentials — only aggregate counters, model ids, and
//! timestamps. A missing harness is reported as unavailable and never blocks
//! the other sources.
//!
//! Data locations:
//! - Claude Code: `~/.claude/projects/**/*.jsonl` — assistant entries carry
//!   `message.model` and `message.usage` with token totals and a `timestamp`.
//! - Codex CLI: `~/.codex/sessions/**/*.jsonl` — rollout files with
//!   token_count / event payloads containing model + token totals.
//! - OpenCode: `~/.local/share/opencode` — entries with `tokens`,
//!   `modelID`, `providerID`, time fields.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rusqlite::params;
use sha2::{Digest, Sha256};
use serde_json::{json, Value};

use crate::models::usage_envelope::{
    clamp_v2_rows, clamp_window, normalize_identifier, RequestSpanRow, SourceKind, UsageBatch,
    V2Row, V2UsageBatch, MAX_FUTURE_SKEW_SECS, MAX_ROWS_PER_BATCH, MAX_WINDOW_AGE_SECS,
    MAX_WINDOW_SECS,
};
use crate::services::storage_service::StorageService;

/// Maximum lines parsed per collect call — bounds startup cost on large
/// histories. New files beyond this limit are picked up on the next collect
/// after the checkpoint advances.
const MAX_LINES_PER_COLLECT: usize = 200_000;

/// A read-only harness usage reader.
trait HarnessReader: Send + Sync {
    /// Which source kind this reader produces.
    fn kind(&self) -> SourceKind;
    /// Human-readable name for diagnostics.
    fn name(&self) -> &'static str;
    /// Root data directory for this harness on this machine.
    fn data_dir(&self) -> Option<PathBuf>;
    /// Iterate JSONL/JSON entry files with mtime > since_epoch, returning
    /// parsed JSON values (one per entry). Implementations parse leniently
    /// and skip malformed entries.
    fn read_entries(&self, since: i64) -> Vec<Value>;
    /// Whether a readable usage store exists — not merely that the harness
    /// left a directory behind. Reporting a source as available when nothing
    /// in it can ever be read is what made OpenCode sit at "Ready" forever.
    fn has_usage_store(&self) -> bool {
        self.data_dir().is_some_and(|dir| dir.exists())
    }
}

/// Claude Code reader. Provider = "anthropic".
struct ClaudeCodeReader {
    dir: Option<PathBuf>,
}

impl ClaudeCodeReader {
    fn new() -> Self {
        Self {
            dir: home_dir().map(|h| h.join(".claude").join("projects")),
        }
    }
}

impl HarnessReader for ClaudeCodeReader {
    fn kind(&self) -> SourceKind {
        SourceKind::ClaudeCode
    }
    fn name(&self) -> &'static str {
        "claude-code"
    }
    fn data_dir(&self) -> Option<PathBuf> {
        self.dir.clone()
    }
    fn read_entries(&self, since: i64) -> Vec<Value> {
        let Some(root) = &self.dir else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut lines_seen = 0usize;
        walk_jsonl(root, since, &mut |line| {
            if lines_seen >= MAX_LINES_PER_COLLECT {
                return false;
            }
            lines_seen += 1;
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                // Only assistant entries with usage blocks contribute.
                if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                    if v.get("message").and_then(|m| m.get("usage")).is_some() {
                        out.push(v);
                    }
                }
            }
            true
        });
        out
    }
}

/// Codex CLI reader. Provider = "openai".
struct CodexReader {
    dir: Option<PathBuf>,
}

impl CodexReader {
    fn new() -> Self {
        Self {
            dir: home_dir().map(|h| h.join(".codex").join("sessions")),
        }
    }
}

impl CodexReader {
    /// Extract one token-count event from a Codex rollout. Current Codex
    /// versions nest the event under `payload`; older versions wrote the
    /// usage object at the top level. Prefer `last_token_usage` because
    /// `total_token_usage` is cumulative and would double-count when a
    /// session emits more than one event.
    fn extract(row: &Value) -> Option<(String, i64, i64, i64)> {
        let payload = row.get("payload").unwrap_or(row);
        let info = payload
            .get("info")
            .or_else(|| row.get("info"))
            .unwrap_or(payload);
        let usage = info
            .get("last_token_usage")
            .or_else(|| payload.get("last_token_usage"))
            .or_else(|| row.get("last_token_usage"))
            .or_else(|| info.get("total_token_usage"))
            .or_else(|| payload.get("total_token_usage"))
            .or_else(|| row.get("total_token_usage"))?;
        let model = payload
            .get("model")
            .or_else(|| row.get("model"))
            .and_then(|v| v.as_str())
            .unwrap_or("codex-cli")
            .to_string();
        let input = usage
            .get("input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let output = usage
            .get("output_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let ts = row
            .get("timestamp")
            .or_else(|| payload.get("timestamp"))
            .and_then(|v| v.as_str())
            .and_then(parse_iso_to_epoch)
            .unwrap_or(0);
        Some((model, input, output, ts))
    }
}

impl HarnessReader for CodexReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Codex
    }
    fn name(&self) -> &'static str {
        "codex"
    }
    fn data_dir(&self) -> Option<PathBuf> {
        self.dir.clone()
    }
    fn read_entries(&self, since: i64) -> Vec<Value> {
        let Some(root) = &self.dir else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut lines_seen = 0usize;
        walk_jsonl(root, since, &mut |line| {
            if lines_seen >= MAX_LINES_PER_COLLECT {
                return false;
            }
            lines_seen += 1;
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if Self::extract(&v).is_some() {
                    out.push(v);
                }
            }
            true
        });
        out
    }
}

/// OpenCode reader. Provider from `providerID`.
///
/// Current OpenCode keeps messages in `opencode.db`; only pre-SQLite installs
/// use `storage/message/*.json`. Reading just the JSON path meant every
/// modern install reported the source as present and then produced nothing,
/// forever.
struct OpenCodeReader {
    dir: Option<PathBuf>,
}

impl OpenCodeReader {
    fn new() -> Self {
        Self {
            dir: home_dir().map(|h| h.join(".local").join("share").join("opencode")),
        }
    }

    fn database(&self) -> Option<PathBuf> {
        self.dir
            .as_ref()
            .map(|dir| dir.join("opencode.db"))
            .filter(|path| path.exists())
    }

    fn legacy_messages(&self) -> Option<PathBuf> {
        self.dir
            .as_ref()
            .map(|dir| dir.join("storage").join("message"))
            .filter(|path| path.exists())
    }

    /// Pull assistant messages newer than `since` out of `opencode.db`.
    ///
    /// Opened read-only through a URI so a live OpenCode session is never
    /// disturbed, and every failure degrades to "no entries" — a harness we
    /// do not own must never be able to fail our sync.
    fn read_database(path: &Path, since: i64) -> Vec<Value> {
        let uri = format!("file:{}?mode=ro", path.to_string_lossy().replace('?', "%3f"));
        let Ok(conn) = rusqlite::Connection::open_with_flags(
            uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        ) else {
            return Vec::new();
        };
        // `time_created` is epoch milliseconds; the payload lives in `data`.
        let Ok(mut statement) = conn.prepare(
            "SELECT data FROM message
             WHERE time_created > ?1 AND json_extract(data, '$.role') = 'assistant'
             ORDER BY time_created ASC
             LIMIT ?2",
        ) else {
            return Vec::new();
        };
        let rows = statement.query_map(
            params![since.saturating_mul(1000), MAX_LINES_PER_COLLECT as i64],
            |row| row.get::<_, String>(0),
        );
        let Ok(rows) = rows else {
            return Vec::new();
        };
        rows.filter_map(|row| row.ok())
            .filter_map(|data| serde_json::from_str::<Value>(&data).ok())
            .filter(|entry| entry.get("tokens").is_some())
            .collect()
    }
}

impl HarnessReader for OpenCodeReader {
    fn kind(&self) -> SourceKind {
        SourceKind::OpenCode
    }
    fn name(&self) -> &'static str {
        "opencode"
    }
    fn data_dir(&self) -> Option<PathBuf> {
        self.dir.clone()
    }
    fn has_usage_store(&self) -> bool {
        self.database().is_some() || self.legacy_messages().is_some()
    }
    fn read_entries(&self, since: i64) -> Vec<Value> {
        if let Some(database) = self.database() {
            let entries = Self::read_database(&database, since);
            if !entries.is_empty() {
                return entries;
            }
        }
        // Pre-SQLite layout. Scoped to storage/message so the walk never
        // touches auth.json or the session diffs alongside it.
        let Some(msg_root) = self.legacy_messages() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut files_seen = 0usize;
        walk_json_files(&msg_root, since, &mut |text| {
            if files_seen >= MAX_LINES_PER_COLLECT {
                return false;
            }
            files_seen += 1;
            if let Ok(v) = serde_json::from_str::<Value>(text) {
                if v.get("tokens").is_some() {
                    out.push(v);
                }
            }
            true
        });
        out
    }
}

/// A registered harness source wrapping a reader + checkpoint persistence.
pub struct HarnessSource {
    reader: Box<dyn HarnessReader>,
}

impl HarnessSource {
    pub fn claude_code() -> Self {
        Self {
            reader: Box::new(ClaudeCodeReader::new()),
        }
    }
    pub fn codex() -> Self {
        Self {
            reader: Box::new(CodexReader::new()),
        }
    }
    pub fn opencode() -> Self {
        Self {
            reader: Box::new(OpenCodeReader::new()),
        }
    }

    fn checkpoint_key(&self) -> &'static str {
        self.reader.name()
    }

    fn v2_checkpoint_key(&self) -> String {
        format!("{}:v2", self.reader.name())
    }

    fn get_checkpoint(&self) -> i64 {
        let conn = match StorageService::connect() {
            Ok(c) => c,
            Err(_) => return 0,
        };
        let v: Option<i64> = conn
            .query_row(
                "SELECT last_ts FROM harness_sync_checkpoints WHERE source = ?1",
                params![self.checkpoint_key()],
                |r| r.get(0),
            )
            .ok();
        v.unwrap_or(0)
    }

    fn set_checkpoint(&self, ts: i64) -> Result<(), String> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO harness_sync_checkpoints (source, last_ts) VALUES (?1, ?2)
             ON CONFLICT(source) DO UPDATE SET last_ts = excluded.last_ts",
            params![self.checkpoint_key(), ts],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn get_v2_checkpoint(&self) -> i64 {
        let Ok(conn) = StorageService::connect() else {
            return 0;
        };
        conn.query_row(
            "SELECT last_ts FROM harness_sync_checkpoints WHERE source = ?1",
            params![self.v2_checkpoint_key()],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }

    fn set_v2_checkpoint(&self, timestamp: i64) -> Result<(), String> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO harness_sync_checkpoints (source, last_ts) VALUES (?1, ?2)
             ON CONFLICT(source) DO UPDATE SET last_ts = excluded.last_ts",
            params![self.v2_checkpoint_key(), timestamp],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }
}

impl crate::services::usage_source_service::UsageSource for HarnessSource {
    fn kind(&self) -> SourceKind {
        self.reader.kind()
    }

    fn available(&self) -> bool {
        self.reader.has_usage_store()
    }

    fn collect(&self) -> Result<Option<UsageBatch>, String> {
        let since = self.get_checkpoint();
        let entries = self.reader.read_entries(since);
        if entries.is_empty() {
            return Ok(None);
        }
        // `read_entries` filters whole FILES by mtime, so an appended session
        // file re-yields every entry it ever held. `aggregate_entries` bounds
        // by entry timestamp — that is what makes a collect incremental, and
        // what keeps a multi-year backlog draining one acceptable window per
        // pass instead of being crammed into a single mis-stated batch.
        let now = now_seconds();
        let (rows, window_start, window_end) =
            aggregate_entries(self.kind(), &entries, since, now);
        if rows.is_empty() {
            // Everything readable is already synced or predates the server's
            // retention horizon. Bank the horizon so the unreportable tail is
            // never offered again.
            let horizon = now - MAX_WINDOW_AGE_SECS + 60;
            if horizon > since {
                self.set_checkpoint(horizon)?;
            }
            return Ok(None);
        }
        // Belt and braces: the chunk bounds already satisfy the server, but a
        // clock change between collect and transport must not ship a window
        // that can only come back as `invalid_window`.
        let Some((window_start, window_end)) = clamp_window(window_start, window_end, now) else {
            self.set_checkpoint(window_end)?;
            return Ok(None);
        };
        Ok(Some(UsageBatch {
            source: self.kind(),
            idempotency_key: format!(
                "harness:{}:{window_start}:{window_end}:v1",
                self.kind().as_str()
            ),
            window_start,
            window_end,
            rows,
        }))
    }

    fn collect_v2(&self) -> Result<Option<V2UsageBatch>, String> {
        if !matches!(self.kind(), SourceKind::ClaudeCode | SourceKind::Codex) {
            return Ok(None);
        }
        let since = self.get_v2_checkpoint();
        let entries = self.reader.read_entries(since);
        let now = now_seconds();
        let (rows, _, window_end) = request_span_entries(self.kind(), &entries, since, now);
        if rows.is_empty() {
            let horizon = now - MAX_WINDOW_AGE_SECS + 60;
            if horizon > since {
                self.set_v2_checkpoint(horizon)?;
            }
            return Ok(None);
        }
        // The window is derived from the spans themselves so every row falls
        // inside the window its batch declares — the server rejects the batch
        // otherwise.
        let Some((rows, window_start, window_end)) = clamp_v2_rows(rows, now) else {
            self.set_v2_checkpoint(window_end)?;
            return Ok(None);
        };
        let digest =
            Sha256::digest(serde_json::to_vec(&rows).map_err(|error| error.to_string())?);
        Ok(Some(V2UsageBatch {
            source: self.kind(),
            idempotency_key: format!("harness:{}:v2:{digest:x}", self.kind().as_str()),
            window_start,
            window_end,
            rows,
        }))
    }

    fn advance_v2_checkpoint(&self, batch: &V2UsageBatch) -> Result<(), String> {
        self.set_v2_checkpoint(batch.window_end)
    }

    fn advance_checkpoint(&self, batch: &UsageBatch) -> Result<(), String> {
        self.set_checkpoint(batch.window_end)
    }

    fn diagnostic(&self) -> String {
        match self.reader.data_dir() {
            Some(d) => format!("{}: {}", self.reader.name(), d.display()),
            None => format!("{}: no home directory", self.reader.name()),
        }
    }
}

/// Aggregate parsed entries into schema-safe per-(provider, model, hour) rows,
/// bounded to ONE server-acceptable window.
///
/// Entries at or before `since`, older than the server's retention horizon,
/// or beyond its clock-skew tolerance are excluded. The window is then
/// anchored to the OLDEST surviving entry and capped at the maximum span, so
/// the returned counters always match the window they will be reported under
/// and a multi-year backlog drains one chunk per pass. Anchoring to the data
/// rather than to a fixed offset matters: a fixed chunk that happens to
/// contain no entries would never advance.
///
/// Identifiers are normalized to the wire charset and rows are capped at the
/// server's per-batch limit: an entry the schema cannot express is coarsened
/// or dropped, never allowed to fail the batch it rides in.
fn aggregate_entries(
    source: SourceKind,
    entries: &[Value],
    since: i64,
    now: i64,
) -> (Vec<Value>, i64, i64) {
    use std::collections::HashMap;

    #[derive(Default)]
    struct Acc {
        provider: String,
        model: String,
        requests: i64,
        input: i64,
        output: i64,
        cache_read: i64,
        cost: f64,
        ts_min: i64,
        ts_max: i64,
    }

    // Extract once; the chunk bounds are not knowable until the whole set has
    // been scanned for its oldest reportable entry.
    struct Extracted {
        provider: String,
        model: String,
        input: i64,
        output: i64,
        cache_read: i64,
        cost: f64,
        ts: i64,
    }
    let horizon = now - MAX_WINDOW_AGE_SECS + 60;
    let newest_allowed = now + MAX_FUTURE_SKEW_SECS;
    let mut extracted: Vec<Extracted> = Vec::new();
    for entry in entries {
        let (provider, model, input, output, cache_read, cost, ts) = match source {
            SourceKind::ClaudeCode => extract_claude_code(entry),
            SourceKind::Codex => extract_codex(entry),
            SourceKind::OpenCode => extract_opencode(entry),
            _ => continue,
        };
        if model == "unknown" || ts == 0 || ts <= since || ts < horizon || ts > newest_allowed {
            continue;
        }
        // Harness ids are third-party strings (Claude Code writes
        // `<synthetic>`; others use spaces or parentheses). Coerce them into
        // the wire charset and skip only what is unsalvageable.
        let (Some(provider), Some(model)) = (
            normalize_identifier(&provider),
            normalize_identifier(&model),
        ) else {
            continue;
        };
        extracted.push(Extracted {
            provider,
            model,
            input,
            output,
            cache_read,
            cost,
            ts,
        });
    }

    let Some(anchor) = extracted.iter().map(|item| item.ts).min() else {
        return (Vec::new(), 0, 0);
    };
    let ceiling = anchor.saturating_add(MAX_WINDOW_SECS);

    let mut map: HashMap<(String, String, i64), Acc> = HashMap::new();
    for item in extracted.into_iter().filter(|item| item.ts <= ceiling) {
        let hour = item.ts - (item.ts % 3600);
        let acc = map
            .entry((item.provider.clone(), item.model.clone(), hour))
            .or_insert_with(|| Acc {
                provider: item.provider,
                model: item.model,
                ts_min: item.ts,
                ts_max: item.ts,
                ..Default::default()
            });
        acc.requests += 1;
        acc.input += item.input;
        acc.output += item.output;
        acc.cache_read += item.cache_read;
        acc.cost += item.cost;
        acc.ts_min = acc.ts_min.min(item.ts);
        acc.ts_max = acc.ts_max.max(item.ts);
    }

    let window_start = map.values().map(|acc| acc.ts_min).min().unwrap_or(0);
    let window_end = map.values().map(|acc| acc.ts_max).max().unwrap_or(0);

    let mut accs: Vec<Acc> = if map.len() > MAX_ROWS_PER_BATCH {
        // Too many hourly buckets for one batch. Coarsen to per-(provider,
        // model) totals rather than dropping usage — the batch window already
        // carries the time bounds.
        let mut coarse: HashMap<(String, String), Acc> = HashMap::new();
        for acc in map.into_values() {
            let entry = coarse
                .entry((acc.provider.clone(), acc.model.clone()))
                .or_insert_with(|| Acc {
                    provider: acc.provider.clone(),
                    model: acc.model.clone(),
                    ts_min: acc.ts_min,
                    ts_max: acc.ts_max,
                    ..Default::default()
                });
            entry.requests += acc.requests;
            entry.input += acc.input;
            entry.output += acc.output;
            entry.cache_read += acc.cache_read;
            entry.cost += acc.cost;
            entry.ts_min = entry.ts_min.min(acc.ts_min);
            entry.ts_max = entry.ts_max.max(acc.ts_max);
        }
        coarse.into_values().collect()
    } else {
        map.into_values().collect()
    };
    if accs.len() > MAX_ROWS_PER_BATCH {
        // Still over budget (a harness with hundreds of distinct models):
        // keep the heaviest rows, which carry nearly all the signal.
        accs.sort_unstable_by(|a, b| b.requests.cmp(&a.requests).then(a.model.cmp(&b.model)));
        accs.truncate(MAX_ROWS_PER_BATCH);
    }
    // Deterministic order is load-bearing, not cosmetic: the server keys
    // idempotency on a digest of the serialized batch, so a HashMap's
    // arbitrary iteration order made an identical replay look like a
    // different payload and come back as `idempotency_conflict`.
    accs.sort_unstable_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then(a.model.cmp(&b.model))
            .then(a.ts_min.cmp(&b.ts_min))
    });

    let rows = accs
        .into_iter()
        .map(|a| {
            json!({
                "kind": "model_usage",
                "provider": a.provider,
                "model": a.model,
                "requests": a.requests.clamp(1, 1_000_000),
                "inputTokens": a.input.clamp(0, i32::MAX as i64),
                "outputTokens": a.output.clamp(0, i32::MAX as i64),
                "cacheReadTokens": a.cache_read.clamp(0, i32::MAX as i64),
                "cacheWriteTokens": 0,
                "costTotal": if a.cost.is_finite() { a.cost.clamp(0.0, 1_000_000.0) } else { 0.0 },
                "durationMs": 0,
                "durationCount": 0,
                "ttftMs": 0,
                "ttftCount": 0,
                "errors": 0,
            })
        })
        .collect();
    (rows, window_start, window_end)
}

/// Convert Claude Code and Codex file metadata into request spans. The helper
/// only accesses ids, model, token counters, timestamps, and outcome flags.
fn request_span_entries(
    source: SourceKind,
    entries: &[Value],
    since: i64,
    now: i64,
) -> (Vec<V2Row>, i64, i64) {
    let horizon = now - MAX_WINDOW_AGE_SECS + 60;
    let newest = now + MAX_FUTURE_SKEW_SECS;
    let mut metadata = entries
        .iter()
        .filter_map(|entry| {
            let (provider, model, input, output, cache_read, _, timestamp) = match source {
                SourceKind::ClaudeCode => extract_claude_code(entry),
                SourceKind::Codex => extract_codex(entry),
                _ => return None,
            };
            if timestamp <= since || timestamp < horizon || timestamp > newest {
                return None;
            }
            Some((entry, provider, model, input, output, cache_read, timestamp))
        })
        .collect::<Vec<_>>();
    metadata.sort_by_key(|item| item.6);
    let Some(first_timestamp) = metadata.first().map(|item| item.6) else {
        return (Vec::new(), since.max(horizon), since.max(horizon));
    };
    let chunk_end = first_timestamp.saturating_add(MAX_WINDOW_SECS).min(newest);
    let mut rows = Vec::new();
    let mut window_end = first_timestamp;
    for (entry, provider, model, input, output, cache_read, timestamp) in metadata {
        if timestamp > chunk_end || rows.len() >= MAX_ROWS_PER_BATCH {
            break;
        }
        let (Some(provider), Some(model)) = (
            normalize_identifier(&provider),
            normalize_identifier(&model),
        ) else {
            continue;
        };
        let raw_session = entry
            .get("sessionId")
            .or_else(|| entry.get("session_id"))
            .or_else(|| entry.get("conversation_id"))
            .or_else(|| entry.get("payload").and_then(|value| value.get("session_id")))
            .and_then(Value::as_str)
            .unwrap_or("unknown-session");
        let session_id =
            normalize_identifier(raw_session).unwrap_or_else(|| "unknown-session".to_string());
        let raw_identity = entry
            .get("uuid")
            .or_else(|| entry.get("id"))
            .or_else(|| entry.get("request_id"))
            .or_else(|| entry.get("payload").and_then(|value| value.get("id")))
            .and_then(Value::as_str)
            .unwrap_or("");
        let identity = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            source.as_str(),
            raw_identity,
            session_id,
            model,
            timestamp,
            input,
            output
        );
        let event_digest = Sha256::digest(identity.as_bytes());
        let event_id = format!("{}:{event_digest:x}", source.as_str());
        let agent_id = entry
            .get("agentId")
            .and_then(Value::as_str)
            .and_then(normalize_identifier);
        let provider_request_id = entry
            .get("request_id")
            .or_else(|| entry.get("requestId"))
            .and_then(Value::as_str)
            .and_then(normalize_identifier);
        let interrupted = entry
            .get("interrupted")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let errored = entry
            .get("is_error")
            .or_else(|| entry.get("isError"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || entry.get("error").is_some();
        let outcome = if interrupted {
            "cancelled"
        } else if errored {
            "error"
        } else {
            "success"
        };
        let cache_write = entry
            .get("message")
            .and_then(|message| message.get("usage"))
            .and_then(|usage| usage.get("cache_creation_input_tokens"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let timestamp_ms = timestamp.saturating_mul(1000);
        rows.push(V2Row::RequestSpan(RequestSpanRow {
            event_id,
            provider,
            account_hash: None,
            model,
            session_id,
            agent_id,
            provider_request_id,
            started_at: timestamp_ms,
            completed_at: timestamp_ms,
            input_tokens: Some(input.clamp(0, i32::MAX as i64)),
            output_tokens: Some(output.clamp(0, i32::MAX as i64)),
            cache_read_tokens: Some(cache_read.clamp(0, i32::MAX as i64)),
            cache_write_tokens: Some(cache_write.clamp(0, i32::MAX as i64)),
            cost_total: None,
            ttft_ms: None,
            effort: None,
            outcome: outcome.to_string(),
        }));
        window_end = window_end.max(timestamp);
    }
    rows.sort_by(|left, right| {
        let left_id = match left {
            V2Row::RequestSpan(row) => row.event_id.as_str(),
            _ => "",
        };
        let right_id = match right {
            V2Row::RequestSpan(row) => row.event_id.as_str(),
            _ => "",
        };
        left_id.cmp(right_id)
    });
    (rows, first_timestamp, window_end)
}

/// Harness timestamps arrive in seconds or milliseconds depending on the
/// tool. Anything past year 5138 in seconds is milliseconds.
fn normalize_epoch_seconds(value: i64) -> i64 {
    if value > 100_000_000_000 {
        value / 1000
    } else {
        value
    }
}

/// Current time in epoch seconds.
fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

/// Claude Code: assistant entries with `message.model` + `message.usage`.
fn extract_claude_code(entry: &Value) -> (String, String, i64, i64, i64, f64, i64) {
    let model = entry
        .get("message")
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let usage = entry.get("message").and_then(|m| m.get("usage"));
    let input = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let output = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let cache_read = usage
        .and_then(|u| u.get("cache_read_input_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let ts = entry
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(parse_iso_to_epoch)
        .unwrap_or(0);
    (
        "anthropic".to_string(),
        model,
        input,
        output,
        cache_read,
        0.0,
        ts,
    )
}

/// Codex CLI: entries with token_count / model fields.
fn extract_codex(entry: &Value) -> (String, String, i64, i64, i64, f64, i64) {
    let (model, input, output, ts) =
        CodexReader::extract(entry).unwrap_or(("unknown".into(), 0, 0, 0));
    ("openai".to_string(), model, input, output, 0, 0.0, ts)
}

/// OpenCode: entries with `tokens` + `modelID` + `providerID`.
fn extract_opencode(entry: &Value) -> (String, String, i64, i64, i64, f64, i64) {
    let provider = entry
        .get("providerID")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let model = entry
        .get("modelID")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let tokens = entry.get("tokens");
    let input = tokens
        .and_then(|t| t.get("input"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let output = tokens
        .and_then(|t| t.get("output"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    // `cache` is an object (`{read, write}`) in the SQLite layout and a plain
    // number in the oldest JSON one. Reading only the number shape silently
    // zeroed cache hits, which for a heavy user is most of the token volume.
    let cache = tokens.and_then(|t| t.get("cache"));
    let cache_read = cache
        .and_then(|c| c.get("read").and_then(Value::as_i64).or_else(|| c.as_i64()))
        .unwrap_or(0);
    let cost = entry
        .get("cost")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(0.0);
    // `time.created` in the SQLite layout, flat `createdAt` in the JSON one.
    // Both are milliseconds; older builds used seconds.
    let ts = entry
        .get("time")
        .and_then(|t| t.get("created"))
        .and_then(Value::as_i64)
        .or_else(|| entry.get("createdAt").and_then(Value::as_i64))
        .or_else(|| entry.get("completedAt").and_then(Value::as_i64))
        .map(normalize_epoch_seconds)
        .unwrap_or(0);
    (provider, model, input, output, cache_read, cost, ts)
}

/// Resolve the user's home directory.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Recursively walk `root` for `.jsonl` files with mtime > since, calling
/// `handler` for each line. Stops early when the handler returns false.
fn walk_jsonl(root: &Path, since: i64, handler: &mut impl FnMut(&str) -> bool) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_jsonl(&path, since, handler);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if !file_is_fresh(&path, since) {
                continue;
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            for line in text.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if !handler(line) {
                    return;
                }
            }
        }
    }
}

/// Recursively walk `root` for `.json` files with mtime > since.
fn walk_json_files(root: &Path, since: i64, handler: &mut impl FnMut(&str) -> bool) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_json_files(&path, since, handler);
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if !file_is_fresh(&path, since) {
                continue;
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if !handler(&text) {
                return;
            }
        }
    }
}

fn file_is_fresh(path: &Path, since_epoch: i64) -> bool {
    if since_epoch == 0 {
        return true;
    }
    let mtime = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    mtime >= since_epoch
}

/// Parse an ISO-8601 timestamp to epoch seconds. Lenient — returns None on
/// any parse failure.
pub(crate) fn parse_iso_to_epoch(s: &str) -> Option<i64> {
    // Trim subsecond + timezone to a coarse epoch. We only need hour-bucket
    // granularity, so a 1-second approximation is fine.
    // Accept shapes like 2026-07-18T12:34:56.789Z or 2026-07-18T12:34:56Z.
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let date = &s[..10];
    let time = &s[11..19];
    let dparts: Vec<&str> = date.split('-').collect();
    let tparts: Vec<&str> = time.split(':').collect();
    if dparts.len() != 3 || tparts.len() != 3 {
        return None;
    }
    let (y, mo, d) = (
        dparts[0].parse::<i64>().ok()?,
        dparts[1].parse::<i64>().ok()?,
        dparts[2].parse::<i64>().ok()?,
    );
    let (h, mi, se) = (
        tparts[0].parse::<i64>().ok()?,
        tparts[1].parse::<i64>().ok()?,
        tparts[2].parse::<i64>().ok()?,
    );
    Some(epoch_from_ymd_hms(y, mo, d, h, mi, se))
}

/// Convert UTC Y/M/D H:M:S to epoch seconds. Uses the civil-from-days
/// algorithm (Howard Hinnant). Good for 1970 onward.
fn epoch_from_ymd_hms(y: i64, mo: i64, d: i64, h: i64, mi: i64, se: i64) -> i64 {
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    days * 86400 + h * 3600 + mi * 60 + se
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::usage_source_service::UsageSource;

    /// "Now" for fixtures dated 2026-07-18, so their entries sit inside the
    /// server's 90-day retention horizon.
    const FIXTURE_NOW: i64 = 1_784_381_696;

    #[test]
    fn claude_code_extract_happy_path() {
        let entry = json!({
            "type": "assistant",
            "message": {
                "model": "claude-sonnet-4",
                "usage": {
                    "input_tokens": 1200,
                    "output_tokens": 340,
                    "cache_read_input_tokens": 800
                }
            },
            "timestamp": "2026-07-18T12:34:56.789Z"
        });
        let (provider, model, input, output, cache, _cost, ts) = extract_claude_code(&entry);
        assert_eq!(provider, "anthropic");
        assert_eq!(model, "claude-sonnet-4");
        assert_eq!(input, 1200);
        assert_eq!(output, 340);
        assert_eq!(cache, 800);
        assert!(ts > 0);
    }

    #[test]
    fn claude_code_skips_malformed_line() {
        let entry = json!({"type": "user", "message": {"content": "hi"}});
        let (_p, model, _i, _o, _c, _cost, ts) = extract_claude_code(&entry);
        assert_eq!(model, "unknown");
        assert_eq!(ts, 0);
    }

    #[test]
    fn codex_extracts_nested_token_count_without_double_counting() {
        let entry = json!({
            "timestamp": "2026-07-18T12:34:56.789Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 9000,
                        "output_tokens": 1200
                    },
                    "last_token_usage": {
                        "input_tokens": 700,
                        "output_tokens": 90
                    }
                }
            }
        });

        let (model, input, output, ts) = CodexReader::extract(&entry).unwrap();
        assert_eq!(model, "codex-cli");
        assert_eq!(input, 700);
        assert_eq!(output, 90);
        assert!(ts > 0);
    }

    #[test]
    fn aggregate_never_emits_content_fields() {
        let entry = json!({
            "type": "assistant",
            "message": {
                "model": "claude-sonnet-4",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "content": "SECRET PROMPT TEXT"
            },
            "timestamp": "2026-07-18T12:34:56Z"
        });
        let (rows, window_start, window_end) =
            aggregate_entries(SourceKind::ClaudeCode, &[entry], 0, FIXTURE_NOW);
        assert_eq!(rows.len(), 1);
        assert!(window_start > 0);
        assert!(window_end > 0);
        let row = &rows[0];
        // Only closed aggregate fields are emitted.
        assert!(row.get("content").is_none());
        assert!(row.get("prompt").is_none());
        assert!(row.get("message").is_none());
        assert!(row.get("model").is_some());
        assert!(row.get("inputTokens").is_some());
    }

    #[test]
    fn synthetic_model_ids_are_normalized_not_dropped_onto_the_wire() {
        // Claude Code writes `<synthetic>` for internally generated turns.
        // Emitting it verbatim failed local envelope validation, which took
        // down every other source with it — sync never succeeded again.
        let entries = vec![
            json!({
                "message": {"model": "<synthetic>", "usage": {"input_tokens": 10, "output_tokens": 5}},
                "timestamp": "2026-07-18T12:34:56Z"
            }),
            json!({
                "message": {"model": "claude-opus-4-8", "usage": {"input_tokens": 20, "output_tokens": 7}},
                "timestamp": "2026-07-18T12:34:57Z"
            }),
        ];
        let (rows, _start, _end) =
            aggregate_entries(SourceKind::ClaudeCode, &entries, 0, FIXTURE_NOW);
        assert_eq!(rows.len(), 2);
        for row in &rows {
            crate::models::usage_envelope::validate_row(row)
                .expect("every harness row must be shippable");
        }
        let models: Vec<&str> = rows
            .iter()
            .filter_map(|row| row.get("model").and_then(|m| m.as_str()))
            .collect();
        assert!(models.contains(&"synthetic"), "got {models:?}");
        assert!(models.contains(&"claude-opus-4-8"), "got {models:?}");
    }

    #[test]
    fn aggregation_is_incremental_and_byte_stable() {
        // Two independent failures the server surfaced as `idempotency_conflict`:
        // re-reading an appended file re-emitted the whole history, and HashMap
        // iteration order made an identical replay serialize differently, so the
        // digest never matched the receipt already on file.
        let base = 1_784_000_000i64;
        let entries: Vec<Value> = ["alpha-1", "beta-2", "gamma-3", "delta-4"]
            .iter()
            .enumerate()
            .map(|(i, model)| {
                json!({
                    "providerID": "anthropic",
                    "modelID": model,
                    "tokens": {"input": 1, "output": 1},
                    "createdAt": base + i as i64 * 7200
                })
            })
            .collect();

        let now = base + 86_400;
        let (first, _s, first_end) = aggregate_entries(SourceKind::OpenCode, &entries, 0, now);
        let (again, _s, _e) = aggregate_entries(SourceKind::OpenCode, &entries, 0, now);
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&again).unwrap(),
            "identical input must serialize identically or the server sees a conflict"
        );

        // A second pass after the checkpoint has nothing left to send.
        let (drained, _s, _e) =
            aggregate_entries(SourceKind::OpenCode, &entries, first_end, now);
        assert!(drained.is_empty(), "already-synced entries must not re-send");

        // …but a newly appended entry does.
        let mut appended = entries.clone();
        appended.push(json!({
            "providerID": "anthropic",
            "modelID": "epsilon-5",
            "tokens": {"input": 1, "output": 1},
            "createdAt": first_end + 3600
        }));
        let (fresh, _s, _e) =
            aggregate_entries(SourceKind::OpenCode, &appended, first_end, first_end + 7200);
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0]["model"], "epsilon-5");
    }

    #[test]
    fn aggregate_stays_within_the_server_row_budget() {
        // A long harness history produces one bucket per (model, hour); the
        // server refuses a batch over 500 rows, so aggregation must coarsen
        // rather than emit a batch that can only be rejected. 600 hourly
        // buckets clear the cap while still fitting the 31-day window, so
        // this exercises coarsening and not the chunk boundary.
        let count = MAX_ROWS_PER_BATCH as i64 + 100;
        let base = 1_784_000_000i64;
        let entries: Vec<Value> = (0..count)
            .map(|i| {
                json!({
                    "providerID": "anthropic",
                    "modelID": "claude-sonnet-4",
                    "tokens": {"input": 1, "output": 1},
                    "createdAt": base + i * 3600
                })
            })
            .collect();
        let (rows, _start, _end) =
            aggregate_entries(SourceKind::OpenCode, &entries, 0, base + count * 3600);
        assert!(rows.len() <= MAX_ROWS_PER_BATCH, "got {} rows", rows.len());
        // Coarsening preserves the totals rather than discarding usage.
        let requests: i64 = rows
            .iter()
            .filter_map(|row| row.get("requests").and_then(Value::as_i64))
            .sum();
        assert_eq!(requests, count);
    }

    #[test]
    fn opencode_millisecond_timestamps_are_read_as_seconds() {
        // OpenCode records `createdAt` in milliseconds; taking it verbatim
        // put every row ~53,000 years in the future, past the server's skew
        // tolerance, so the batch could never be accepted.
        let entry = json!({
            "providerID": "anthropic",
            "modelID": "claude-sonnet-4",
            "tokens": {"input": 1, "output": 1},
            "createdAt": 1_784_378_096_000i64
        });
        let (_p, _m, _i, _o, _c, _cost, ts) = extract_opencode(&entry);
        assert_eq!(ts, 1_784_378_096);
    }

    #[test]
    fn opencode_sqlite_message_shape_is_read_in_full() {
        // The shape OpenCode actually stores in `opencode.db`: nested
        // `time.created` (ms), nested `tokens.cache.read`, and a `cost`.
        // Reading only the flat/legacy shape zeroed cache hits and cost —
        // for a heavy user, most of the token volume.
        let entry = json!({
            "role": "assistant",
            "providerID": "deepseek",
            "modelID": "deepseek-v4-pro",
            "tokens": {
                "total": 12509, "input": 79, "output": 25, "reasoning": 117,
                "cache": {"write": 0, "read": 12288}
            },
            "cost": 0.00241338,
            "time": {"created": 1_777_462_677_194i64, "completed": 1_777_462_685_560i64}
        });
        let (provider, model, input, output, cache, cost, ts) = extract_opencode(&entry);
        assert_eq!(provider, "deepseek");
        assert_eq!(model, "deepseek-v4-pro");
        assert_eq!(input, 79);
        assert_eq!(output, 25);
        assert_eq!(cache, 12288);
        assert!((cost - 0.00241338).abs() < f64::EPSILON);
        assert_eq!(ts, 1_777_462_677);
    }

    #[test]
    fn aggregation_reports_only_the_window_it_claims_and_drains_the_backlog() {
        // A first-ever collect can span years. Counters must match the window
        // they ride in — aggregating everything and clamping the window
        // afterwards would report years of usage as one 31-day batch — and
        // the chunk must anchor to the DATA, or a gap stalls it forever.
        let now = 1_784_000_000i64;
        let entry = |offset_days: i64| {
            json!({
                "providerID": "anthropic",
                "modelID": "claude-sonnet-4",
                "tokens": {"input": 1, "output": 1},
                "createdAt": now - offset_days * 86_400
            })
        };
        // 200d and 120d are past the 90-day horizon and unreportable. 80d
        // anchors the first chunk; 60d rides with it (20 days later); 20d and
        // 1d are beyond that chunk's 31-day span and follow on later passes.
        let entries = vec![
            entry(200),
            entry(120),
            entry(80),
            entry(60),
            entry(20),
            entry(1),
        ];

        let (rows, window_start, window_end) =
            aggregate_entries(SourceKind::OpenCode, &entries, 0, now);
        let counted = |rows: &[Value]| -> i64 {
            rows.iter()
                .filter_map(|row| row.get("requests").and_then(Value::as_i64))
                .sum()
        };
        assert_eq!(counted(&rows), 2, "only in-window entries may be counted");
        assert_eq!(window_start, now - 80 * 86_400);
        assert_eq!(window_end, now - 60 * 86_400);
        assert!(window_end - window_start <= MAX_WINDOW_SECS);

        // The next pass resumes from the accepted cursor and drains the rest,
        // rather than dropping it or re-offering the same window.
        let (rest, rest_start, rest_end) =
            aggregate_entries(SourceKind::OpenCode, &entries, window_end, now);
        assert_eq!(counted(&rest), 2, "the remaining entries must follow");
        assert_eq!(rest_start, now - 20 * 86_400);
        assert_eq!(rest_end, now - 86_400);

        // And once drained, nothing is left owing.
        let (done, _s, _e) = aggregate_entries(SourceKind::OpenCode, &entries, rest_end, now);
        assert!(done.is_empty(), "a drained backlog must stay drained");
    }

    #[test]
    fn opencode_extract_happy_path() {
        let entry = json!({
            "providerID": "anthropic",
            "modelID": "claude-sonnet-4",
            "tokens": {"input": 500, "output": 200, "cache": 100},
            "createdAt": 1752850496
        });
        let (provider, model, input, output, cache, _cost, ts) = extract_opencode(&entry);
        assert_eq!(provider, "anthropic");
        assert_eq!(model, "claude-sonnet-4");
        assert_eq!(input, 500);
        assert_eq!(output, 200);
        assert_eq!(cache, 100);
        assert_eq!(ts, 1752850496);
    }

    #[test]
    fn parse_iso_to_epoch_valid() {
        assert_eq!(parse_iso_to_epoch("2026-07-18T12:34:56Z"), Some(1784378096));
        assert_eq!(
            parse_iso_to_epoch("2026-07-18T12:34:56.789Z"),
            Some(1784378096)
        );
        assert!(parse_iso_to_epoch("not-a-date").is_none());
    }

    #[test]
    fn harness_source_available_when_dir_missing() {
        // Pointing at a nonexistent dir — available() must be false, not panic.
        let source = HarnessSource::claude_code();
        // The actual ~/.claude/projects may or may not exist on the test
        // machine; either way available() must not panic.
        let _ = source.available();
    }
    #[test]
    fn claude_file_source_collects_v2_spans_without_message_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let root = dir.path().join("claude-projects");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("session.jsonl"),
            json!({
                "type": "assistant",
                "uuid": "entry-1",
                "sessionId": "session-1",
                "message": {
                    "model": "claude-sonnet-4",
                    "usage": {
                        "input_tokens": 120,
                        "output_tokens": 30,
                        "cache_read_input_tokens": 40,
                        "cache_creation_input_tokens": 5
                    },
                    "content": "private response body"
                },
                "timestamp": "2026-07-27T00:00:00Z"
            })
            .to_string(),
        )
        .unwrap();
        let source = HarnessSource {
            reader: Box::new(ClaudeCodeReader { dir: Some(root) }),
        };
        let batch = source.collect_v2().unwrap().expect("v2 harness batch");
        assert_eq!(batch.source, SourceKind::ClaudeCode);
        assert_eq!(batch.rows.len(), 1);
        crate::models::usage_envelope::validate_v2_row(&batch.rows[0]).unwrap();
        let value = serde_json::to_value(&batch.rows[0]).unwrap();
        for forbidden in ["message", "content", "text", "prompt", "response"] {
            assert!(value.get(forbidden).is_none());
        }
    }
}

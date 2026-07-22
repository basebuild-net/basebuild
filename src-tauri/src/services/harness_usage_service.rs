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
use serde_json::{json, Value};

use crate::models::usage_envelope::{SourceKind, UsageBatch};
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
    /// Extract token totals from a Codex entry. Codex rollout files vary in
    /// shape; we look for the common `info`/`total_token_usage`/`last_token_usage`
    /// objects with `input_tokens`/`output_tokens` and a `model` field.
    fn extract(row: &Value) -> Option<(String, i64, i64, i64)> {
        let model = row
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        // Try a few known shapes.
        let (input, output) = row
            .get("info")
            .and_then(|i| i.get("total_token_usage"))
            .or_else(|| row.get("total_token_usage"))
            .or_else(|| row.get("last_token_usage"))
            .and_then(|u| {
                Some((
                    u.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
                    u.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
                ))
            })
            .unwrap_or((0, 0));
        let ts = row
            .get("timestamp")
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
struct OpenCodeReader {
    dir: Option<PathBuf>,
}

impl OpenCodeReader {
    fn new() -> Self {
        Self {
            dir: home_dir().map(|h| h.join(".local").join("share").join("opencode")),
        }
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
    fn read_entries(&self, since: i64) -> Vec<Value> {
        let Some(root) = &self.dir else {
            return Vec::new();
        };
        // OpenCode stores message entries as JSON files under storage/message.
        let msg_root = root.join("storage").join("message");
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
}

impl crate::services::usage_source_service::UsageSource for HarnessSource {
    fn kind(&self) -> SourceKind {
        self.reader.kind()
    }

    fn available(&self) -> bool {
        self.reader.data_dir().map(|d| d.exists()).unwrap_or(false)
    }

    fn collect(&self) -> Result<Option<UsageBatch>, String> {
        let since = self.get_checkpoint();
        let entries = self.reader.read_entries(since);
        if entries.is_empty() {
            return Ok(None);
        }
        let (rows, window_end) = aggregate_entries(self.kind(), &entries);
        if rows.is_empty() {
            return Ok(None);
        }
        Ok(Some(UsageBatch {
            source: self.kind(),
            idempotency_key: format!("harness:{}:{since}:{window_end}:v1", self.kind().as_str()),
            window_start: since,
            window_end,
            rows,
        }))
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

/// Aggregate parsed entries into schema-safe per-(provider, model, hour) rows.
fn aggregate_entries(source: SourceKind, entries: &[Value]) -> (Vec<Value>, i64) {
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
        ts_max: i64,
    }

    let mut map: HashMap<(String, String, i64), Acc> = HashMap::new();
    for entry in entries {
        let (provider, model, input, output, cache_read, cost, ts) = match source {
            SourceKind::ClaudeCode => extract_claude_code(entry),
            SourceKind::Codex => extract_codex(entry),
            SourceKind::OpenCode => extract_opencode(entry),
            _ => continue,
        };
        if model == "unknown" || ts == 0 {
            continue;
        }
        let hour = ts - (ts % 3600);
        let acc = map
            .entry((provider.clone(), model.clone(), hour))
            .or_insert_with(|| Acc {
                provider: provider.clone(),
                model: model.clone(),
                ..Default::default()
            });
        acc.requests += 1;
        acc.input += input;
        acc.output += output;
        acc.cache_read += cache_read;
        acc.cost += cost;
        acc.ts_max = acc.ts_max.max(ts);
    }

    let window_end = map.values().map(|acc| acc.ts_max).max().unwrap_or(0);
    let rows = map
        .into_values()
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
    (rows, window_end)
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
    let cache_read = tokens
        .and_then(|t| t.get("cache"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let ts = entry
        .get("createdAt")
        .and_then(|v| v.as_i64())
        .or_else(|| entry.get("completedAt").and_then(|v| v.as_i64()))
        .unwrap_or(0);
    (provider, model, input, output, cache_read, 0.0, ts)
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
fn parse_iso_to_epoch(s: &str) -> Option<i64> {
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
        let (rows, window_end) = aggregate_entries(SourceKind::ClaudeCode, &[entry]);
        assert_eq!(rows.len(), 1);
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
}

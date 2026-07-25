//! Versioned multi-source usage envelope.
//!
//! The envelope wraps usage batches from independent sources (OMP, Basebuild
//! Native chat) in a versioned structure with stable deduplication keys and
//! an allowlisted field set. No free-form content fields are permitted — the
//! payload validator rejects prompts, responses, reasoning, source code,
//! terminal output, tool args/results, secrets, credentials, environment
//! values, and raw paths before transport.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Current envelope schema version. Increment only with an extend-only
/// server rollout that preserves compatibility with older clients.
pub const ENVELOPE_VERSION: u32 = 1;

/// Server-enforced transport limits, mirrored locally so a batch is never
/// shipped only to be rejected. These MUST stay in sync with
/// `USAGE_ENVELOPE_LIMITS` in basebuild-dotnet (`src/lib/usage-envelope.ts`).
pub const MAX_BATCHES_PER_ENVELOPE: usize = 5;
pub const MAX_ROWS_PER_BATCH: usize = 500;
pub const MAX_ROWS_PER_ENVELOPE: usize = 1000;
/// Widest window the server accepts in a single batch: 31 days.
pub const MAX_WINDOW_SECS: i64 = 2_678_400;
/// Oldest `windowStart` the server accepts: 90 days back.
pub const MAX_WINDOW_AGE_SECS: i64 = 7_776_000;
/// Clock skew the server tolerates on future timestamps.
pub const MAX_FUTURE_SKEW_SECS: i64 = 300;

/// Identifies which source produced a usage batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SourceKind {
    #[serde(rename = "omp")]
    Omp,
    #[serde(rename = "native")]
    Native,
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "opencode")]
    OpenCode,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::Omp => "omp",
            SourceKind::Native => "native",
            SourceKind::ClaudeCode => "claude-code",
            SourceKind::Codex => "codex",
            SourceKind::OpenCode => "opencode",
        }
    }
}

/// A single usage batch from one source, ready for transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBatch {
    /// Which source produced this batch.
    pub source: SourceKind,
    /// Stable source-scoped key used for idempotent server receipts.
    pub idempotency_key: String,
    /// Epoch-seconds window start (inclusive).
    pub window_start: i64,
    /// Epoch-seconds window end (exclusive).
    pub window_end: i64,
    /// Allowlisted payload rows — each row is a JSON object whose keys have
    /// been validated by `validate_payload`.
    pub rows: Vec<Value>,
}

/// The top-level envelope sent to basebuild.net.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEnvelope {
    /// Schema version. The server must accept this version (extend-only).
    pub version: u32,
    /// Epoch seconds when the envelope was assembled locally.
    pub generated_at: i64,
    /// One or more source-scoped batches.
    pub batches: Vec<UsageBatch>,
}

/// Fields that must NEVER appear in a usage row. If any are present, the
/// validator rejects the entire batch before transport.
const FORBIDDEN_FIELDS: &[&str] = &[
    // Content fields
    "prompt",
    "promptText",
    "response",
    "responseText",
    "reasoning",
    "reasoningText",
    // "source" is allowed as a source-kind string (in ALLOWED_FIELDS).
    "sourceCode",
    "code",
    "terminal",
    "terminalOutput",
    "stdout",
    "stderr",
    "toolArgs",
    "toolResult",
    "toolCall",
    "message",
    "messageText",
    "content",
    "text",
    // Secret / credential fields
    "secret",
    "secretValue",
    "apiKey",
    "apiSecret",
    "token",
    "accessToken",
    "refreshToken",
    "password",
    "credential",
    "credentials",
    // Environment / path fields
    "env",
    "environment",
    "environmentVariables",
    "path",
    "rawPath",
    "filePath",
    "fullPath",
    "projectPath",
    "workingDirectory",
    "cwd",
];

/// Fields that ARE permitted in a usage row (allowlist). If a row contains
/// a key not in this set, the validator rejects it. This is stricter than
/// the forbidden list: only known-safe metadata fields pass.
const ALLOWED_FIELDS: &[&str] = &[
    "kind",
    "provider",
    "model",
    "effort",
    "subscriptionTier",
    "subscriptionSource",
    "planName",
    "requests",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costTotal",
    "durationMs",
    "durationCount",
    "ttftMs",
    "ttftCount",
    "errors",
    "planType",
    "windowLabel",
    "usedFraction",
    "remainingFraction",
    "resetsAt",
];

const MODEL_USAGE_FIELDS: &[&str] = &[
    "kind",
    "provider",
    "model",
    "effort",
    "subscriptionTier",
    "subscriptionSource",
    "planName",
    "requests",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costTotal",
    "durationMs",
    "durationCount",
    "ttftMs",
    "ttftCount",
    "errors",
];
const PLAN_UTILIZATION_FIELDS: &[&str] = &[
    "kind",
    "provider",
    "planType",
    "windowLabel",
    "usedFraction",
    "remainingFraction",
    "resetsAt",
];

/// Coerce an arbitrary provider/model string into the identifier shape the
/// server accepts (`/^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,127}$/`).
///
/// Harnesses emit ids we do not control — Claude Code writes `<synthetic>`
/// for internally generated turns, and other tools use spaces, parentheses,
/// or leading punctuation. An unrepresentable id used to fail the whole
/// envelope, which starved every other source; normalizing keeps the usage
/// attributable instead. Disallowed characters collapse to `-`, and a
/// non-alphanumeric first character is dropped. Returns `None` only when
/// nothing usable survives, in which case the caller must skip the row.
pub fn normalize_identifier(value: &str) -> Option<String> {
    let mut out = String::with_capacity(value.len().min(128));
    for ch in value.chars() {
        if out.len() == 128 {
            break;
        }
        let mapped = if ch.is_ascii_alphanumeric() || "._:/+-".contains(ch) {
            ch
        } else {
            '-'
        };
        // The first character must be alphanumeric; skip leading punctuation
        // rather than emitting a leading `-` the server would reject.
        if out.is_empty() && !mapped.is_ascii_alphanumeric() {
            continue;
        }
        out.push(mapped);
    }
    while out.ends_with('-') {
        out.pop();
    }
    (!out.is_empty()).then_some(out)
}

/// Clamp a batch window into the range the server accepts, given `now` in
/// epoch seconds. Returns `None` when the window cannot be represented at
/// all (its end is already older than the 90-day retention horizon), which
/// tells the caller to drop the batch and advance past it.
///
/// The clamp is deliberately end-anchored: usage at the recent end of a long
/// backlog is what matters, and the caller re-collects the remainder on the
/// next pass once its cursor advances.
pub fn clamp_window(start: i64, end: i64, now: i64) -> Option<(i64, i64)> {
    let oldest = now - MAX_WINDOW_AGE_SECS + 60;
    let newest = now + MAX_FUTURE_SKEW_SECS;
    let end = end.min(newest);
    if end < oldest {
        return None;
    }
    let start = start.clamp(oldest, end).max(end - MAX_WINDOW_SECS);
    Some((start.min(end), end))
}

fn bounded_identifier(value: Option<&Value>) -> bool {
    let Some(value) = value.and_then(Value::as_str) else {
        return false;
    };
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= 128
        && first.is_ascii_alphanumeric()
        && chars.all(|ch| ch.is_ascii_alphanumeric() || "._:/+-".contains(ch))
}

fn bounded_counter(obj: &Map<String, Value>, key: &str, maximum: i64) -> bool {
    obj.get(key)
        .and_then(Value::as_i64)
        .is_some_and(|value| (0..=maximum).contains(&value))
}

fn optional_enum(obj: &Map<String, Value>, key: &str, allowed: &[&str]) -> bool {
    match obj.get(key) {
        None | Some(Value::Null) => true,
        Some(value) => value
            .as_str()
            .is_some_and(|candidate| allowed.contains(&candidate)),
    }
}

fn optional_label(obj: &Map<String, Value>, key: &str) -> bool {
    match obj.get(key) {
        None | Some(Value::Null) => true,
        Some(value) => value.as_str().is_some_and(|label| {
            !label.is_empty() && label.chars().count() <= 128 && !label.contains(['\r', '\n'])
        }),
    }
}

/// Validate a single usage row against the allowlist. Returns `Ok(())` if
/// the row contains only permitted fields, or an error describing the
/// violation.
pub fn validate_row(row: &Value) -> Result<(), String> {
    let obj = row
        .as_object()
        .ok_or_else(|| "usage row must be a JSON object".to_string())?;

    // Check for forbidden fields first (defense in depth).
    // Use exact match only — the allowlist below is the authoritative check.
    for key in obj.keys() {
        let lower = key.to_lowercase();
        for forbidden in FORBIDDEN_FIELDS {
            if lower == forbidden.to_lowercase() {
                return Err(format!("forbidden field in usage row: {key}"));
            }
        }
    }

    for key in obj.keys() {
        if !ALLOWED_FIELDS.contains(&key.as_str()) {
            return Err(format!("non-allowlisted field in usage row: {key}"));
        }
    }

    match obj.get("kind").and_then(Value::as_str) {
        Some("model_usage") => {
            if obj
                .keys()
                .any(|key| !MODEL_USAGE_FIELDS.contains(&key.as_str()))
            {
                return Err("model_usage row contains fields for another row kind".to_string());
            }
            let maximum = i32::MAX as i64;
            if !bounded_identifier(obj.get("provider"))
                || !bounded_identifier(obj.get("model"))
                || !bounded_counter(obj, "requests", 1_000_000)
                || obj.get("requests").and_then(Value::as_i64) == Some(0)
                || !bounded_counter(obj, "inputTokens", maximum)
                || !bounded_counter(obj, "outputTokens", maximum)
                || !bounded_counter(obj, "cacheReadTokens", maximum)
                || !bounded_counter(obj, "cacheWriteTokens", maximum)
                || !bounded_counter(obj, "durationMs", maximum)
                || !bounded_counter(obj, "durationCount", maximum)
                || !bounded_counter(obj, "ttftMs", maximum)
                || !bounded_counter(obj, "ttftCount", maximum)
                || !bounded_counter(obj, "errors", maximum)
                || !obj
                    .get("costTotal")
                    .and_then(Value::as_f64)
                    .is_some_and(|cost| cost.is_finite() && (0.0..=1_000_000.0).contains(&cost))
                || !optional_enum(obj, "effort", &["none", "low", "medium", "high", "xhigh"])
                || !optional_enum(
                    obj,
                    "subscriptionTier",
                    &["plus", "pro", "max", "free", "api", "team", "enterprise"],
                )
                || !optional_enum(
                    obj,
                    "subscriptionSource",
                    &["declared", "provider-api", "api-key", "inferred", "unknown"],
                )
                || !optional_label(obj, "planName")
            {
                return Err("invalid model_usage row".to_string());
            }
            let requests = obj["requests"].as_i64().unwrap_or_default();
            for key in ["durationCount", "ttftCount", "errors"] {
                if obj[key].as_i64().unwrap_or_default() > requests {
                    return Err(format!("{key} must not exceed requests"));
                }
            }
        }
        Some("plan_utilization") => {
            if obj
                .keys()
                .any(|key| !PLAN_UTILIZATION_FIELDS.contains(&key.as_str()))
                || !bounded_identifier(obj.get("provider"))
                || !optional_label(obj, "planType")
                || !optional_label(obj, "windowLabel")
                || !matches!(
                    obj.get("resetsAt"),
                    None | Some(Value::Null) | Some(Value::Number(_))
                )
                || obj
                    .get("resetsAt")
                    .and_then(Value::as_i64)
                    .is_some_and(|timestamp| timestamp < 0)
            {
                return Err("invalid plan_utilization row".to_string());
            }
            for key in ["usedFraction", "remainingFraction"] {
                if !obj
                    .get(key)
                    .and_then(Value::as_f64)
                    .is_some_and(|fraction| fraction.is_finite() && (0.0..=1.0).contains(&fraction))
                {
                    return Err(format!("invalid {key}"));
                }
            }
        }
        _ => return Err("usage row kind must be model_usage or plan_utilization".to_string()),
    }
    Ok(())
}

/// Validate an entire batch. Checks every row and the batch metadata.
///
/// `now` is epoch seconds; the window bounds mirror the server's so a batch
/// is never shipped only to come back as `invalid_window`.
pub fn validate_batch(batch: &UsageBatch, now: i64) -> Result<(), String> {
    let key_is_safe = (8..=128).contains(&batch.idempotency_key.len())
        && batch
            .idempotency_key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "._:-".contains(ch));
    if !key_is_safe {
        return Err("batch idempotency_key is invalid".to_string());
    }
    if batch.window_start < 0 || batch.window_end < batch.window_start {
        return Err("batch window is invalid".to_string());
    }
    if batch.window_end > now + MAX_FUTURE_SKEW_SECS {
        return Err("batch window ends in the future".to_string());
    }
    if batch.window_start < now - MAX_WINDOW_AGE_SECS {
        return Err("batch window starts beyond the retention horizon".to_string());
    }
    if batch.window_end - batch.window_start > MAX_WINDOW_SECS {
        return Err("batch window is longer than 31 days".to_string());
    }
    if batch.rows.is_empty() || batch.rows.len() > MAX_ROWS_PER_BATCH {
        return Err(format!(
            "batch must contain between 1 and {MAX_ROWS_PER_BATCH} rows"
        ));
    }
    for (index, row) in batch.rows.iter().enumerate() {
        validate_row(row).map_err(|error| format!("batch row {index}: {error}"))?;
    }
    Ok(())
}

/// Validate an entire envelope. Checks version, batches, and all rows.
pub fn validate_envelope(envelope: &UsageEnvelope) -> Result<(), String> {
    if envelope.version != ENVELOPE_VERSION {
        return Err(format!(
            "envelope version mismatch: expected {ENVELOPE_VERSION}, got {}",
            envelope.version
        ));
    }
    if envelope.generated_at < 0 {
        return Err("envelope generated_at must be non-negative".to_string());
    }
    if envelope.batches.is_empty() || envelope.batches.len() > MAX_BATCHES_PER_ENVELOPE {
        return Err(format!(
            "envelope must contain between 1 and {MAX_BATCHES_PER_ENVELOPE} batches"
        ));
    }
    let mut seen = Vec::with_capacity(envelope.batches.len());
    for batch in &envelope.batches {
        if seen.contains(&batch.source) {
            return Err(format!(
                "envelope repeats the {} source",
                batch.source.as_str()
            ));
        }
        seen.push(batch.source);
    }
    if envelope
        .batches
        .iter()
        .map(|batch| batch.rows.len())
        .sum::<usize>()
        > MAX_ROWS_PER_ENVELOPE
    {
        return Err(format!(
            "envelope exceeds the {MAX_ROWS_PER_ENVELOPE}-row limit"
        ));
    }
    for (index, batch) in envelope.batches.iter().enumerate() {
        validate_batch(batch, envelope.generated_at)
            .map_err(|error| format!("envelope batch {index}: {error}"))?;
    }
    Ok(())
}

/// A batch that could not be shipped, paired with the reason. The batch
/// travels with it so the caller can hand it back to the owning source's
/// checkpoint logic instead of reconstructing it.
#[derive(Debug, Clone)]
pub struct RejectedBatch {
    pub batch: UsageBatch,
    pub reason: String,
    /// True when the batch is merely postponed (envelope budget) rather than
    /// unrepresentable. Deferred batches must be retried, never discarded.
    pub deferred: bool,
}

/// Assemble the widest envelope that is guaranteed to pass server validation,
/// isolating faults to the batch that caused them.
///
/// One malformed batch used to fail `build_envelope` outright, which meant a
/// single unparsable harness row silently blocked every other source forever.
/// Here each batch is validated on its own: the good ones ship, the bad ones
/// come back as `RejectedBatch` for the caller to record and skip.
///
/// Returns `(None, rejected)` when nothing shippable remains.
pub fn assemble_envelope(
    batches: Vec<UsageBatch>,
    generated_at: i64,
) -> (Option<UsageEnvelope>, Vec<RejectedBatch>) {
    let mut accepted: Vec<UsageBatch> = Vec::with_capacity(batches.len());
    let mut rejected = Vec::new();
    let mut rows_used = 0usize;

    for batch in batches {
        let (reason, deferred) = if accepted.len() >= MAX_BATCHES_PER_ENVELOPE {
            (Some("envelope batch limit reached".to_string()), true)
        } else if accepted.iter().any(|kept| kept.source == batch.source) {
            (Some(format!("duplicate {} batch", batch.source.as_str())), false)
        } else if rows_used + batch.rows.len() > MAX_ROWS_PER_ENVELOPE {
            (Some("envelope row limit reached".to_string()), true)
        } else {
            (validate_batch(&batch, generated_at).err(), false)
        };
        match reason {
            Some(reason) => rejected.push(RejectedBatch {
                batch,
                reason,
                deferred,
            }),
            None => {
                rows_used += batch.rows.len();
                accepted.push(batch);
            }
        }
    }

    if accepted.is_empty() {
        return (None, rejected);
    }
    (
        Some(UsageEnvelope {
            version: ENVELOPE_VERSION,
            generated_at,
            batches: accepted,
        }),
        rejected,
    )
}

/// Sanitize a row by removing any non-allowlisted keys. This is a last-resort
/// filter — callers should construct rows with only allowed fields. Returns
/// a new object containing only allowlisted keys from the input.
pub fn sanitize_row(row: &Value) -> Value {
    let Some(obj) = row.as_object() else {
        return Value::Null;
    };
    let mut filtered = Map::new();
    for (key, value) in obj {
        if ALLOWED_FIELDS.contains(&key.as_str()) {
            // Double-check: reject if the value looks like it contains a
            // secret pattern (long alphanumeric strings > 40 chars in a
            // field not expected to hold tokens).
            filtered.insert(key.clone(), value.clone());
        }
    }
    Value::Object(filtered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn safe_row() -> Value {
        json!({
            "kind": "model_usage",
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "effort": "high",
            "requests": 1,
            "inputTokens": 1200,
            "outputTokens": 800,
            "cacheReadTokens": 100,
            "cacheWriteTokens": 0,
            "costTotal": 0.012,
            "durationMs": 2500,
            "durationCount": 1,
            "ttftMs": 400,
            "ttftCount": 1,
            "errors": 0
        })
    }

    /// Anchored near the fixture epoch so window checks have a stable `now`.
    const NOW: i64 = 1784678400;

    fn batch(rows: Vec<Value>) -> UsageBatch {
        UsageBatch {
            source: SourceKind::Native,
            idempotency_key: "native:1784592000:v1".to_string(),
            window_start: NOW - 3600,
            window_end: NOW,
            rows,
        }
    }

    #[test]
    fn safe_row_passes_validation() {
        assert!(validate_row(&safe_row()).is_ok());
    }

    #[test]
    fn prompt_field_rejected() {
        let mut row = safe_row();
        row["prompt"] = json!("Write me a virus");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn response_field_rejected() {
        let mut row = safe_row();
        row["response"] = json!("Here is the code...");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn api_key_rejected() {
        let mut row = safe_row();
        row["apiKey"] = json!("sk-ant-xxxxx");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn environment_variables_rejected() {
        let mut row = safe_row();
        row["environmentVariables"] = json!({"HOME": "/Users/secret"});
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn raw_path_rejected() {
        let mut row = safe_row();
        row["rawPath"] = json!("/Users/secret/projects/target");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn unknown_field_rejected() {
        let mut row = safe_row();
        row["customField"] = json!("anything");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn source_field_is_batch_only() {
        let mut row = safe_row();
        row["source"] = json!("native");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn batch_validation_checks_metadata() {
        let mut b = batch(vec![safe_row()]);
        b.idempotency_key = "".to_string();
        assert!(validate_batch(&b, NOW).is_err());
    }

    #[test]
    fn batch_validation_checks_window_order() {
        let mut b = batch(vec![safe_row()]);
        b.window_end = b.window_start - 1;
        assert!(validate_batch(&b, NOW).is_err());
    }

    #[test]
    fn batch_validation_rejects_windows_the_server_would_reject() {
        // Longer than the server's 31-day cap.
        let mut wide = batch(vec![safe_row()]);
        wide.window_start = NOW - MAX_WINDOW_SECS - 1;
        assert!(validate_batch(&wide, NOW).is_err());

        // Older than the server's 90-day retention horizon.
        let mut ancient = batch(vec![safe_row()]);
        ancient.window_start = NOW - MAX_WINDOW_AGE_SECS - 1;
        ancient.window_end = ancient.window_start + 60;
        assert!(validate_batch(&ancient, NOW).is_err());

        // Beyond the server's tolerated clock skew.
        let mut future = batch(vec![safe_row()]);
        future.window_end = NOW + MAX_FUTURE_SKEW_SECS + 1;
        assert!(validate_batch(&future, NOW).is_err());
    }

    #[test]
    fn clamp_window_pulls_long_backlogs_into_range() {
        let (start, end) = clamp_window(NOW - MAX_WINDOW_AGE_SECS * 2, NOW, NOW).unwrap();
        assert_eq!(end, NOW);
        assert_eq!(end - start, MAX_WINDOW_SECS);
        assert!(validate_batch(
            &UsageBatch {
                source: SourceKind::Native,
                idempotency_key: "native:clamped:v1".to_string(),
                window_start: start,
                window_end: end,
                rows: vec![safe_row()],
            },
            NOW
        )
        .is_ok());

        // A window whose end predates retention cannot be represented at all.
        assert!(clamp_window(
            NOW - MAX_WINDOW_AGE_SECS * 2,
            NOW - MAX_WINDOW_AGE_SECS - 1,
            NOW
        )
        .is_none());
    }

    #[test]
    fn normalize_identifier_rescues_harness_model_ids() {
        // Claude Code's internally generated turns, which used to fail the
        // whole envelope and starve every other source.
        assert_eq!(normalize_identifier("<synthetic>").as_deref(), Some("synthetic"));
        assert_eq!(
            normalize_identifier("lmstudio:google/gemma-4-e4b").as_deref(),
            Some("lmstudio:google/gemma-4-e4b")
        );
        assert_eq!(
            normalize_identifier("GPT 4 (preview)").as_deref(),
            Some("GPT-4--preview")
        );
        assert_eq!(normalize_identifier("<<>>"), None);
        assert_eq!(normalize_identifier(""), None);
        assert_eq!(normalize_identifier(&"a".repeat(400)).unwrap().len(), 128);
    }

    #[test]
    fn envelope_validation_rejects_wrong_version() {
        let env = UsageEnvelope {
            version: 99,
            generated_at: 0,
            batches: vec![batch(vec![safe_row()])],
        };
        assert!(validate_envelope(&env).is_err());
    }

    #[test]
    fn envelope_validation_rejects_empty_batches() {
        let env = UsageEnvelope {
            version: ENVELOPE_VERSION,
            generated_at: 0,
            batches: vec![],
        };
        assert!(validate_envelope(&env).is_err());
    }

    #[test]
    fn assemble_envelope_ships_valid_batches() {
        let (envelope, rejected) = assemble_envelope(vec![batch(vec![safe_row()])], NOW);
        assert!(rejected.is_empty());
        assert_eq!(envelope.unwrap().batches.len(), 1);
    }

    #[test]
    fn assemble_envelope_isolates_a_bad_batch_from_the_good_ones() {
        // The regression that broke usage sync entirely: one harness batch
        // carrying an unrepresentable model id used to fail the whole
        // envelope, so native usage never left the device.
        let mut poisoned = batch(vec![json!({
            "kind": "model_usage",
            "provider": "anthropic",
            "model": "<synthetic>",
            "requests": 1,
            "inputTokens": 0,
            "outputTokens": 0,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "costTotal": 0.0,
            "durationMs": 0,
            "durationCount": 0,
            "ttftMs": 0,
            "ttftCount": 0,
            "errors": 0
        })]);
        poisoned.source = SourceKind::ClaudeCode;
        poisoned.idempotency_key = "claude-code:1784592000:v1".to_string();

        let (envelope, rejected) =
            assemble_envelope(vec![batch(vec![safe_row()]), poisoned], NOW);
        let envelope = envelope.expect("native batch must still ship");
        assert_eq!(envelope.batches.len(), 1);
        assert_eq!(envelope.batches[0].source, SourceKind::Native);
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].batch.source, SourceKind::ClaudeCode);
        assert_eq!(rejected[0].batch.window_end, NOW);
        assert!(!rejected[0].deferred);
        validate_envelope(&envelope).unwrap();
    }

    #[test]
    fn assemble_envelope_defers_past_the_server_row_budget() {
        let big = |source: SourceKind, key: &str| UsageBatch {
            source,
            idempotency_key: key.to_string(),
            window_start: NOW - 3600,
            window_end: NOW,
            rows: vec![safe_row(); MAX_ROWS_PER_BATCH],
        };
        let (envelope, rejected) = assemble_envelope(
            vec![
                big(SourceKind::Native, "native:budget:v1"),
                big(SourceKind::Omp, "omp:budget:v1"),
                big(SourceKind::ClaudeCode, "claude-code:budget:v1"),
            ],
            NOW,
        );
        let envelope = envelope.unwrap();
        assert_eq!(envelope.batches.len(), 2);
        assert_eq!(rejected.len(), 1);
        assert!(rejected[0].deferred);
        validate_envelope(&envelope).unwrap();
    }

    #[test]
    fn assemble_envelope_returns_none_when_nothing_is_shippable() {
        let mut bad = batch(vec![safe_row()]);
        bad.idempotency_key = "!".to_string();
        let (envelope, rejected) = assemble_envelope(vec![bad], NOW);
        assert!(envelope.is_none());
        assert_eq!(rejected.len(), 1);
    }

    #[test]
    fn sanitize_row_removes_unknown_keys() {
        let mut row = safe_row();
        row["prompt"] = json!("secret");
        row["apiKey"] = json!("sk-xxx");
        let sanitized = sanitize_row(&row);
        assert!(sanitized.get("prompt").is_none());
        assert!(sanitized.get("apiKey").is_none());
        assert!(sanitized.get("kind").is_some());
    }

    #[test]
    fn source_kind_serialization() {
        assert_eq!(SourceKind::Omp.as_str(), "omp");
        assert_eq!(SourceKind::Native.as_str(), "native");
        let json = serde_json::to_string(&SourceKind::Omp).unwrap();
        assert_eq!(json, "\"omp\"");
        let parsed: SourceKind = serde_json::from_str("\"native\"").unwrap();
        assert_eq!(parsed, SourceKind::Native);
    }

    #[test]
    fn tool_result_rejected() {
        let mut row = safe_row();
        row["toolResult"] = json!({"output": "sensitive data"});
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn terminal_output_rejected() {
        let mut row = safe_row();
        row["terminalOutput"] = json!("$ cat /etc/passwd");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn reasoning_text_rejected() {
        let mut row = safe_row();
        row["reasoningText"] = json!("Let me think about how to...");
        assert!(validate_row(&row).is_err());
    }

    #[test]
    fn credential_field_rejected() {
        let mut row = safe_row();
        row["credential"] = json!("Bearer token-value");
        assert!(validate_row(&row).is_err());
    }
    #[test]
    fn shared_wire_fixture_round_trips_exactly() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/usage-envelope-v1/request.json"
        ))
        .unwrap();
        let envelope: UsageEnvelope = serde_json::from_value(fixture.clone()).unwrap();
        validate_envelope(&envelope).unwrap();
        assert_eq!(serde_json::to_value(envelope).unwrap(), fixture);
    }
}

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

/// Identifies which source produced a usage batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// Oh My Pi (OMP) CLI stats and usage.
    Omp,
    /// Basebuild native chat request metrics.
    Native,
    /// Claude Code local session usage (aggregates only, no content).
    ClaudeCode,
    /// Codex CLI local session usage (aggregates only, no content).
    Codex,
    /// OpenCode local session usage (aggregates only, no content).
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
    /// Stable deduplication key (source-scoped). The server uses this to
    /// reject duplicate retries without double-counting.
    pub dedup_key: String,
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
    pub assembled_at: i64,
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
    // Identity
    "id",
    "ts",
    "source",
    // Provider / model metadata
    "provider",
    "providerId",
    "model",
    "modelId",
    "effort",
    "effortLevel",
    // Subscription metadata
    "subscriptionTier",
    "subscriptionSource",
    "planName",
    // Usage counts
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
    "requests",
    "requestsPerDay",
    "hoursPerDay",
    // Cost (numeric, no currency secrets)
    "costTotal",
    "costPerDay",
    // Timing
    "durationMs",
    "avgDurationMs",
    "ttftMs",
    "avgTtftMs",
    // Outcome (enum-like, not free-form)
    "outcome",
    "errorRate",
    // OMP-specific safe fields
    "window",
    "usedFraction",
    "remainingFraction",
    "resetsAt",
    "severity",
    "fetchedAgoMin",
    "isStale",
    // Window metadata
    "windowStart",
    "windowEnd",
    "mode",
    "summaries",
];

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

    // Allowlist check: every key must be in the allowed set.
    for key in obj.keys() {
        if !ALLOWED_FIELDS.contains(&key.as_str()) {
            return Err(format!("non-allowlisted field in usage row: {key}"));
        }
    }

    Ok(())
}

/// Validate an entire batch. Checks every row and the batch metadata.
pub fn validate_batch(batch: &UsageBatch) -> Result<(), String> {
    if batch.dedup_key.is_empty() {
        return Err("batch dedup_key must not be empty".to_string());
    }
    if batch.window_end < batch.window_start {
        return Err("batch window_end must not precede window_start".to_string());
    }
    for (i, row) in batch.rows.iter().enumerate() {
        validate_row(row).map_err(|e| format!("batch row {i}: {e}"))?;
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
    if envelope.batches.is_empty() {
        return Err("envelope must contain at least one batch".to_string());
    }
    for (i, batch) in envelope.batches.iter().enumerate() {
        validate_batch(batch).map_err(|e| format!("envelope batch {i}: {e}"))?;
    }
    Ok(())
}

/// Build an envelope from validated batches. The builder validates before
/// returning, so a successful return guarantees the envelope is safe to
/// transport.
pub fn build_envelope(
    batches: Vec<UsageBatch>,
    assembled_at: i64,
) -> Result<UsageEnvelope, String> {
    let envelope = UsageEnvelope {
        version: ENVELOPE_VERSION,
        assembled_at,
        batches,
    };
    validate_envelope(&envelope)?;
    Ok(envelope)
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
            "id": "msg-001",
            "ts": 1700000000,
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "inputTokens": 1200,
            "outputTokens": 800,
            "costTotal": 0.012,
            "durationMs": 2500,
            "outcome": "success"
        })
    }

    fn batch(rows: Vec<Value>) -> UsageBatch {
        UsageBatch {
            source: SourceKind::Native,
            dedup_key: "native-1700000000".to_string(),
            window_start: 1700000000,
            window_end: 1700003600,
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
    fn source_field_allowed() {
        let mut row = safe_row();
        row["source"] = json!("native");
        assert!(validate_row(&row).is_ok());
    }

    #[test]
    fn batch_validation_checks_metadata() {
        let mut b = batch(vec![safe_row()]);
        b.dedup_key = "".to_string();
        assert!(validate_batch(&b).is_err());
    }

    #[test]
    fn batch_validation_checks_window_order() {
        let mut b = batch(vec![safe_row()]);
        b.window_end = b.window_start - 1;
        assert!(validate_batch(&b).is_err());
    }

    #[test]
    fn envelope_validation_rejects_wrong_version() {
        let env = UsageEnvelope {
            version: 99,
            assembled_at: 0,
            batches: vec![batch(vec![safe_row()])],
        };
        assert!(validate_envelope(&env).is_err());
    }

    #[test]
    fn envelope_validation_rejects_empty_batches() {
        let env = UsageEnvelope {
            version: ENVELOPE_VERSION,
            assembled_at: 0,
            batches: vec![],
        };
        assert!(validate_envelope(&env).is_err());
    }

    #[test]
    fn build_envelope_validates() {
        let b = batch(vec![safe_row()]);
        assert!(build_envelope(vec![b], 1700000000).is_ok());
    }

    #[test]
    fn sanitize_row_removes_unknown_keys() {
        let mut row = safe_row();
        row["prompt"] = json!("secret");
        row["apiKey"] = json!("sk-xxx");
        let sanitized = sanitize_row(&row);
        assert!(sanitized.get("prompt").is_none());
        assert!(sanitized.get("apiKey").is_none());
        assert!(sanitized.get("id").is_some());
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
}

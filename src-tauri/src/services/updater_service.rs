use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::services::storage_paths::StoragePathService;

/// Release-channel update policy parsed from signed update manifest fields.
///
/// The Tauri updater manifest is extensible: additional fields beyond
/// `version`/`platforms` are preserved in `raw_json`. Basebuild uses
/// optional custom fields to control mandatory/skip behavior:
///
/// ```json
/// {
///   "version": "0.1.2",
///   "platforms": { ... },
///   "minimumSupportedVersion": "0.1.0",
///   "mandatoryBelow": "0.1.0",
///   "releaseSummary": "Critical security fixes"
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePolicy {
    /// If the running version is strictly below this, the update is
    /// mandatory and the skip button is hidden.
    pub mandatory_below: Option<String>,
    /// Human-facing summary shown in the splash. Falls back to `notes`
    /// from the manifest when absent.
    pub release_summary: Option<String>,
}

impl UpdatePolicy {
    /// Extract policy fields from the raw manifest JSON returned by the
    /// Tauri updater plugin.
    pub fn from_raw_json(raw: &serde_json::Value) -> Self {
        let get = |key: &str| -> Option<String> {
            raw.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };

        Self {
            mandatory_below: get("mandatoryBelow").or_else(|| get("minimumSupportedVersion")),
            release_summary: get("releaseSummary"),
        }
    }

    /// Returns `true` when the running version is below the mandatory
    /// threshold and the skip button must be hidden.
    pub fn is_mandatory(&self, current_version: &str) -> bool {
        match &self.mandatory_below {
            Some(threshold) => version_lt(current_version, threshold),
            None => false,
        }
    }
}

/// Compare two SemVer-like version strings. Returns `true` if `a < b`.
/// Handles `v` prefixes. A pre-release suffix (e.g. `-beta`, `-rc1`)
/// makes a version strictly less than the same `major.minor.patch`
/// without one, per SemVer spec.
pub fn version_lt(a: &str, b: &str) -> bool {
    parse_version_tuple(a) < parse_version_tuple(b)
}

/// Parse a version string into `(major, minor, patch, is_stable)`.
/// `is_stable = !has_prerelease` so that `0.1.0-beta < 0.1.0` because
/// `false < true` in the tuple comparison.
fn parse_version_tuple(v: &str) -> (u64, u64, u64, bool) {
    let normalized = v.strip_prefix('v').unwrap_or(v);
    let is_stable = !normalized.contains('-');
    let core = normalized
        .split_once('-')
        .map(|(c, _)| c)
        .unwrap_or(normalized)
        .split_once('+')
        .map(|(c, _)| c)
        .unwrap_or(normalized);

    let mut parts = core.split('.');
    let major = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (major, minor, patch, is_stable)
}

// ─── Skip-version persistence ───────────────────────────────────────────

/// Persist the version the user chose to skip so we don't nag them on
/// every startup for the same optional release.
pub fn set_skipped_version(version: &str) -> Result<(), String> {
    let conn = connect_state_db()?;
    conn.execute(
        "INSERT INTO app_defaults (key, value) VALUES ('skipped_update_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![version],
    )
    .map_err(|e| format!("Failed to persist skipped update version: {e}"))?;
    Ok(())
}

/// Returns the version the user last skipped, or `None` if no skip is
/// recorded. A skipped version is only relevant if it matches the latest
/// available target — a newer release clears the skip implicitly.
pub fn get_skipped_version() -> Result<Option<String>, String> {
    let conn = connect_state_db()?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_defaults WHERE key = 'skipped_update_version'",
            [],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    Ok(value)
}

/// Clear the skipped version record (e.g. when the user clicks Upgrade
/// or a newer version appears).
pub fn clear_skipped_version() -> Result<(), String> {
    let conn = connect_state_db()?;
    let _ = conn.execute(
        "DELETE FROM app_defaults WHERE key = 'skipped_update_version'",
        [],
    );
    Ok(())
}

fn connect_state_db() -> Result<Connection, String> {
    let db_path = StoragePathService::ensure_global_layout()?
        .global_dir
        .join("state.db");
    Connection::open(db_path).map_err(|e| format!("Failed to open Basebuild state database: {e}"))
}

/// Directory for staging downloaded update payloads before apply.
#[allow(dead_code)]
pub fn update_staging_dir() -> Result<PathBuf, String> {
    let dir = StoragePathService::ensure_global_layout()?
        .global_dir
        .join("updates");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create update staging directory: {e}"))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_policy_from_manifest_fields() {
        let raw = serde_json::json!({
            "version": "0.1.2",
            "minimumSupportedVersion": "0.1.0",
            "releaseSummary": "Security fixes"
        });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert_eq!(policy.mandatory_below.as_deref(), Some("0.1.0"));
        assert_eq!(policy.release_summary.as_deref(), Some("Security fixes"));
        assert!(policy.is_mandatory("0.0.3"));
        assert!(!policy.is_mandatory("0.1.0"));
        assert!(!policy.is_mandatory("0.1.5"));
    }

    #[test]
    fn falls_back_to_mandatory_below_field() {
        let raw = serde_json::json!({
            "version": "0.1.2",
            "mandatoryBelow": "0.1.0"
        });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert_eq!(policy.mandatory_below.as_deref(), Some("0.1.0"));
        assert!(policy.is_mandatory("0.0.3"));
    }

    #[test]
    fn no_policy_means_optional() {
        let raw = serde_json::json!({ "version": "0.1.2" });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert!(!policy.is_mandatory("0.0.3"));
        assert!(policy.mandatory_below.is_none());
        assert!(policy.release_summary.is_none());
    }

    #[test]
    fn version_comparison_handles_v_prefix() {
        assert!(version_lt("0.0.3", "0.1.2"));
        assert!(version_lt("v0.0.3", "v0.1.2"));
        assert!(!version_lt("0.1.2", "0.0.3"));
        assert!(!version_lt("0.1.2", "0.1.2"));
        assert!(version_lt("0.1.2", "0.1.3"));
        assert!(version_lt("0.0.9", "0.1.0"));
    }

    #[test]
    fn version_comparison_handles_prerelease() {
        assert!(version_lt("0.1.0-beta", "0.1.0"));
        assert!(version_lt("0.1.0-rc1", "0.1.1"));
    }

    #[test]
    fn empty_string_fields_are_ignored() {
        let raw = serde_json::json!({
            "version": "0.1.2",
            "minimumSupportedVersion": "",
            "releaseSummary": ""
        });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert!(policy.mandatory_below.is_none());
        assert!(policy.release_summary.is_none());
    }
}

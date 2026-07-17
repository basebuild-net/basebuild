//! Typed usage-source registry.
//!
//! Each source (OMP, Basebuild Native) is registered with independent
//! availability and checkpoint state. Missing OMP cannot block native
//! usage, and native failures cannot block OMP usage.

use crate::models::usage_envelope::{SourceKind, UsageBatch};

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
}

/// A registered usage source. Sources are read-only: they collect and
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

    /// Human-readable diagnostic for status reporting.
    fn diagnostic(&self) -> String;
}

/// OMP usage source. Collects `omp stats --json` and `omp usage --json`.
/// OMP uses a full-snapshot approach — no incremental checkpoint needed.
pub struct OmpSource;

impl UsageSource for OmpSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Omp
    }

    fn available(&self) -> bool {
        crate::services::omp_service::OmpService::status().installed
    }

    fn collect(&self) -> Result<Option<UsageBatch>, String> {
        // OMP uses the existing sync_raw_usage path — the envelope is not
        // used for OMP. This source exists for registry/status purposes.
        Ok(None)
    }

    fn advance_checkpoint(&self, _batch: &UsageBatch) -> Result<(), String> {
        // OMP uses full snapshots, no checkpoint to advance.
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
        settings.last_message_sync_at = Some(batch.window_end);
        SettingsService::set_usage_sync_settings(&settings)
    }

    fn diagnostic(&self) -> String {
        "Native chat metrics available".to_string()
    }
}

/// The registry of all known usage sources.
pub fn registered_sources() -> Vec<Box<dyn UsageSource>> {
    vec![Box::new(OmpSource), Box::new(NativeSource)]
}

/// Collect from all available sources independently. A failure in one
/// source does not block the others.
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
            });
            continue;
        }
        match source.collect() {
            Ok(batch) => results.push(SourceCollection {
                source: kind,
                batch,
                diagnostic: source.diagnostic(),
            }),
            Err(e) => results.push(SourceCollection {
                source: kind,
                batch: None,
                diagnostic: format!("{} error: {e}", kind.as_str()),
            }),
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_sources_contains_omp_and_native() {
        let sources = registered_sources();
        let kinds: Vec<SourceKind> = sources.iter().map(|s| s.kind()).collect();
        assert!(kinds.contains(&SourceKind::Omp));
        assert!(kinds.contains(&SourceKind::Native));
        assert_eq!(kinds.len(), 2);
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
    fn omp_source_collect_returns_none() {
        let source = OmpSource;
        // OMP uses the existing sync_raw_usage path, not the envelope.
        let result = source.collect();
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn native_source_available_is_true() {
        let source = NativeSource;
        assert!(source.available());
    }

    #[test]
    fn omp_source_advance_checkpoint_is_ok() {
        let source = OmpSource;
        let batch = UsageBatch {
            source: SourceKind::Omp,
            dedup_key: "test".to_string(),
            window_start: 0,
            window_end: 100,
            rows: vec![],
        };
        assert!(source.advance_checkpoint(&batch).is_ok());
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

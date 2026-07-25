use rusqlite::params;

use crate::{
    models::permission::{AnalyticsConsent, AnalyticsEvent},
    services::storage_service::StorageService,
};

type DbResult<T> = Result<T, String>;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

const CONSENT_KEY: &str = "analytics_consent";

/// Privacy-safe analytics event names. Adding a name here is required before
/// any emitter can record it. This prevents ad-hoc events from leaking.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AnalyticsEventName {
    GenerateContextRequested,
    ChatDraftInjected,
    AdapterStartFailed,
    PermissionDecisionRecorded,
    Custom(String),
}

impl AnalyticsEventName {
    pub fn as_str(&self) -> &str {
        match self {
            Self::GenerateContextRequested => "generate_context_requested",
            Self::ChatDraftInjected => "chat_draft_injected",
            Self::AdapterStartFailed => "adapter_start_failed",
            Self::PermissionDecisionRecorded => "permission_decision_recorded",
            Self::Custom(s) => s.as_str(),
        }
    }
}

#[derive(Debug, Default)]
pub struct AnalyticsService;

impl AnalyticsService {
    /// Returns true only if the user has explicitly opted in to local collection.
    pub fn collection_enabled() -> bool {
        Self::get_consent()
            .map(|c| c.collection_enabled)
            .unwrap_or(false)
    }

    /// Returns true only if anonymous aggregate upload was explicitly enabled.
    /// Local feature-event collection is an independent permission.
    #[allow(dead_code)]
    pub fn upload_enabled() -> bool {
        Self::get_consent()
            .map(|c| c.upload_enabled)
            .unwrap_or(false)
    }

    pub fn get_consent() -> DbResult<AnalyticsConsent> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = ?1",
                params![CONSENT_KEY],
                |r| r.get(0),
            )
            .ok();
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
            None => Ok(AnalyticsConsent::default()),
        }
    }

    pub fn set_consent(consent: &AnalyticsConsent) -> DbResult<()> {
        // Stamp an audit timestamp/version the first time either analytics
        // toggle is enabled. The toggle itself is the consent signal; this
        // record only preserves when, and under which version, it was given.
        let mut consent = consent.clone();
        if (consent.collection_enabled || consent.upload_enabled)
            && consent.consented_at.is_none()
        {
            consent.consented_at = Some(now());
            if consent.consent_version.is_none() {
                consent.consent_version = Some("usage-sharing-v1".to_string());
            }
        }
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![
                CONSENT_KEY,
                serde_json::to_string(&consent).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        // Keep the permission-rule gate in sync with the user's consent. The
        // usage-sync gate (`gates_pass` → allow_usage_analytics_upload) and the
        // collection path read the permission rules, NOT this consent blob;
        // without this propagation the visible Privacy toggle never opens the
        // gate and sync silently never runs.
        if let Ok(mut rules) =
            crate::services::settings_service::SettingsService::get_permission_rules()
        {
            rules.allow_usage_analytics_collection = consent.collection_enabled;
            rules.allow_usage_analytics_upload = consent.upload_enabled;
            let _ =
                crate::services::settings_service::SettingsService::set_permission_rules(&rules);
        }
        Ok(())
    }

    /// Records an event only if collection is enabled and the payload passes
    /// privacy redaction. Never stores prompt text, chat content, source code,
    /// terminal output, secrets, or raw absolute paths.
    pub fn record(
        event_name: AnalyticsEventName,
        feature_area: &str,
        outcome: Option<&str>,
        duration_ms: Option<i64>,
        adapter_id: Option<&str>,
        error_class: Option<&str>,
    ) -> DbResult<()> {
        if !Self::collection_enabled() {
            return Ok(());
        }
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO analytics_events (id, event_name, feature_area, outcome, duration_ms, adapter_id, error_class, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                gen_id(),
                event_name.as_str(),
                feature_area,
                outcome,
                duration_ms,
                adapter_id,
                error_class,
                now(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_events(limit: u32) -> DbResult<Vec<AnalyticsEvent>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, event_name, feature_area, outcome, duration_ms, adapter_id, error_class, created_at FROM analytics_events ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(AnalyticsEvent {
                    id: row.get(0)?,
                    event_name: row.get(1)?,
                    feature_area: row.get(2)?,
                    outcome: row.get(3)?,
                    duration_ms: row.get(4)?,
                    adapter_id: row.get(5)?,
                    error_class: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn event_count() -> DbResult<i64> {
        let conn = StorageService::connect()?;
        conn.query_row("SELECT COUNT(*) FROM analytics_events", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn delete_all_events() -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM analytics_events", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Export events as a human-readable JSON string, filtered by privacy rules.
    pub fn export_json() -> DbResult<String> {
        let events = Self::list_events(10000)?;
        serde_json::to_string_pretty(&events).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consent_defaults_disabled() {
        let consent = AnalyticsConsent::default();
        assert!(
            !consent.collection_enabled,
            "collection must be disabled by default"
        );
        assert!(
            !consent.upload_enabled,
            "upload must be disabled by default"
        );
        assert!(
            consent.consented_at.is_none(),
            "consented_at must be None by default"
        );
    }

    #[test]
    fn set_consent_backfills_timestamp_when_toggle_enabled() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let consent = AnalyticsConsent {
            collection_enabled: false,
            upload_enabled: true,
            consent_version: None,
            consented_at: None,
        };
        AnalyticsService::set_consent(&consent).unwrap();
        let stored = AnalyticsService::get_consent().unwrap();
        assert!(stored.upload_enabled);
        assert!(
            stored.consented_at.is_some(),
            "enabling a toggle must stamp an audit timestamp"
        );
        assert_eq!(stored.consent_version.as_deref(), Some("usage-sharing-v1"));
    }

    #[test]
    fn test_permission_rules_conservative() {
        let rules = crate::models::permission::PermissionRules::conservative();
        assert!(
            !rules.allow_usage_analytics_collection,
            "analytics collection must be off in conservative defaults"
        );
        assert!(
            !rules.allow_usage_analytics_upload,
            "analytics upload must be off in conservative defaults"
        );
        assert!(
            !rules.allow_detailed_diagnostics,
            "detailed diagnostics must be off in conservative defaults"
        );
    }

    #[test]
    fn test_runtime_defaults_conservative() {
        let defaults = crate::models::runtime::RuntimeDefaults::conservative();
        assert!(
            !defaults.auto_send_generated_prompts,
            "auto-send must be off in conservative defaults"
        );
        assert_eq!(
            defaults.default_chat_profile_id.as_deref(),
            Some("basebuild-native"),
            "default chat profile must be the native harness"
        );
        assert_eq!(
            defaults.default_terminal_profile_id.as_deref(),
            Some("default-terminal")
        );
        assert_eq!(
            defaults.default_model.as_deref(),
            Some("basebuild-local-coordinator"),
            "default model must match the native coordinator"
        );
    }

    #[test]
    fn test_analytics_event_name_taxonomy() {
        assert_eq!(
            AnalyticsEventName::GenerateContextRequested.as_str(),
            "generate_context_requested"
        );
        assert_eq!(
            AnalyticsEventName::ChatDraftInjected.as_str(),
            "chat_draft_injected"
        );
        assert_eq!(
            AnalyticsEventName::AdapterStartFailed.as_str(),
            "adapter_start_failed"
        );
        assert_eq!(
            AnalyticsEventName::PermissionDecisionRecorded.as_str(),
            "permission_decision_recorded"
        );
        assert_eq!(
            AnalyticsEventName::Custom("custom_event".to_string()).as_str(),
            "custom_event"
        );
    }

    #[test]
    fn test_profile_capabilities_omp() {
        let caps = crate::models::runtime::AgentCapability::omp_defaults();
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Chat));
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Skills));
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Providers));
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Commands));
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Info));
        assert!(caps.contains(&crate::models::runtime::AgentCapability::Messages));
    }

    #[test]
    fn test_runtime_profile_built_ins() {
        let built_ins = crate::models::runtime::RuntimeProfile::built_ins();
        assert_eq!(
            built_ins.len(),
            3,
            "should have native + OMP + terminal built-ins"
        );
        assert!(
            built_ins.iter().any(|p| p.id == "basebuild-native"),
            "native harness profile must exist"
        );
        assert!(
            built_ins.iter().any(|p| p.id == "omp"),
            "OMP profile must exist"
        );
        assert!(
            built_ins.iter().any(|p| p.id == "default-terminal"),
            "terminal profile must exist"
        );
    }
}

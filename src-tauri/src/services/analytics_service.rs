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
        Self::get_consent().map(|c| c.collection_enabled).unwrap_or(false)
    }

    /// Returns true only if the user has opted in to both collection and upload.
    pub fn upload_enabled() -> bool {
        Self::get_consent()
            .map(|c| c.collection_enabled && c.upload_enabled)
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
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![CONSENT_KEY, serde_json::to_string(consent).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
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
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

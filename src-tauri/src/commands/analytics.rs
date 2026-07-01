// Commands are stateless; analytics state lives in AnalyticsService.
 use crate::models::permission::{AnalyticsConsent, AnalyticsEvent};
 use crate::services::analytics_service::{AnalyticsEventName, AnalyticsService};

#[tauri::command]
pub fn get_analytics_consent() -> Result<AnalyticsConsent, String> {
    AnalyticsService::get_consent()
}

#[tauri::command]
pub fn set_analytics_consent(consent: AnalyticsConsent) -> Result<(), String> {
    AnalyticsService::set_consent(&consent)
}

#[tauri::command]
pub fn list_analytics_events(limit: Option<u32>) -> Result<Vec<AnalyticsEvent>, String> {
    AnalyticsService::list_events(limit.unwrap_or(100))
}

#[tauri::command]
pub fn analytics_event_count() -> Result<i64, String> {
    AnalyticsService::event_count()
}

#[tauri::command]
pub fn delete_analytics_events() -> Result<(), String> {
    AnalyticsService::delete_all_events()
}

#[tauri::command]
pub fn export_analytics_json() -> Result<String, String> {
    AnalyticsService::export_json()
}

/// Record a privacy-safe analytics event. Only records if collection enabled.
/// Never call with prompt text, chat content, source code, or raw paths.
#[tauri::command]
pub fn record_analytics_event(
    event_name: String,
    feature_area: String,
    outcome: Option<String>,
    duration_ms: Option<i64>,
    adapter_id: Option<String>,
    error_class: Option<String>,
) -> Result<(), String> {
    AnalyticsService::record(
        AnalyticsEventName::Custom(event_name),
        &feature_area,
        outcome.as_deref(),
        duration_ms,
        adapter_id.as_deref(),
        error_class.as_deref(),
    )
}

#[allow(dead_code)]
pub struct _AnalyticsState;

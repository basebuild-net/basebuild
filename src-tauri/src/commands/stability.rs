//! Tauri commands for stability reports and telemetry.

use crate::{
    models::stability::{CommandTelemetryEntry, StabilityReport},
    services::stability_service,
};

#[tauri::command]
pub fn stability_list_reports() -> Result<Vec<StabilityReport>, String> {
    stability_service::StabilityReport::list()
}

#[tauri::command]
pub fn stability_read_report(id: String) -> Result<StabilityReport, String> {
    stability_service::StabilityReport::read(&id)
}

#[tauri::command]
pub fn stability_delete_report(id: String) -> Result<(), String> {
    stability_service::StabilityReport::delete(&id)
}

#[tauri::command]
pub fn stability_mark_seen(id: String) -> Result<(), String> {
    stability_service::StabilityReport::mark_seen(&id)
}

#[tauri::command]
pub fn stability_unseen_count() -> Result<usize, String> {
    stability_service::StabilityReport::unseen_count()
}

#[tauri::command]
pub fn stability_recent_telemetry(limit: Option<u32>) -> Result<Vec<CommandTelemetryEntry>, String> {
    Ok(stability_service::recent_telemetry(limit.unwrap_or(50) as usize))
}

#[tauri::command]
pub fn stability_violations() -> Result<Vec<CommandTelemetryEntry>, String> {
    Ok(stability_service::violations())
}

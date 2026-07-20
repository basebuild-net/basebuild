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
pub fn stability_recent_telemetry(
    limit: Option<u32>,
) -> Result<Vec<CommandTelemetryEntry>, String> {
    Ok(stability_service::recent_telemetry(
        limit.unwrap_or(50) as usize
    ))
}

#[tauri::command]
pub fn stability_violations() -> Result<Vec<CommandTelemetryEntry>, String> {
    Ok(stability_service::violations())
}

#[tauri::command]
pub fn stability_renderer_heartbeat() -> Result<(), String> {
    stability_service::renderer_heartbeat();
    Ok(())
}

/// Persist a renderer-side crash (React error boundary, window error, or
/// unhandled promise rejection) as a stability report so it survives the
/// recovery reload/restart and surfaces in the Debug panel alongside Rust
/// panics and freezes. Rust panics are already persisted by the panic hook,
/// so the frontend only calls this for renderer-origin failures.
#[tauri::command]
pub fn stability_record_renderer_crash(
    source: String,
    message: String,
    details: String,
) -> Result<(), String> {
    let summary = format!("Renderer crash ({source}): {message}");
    stability_service::StabilityReport::write("renderer", &summary, &details)?;
    Ok(())
}

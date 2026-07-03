use tauri::AppHandle;

use crate::models::omp_telemetry::OmpLiveContext;
use crate::services::omp_telemetry_service::OmpTelemetryService;

/// Start the background telemetry polling loop (idempotent). Publishes
/// `omp-telemetry://update` events to the frontend.
#[tauri::command]
pub fn omp_telemetry_start(app: AppHandle) -> Result<(), String> {
    OmpTelemetryService::start_loop(app);
    Ok(())
}

/// Stop the background telemetry polling loop (idempotent).
#[tauri::command]
pub fn omp_telemetry_stop() -> Result<(), String> {
    OmpTelemetryService::stop_loop();
    Ok(())
}

/// Read the latest cached telemetry snapshot without spawning omp.
#[tauri::command]
pub fn omp_telemetry_snapshot() -> Result<OmpLiveContext, String> {
    Ok(OmpTelemetryService::latest())
}

/// Force a fresh snapshot (spawns `omp stats --json` + `omp usage --json`).
/// Useful for a manual refresh button.
#[tauri::command]
pub fn omp_telemetry_refresh() -> Result<OmpLiveContext, String> {
    let ctx = OmpTelemetryService::snapshot();
    Ok(ctx)
}

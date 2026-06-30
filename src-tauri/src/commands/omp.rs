use tauri::AppHandle;

use crate::{models::omp::OmpStatus, services::omp_service::OmpService};

#[tauri::command]
pub fn omp_status() -> OmpStatus {
    OmpService::status()
}

#[tauri::command]
pub fn omp_config_list() -> Result<crate::models::omp::OmpCommandResult, String> {
    OmpService::run_json(&["config", "list", "--json"])
}

#[tauri::command]
pub fn omp_stream_command(app: AppHandle, args: Vec<String>) -> Result<u64, String> {
    OmpService::stream_command(app, args)
}

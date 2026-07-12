use tauri::AppHandle;

use crate::models::usage_sync::{AutoSyncStatus, ProjectedUsage};
use crate::services::sync_service;

/// Sync raw OMP usage to basebuild.net using the stored native token.
/// Collects `omp stats --json` and `omp usage --json`, then sends them
/// as a `sync_raw_usage` JSON-RPC call to the hosted MCP endpoint.
#[tauri::command]
pub fn sync_raw_usage_native() -> Result<String, String> {
    sync_service::sync_raw_usage_native()
}

/// Trigger an opportunistic sync push (manual "Sync now"). Re-checks gates
/// and freshness, then pushes if due. Non-blocking: emits `usage-sync://status`.
#[tauri::command]
pub fn usage_sync_trigger(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    sync_service::trigger_sync(app, &reason.unwrap_or_else(|| "manual".to_string()), false);
    Ok(())
}

/// Enable or disable auto-sync. Persisted to settings.
#[tauri::command]
pub fn usage_sync_set_enabled(enabled: bool) -> Result<(), String> {
    sync_service::set_autosync_enabled(enabled)
}

/// Set the usage sync detail mode: "rows" (per-message rows; server rolls up)
/// or "summary" (client rolls up, sends summaries).
#[tauri::command]
pub fn usage_sync_set_mode(mode: String) -> Result<(), String> {
    sync_service::set_usage_sync_mode(&mode)
}

/// Read the current auto-sync status (cached, no network I/O).
#[tauri::command]
pub fn usage_sync_status() -> Result<AutoSyncStatus, String> {
    Ok(sync_service::autosync_status())
}

/// Fetch the full projected-usage payload for the Account page.
#[tauri::command]
pub fn usage_sync_projected_usage() -> Result<ProjectedUsage, String> {
    sync_service::fetch_projected_usage()
}

use crate::services::sync_service;

/// Sync raw OMP usage to basebuild.net using the stored native token.
/// Collects `omp stats --json` and `omp usage --json`, then sends them
/// as a `sync_raw_usage` JSON-RPC call to the hosted MCP endpoint.
#[tauri::command]
pub fn sync_raw_usage_native() -> Result<String, String> {
    sync_service::sync_raw_usage_native()
}

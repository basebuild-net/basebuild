use tauri::AppHandle;

use crate::models::usage_sync::{AutoSyncStatus, ProjectedUsage};
use crate::services::sync_service;

/// Sync raw OMP usage to basebuild.net using the stored native token.
/// Collects `omp stats --json` and `omp usage --json`, then sends them
/// as a `sync_raw_usage` JSON-RPC call to the hosted MCP endpoint.
#[tauri::command]
pub async fn sync_raw_usage_native() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(sync_service::sync_raw_usage_native)
        .await
        .map_err(|e| format!("Usage sync task panicked: {e}"))?
}

/// Trigger an opportunistic sync push (manual "Sync now"). Re-checks gates
/// and freshness, then pushes if due. Non-blocking: emits `usage-sync://status`.
#[tauri::command]
pub fn usage_sync_trigger(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    sync_service::trigger_sync(app, &reason.unwrap_or_else(|| "manual".to_string()), false);
    Ok(())
}

/// Retry pending usage windows immediately. This bypasses the normal freshness
/// debounce but preserves consent/upload gates and the coordinator's
/// single-flight guard.
#[tauri::command]
pub fn usage_sync_retry(app: AppHandle) -> Result<(), String> {
    sync_service::trigger_sync(app, "manual-retry", true);
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

/// Read the current auto-sync status. Runs on a blocking thread because the
/// first source-availability probe of a session may spawn `omp --version`
/// (cached after that); this keeps the main thread free.
#[tauri::command]
pub async fn usage_sync_status() -> Result<AutoSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(sync_service::autosync_status)
        .await
        .map_err(|e| format!("Usage-status task panicked: {e}"))
}

/// Fetch the full projected-usage payload for the Account page.
#[tauri::command]
pub async fn usage_sync_projected_usage() -> Result<ProjectedUsage, String> {
    tauri::async_runtime::spawn_blocking(sync_service::fetch_projected_usage)
        .await
        .map_err(|e| format!("Projected-usage task panicked: {e}"))?
}

/// Detect per-provider subscription plans from the local OMP usage ledger.
/// Providers that expose no documented plan type come back with
/// `needsDeclaration = true` so the UI can prompt the user to pick a plan.
#[tauri::command]
pub async fn usage_detect_provider_plans(
) -> Result<Vec<crate::models::plan_detection::DetectedProviderPlan>, String> {
    tauri::async_runtime::spawn_blocking(
        crate::services::plan_detection_service::PlanDetectionService::detect,
    )
    .await
    .map_err(|e| format!("Plan-detection task panicked: {e}"))?
}

/// List the basebuild.net plan catalog for the declaration dropdown. When
/// `provider` is given, only that provider's plans are returned.
#[tauri::command]
pub async fn usage_list_provider_plans(
    provider: Option<String>,
) -> Result<Vec<crate::models::plan_detection::ProviderPlanOption>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::plan_detection_service::PlanDetectionService::list_plans(
            provider.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Plan-catalog task panicked: {e}"))?
}

/// Declare per-provider plans to basebuild.net (100%-confidence attribution).
/// `plans` maps a provider slug to a catalog plan id; an empty id clears it.
#[tauri::command]
pub async fn usage_declare_provider_plans(
    plans: std::collections::BTreeMap<String, String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::plan_detection_service::PlanDetectionService::declare(plans)
    })
    .await
    .map_err(|e| format!("Plan-declaration task panicked: {e}"))?
}

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    match update {
        Some(update) => Ok(serde_json::json!({
            "available": true,
            "version": update.version.clone().to_string(),
            "notes": update.body.clone(),
        })),
        None => Ok(serde_json::json!({
            "available": false,
            "version": null,
            "notes": null,
        })),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?
        .ok_or("No update available")?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Failed to install update: {e}"))?;

    app.restart();
}

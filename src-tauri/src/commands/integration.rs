use tauri::AppHandle;

use crate::services::integration_service::{IntegrationEntry, IntegrationService};

use tauri::Emitter;

fn emit_changed(app: &AppHandle, session_id: &str) {
    let _ = app.emit(
        "native-chat://integration-changed",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[tauri::command]
pub fn integration_list(session_id: String, project_path: String) -> Result<Vec<IntegrationEntry>, String> {
    IntegrationService::list_finished(&session_id, &project_path)
}

#[tauri::command]
pub fn integration_cleanup(app: AppHandle, run_id: String, force: bool, session_id: String) -> Result<(), String> {
    IntegrationService::cleanup(&run_id, force)?;
    emit_changed(&app, &session_id);
    Ok(())
}

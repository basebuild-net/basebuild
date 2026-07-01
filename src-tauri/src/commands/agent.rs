use tauri::{AppHandle, State};

use crate::services::agent_service::AgentManager;

#[tauri::command]
pub async fn agent_start(
    app: AppHandle,
    state: State<'_, std::sync::Mutex<AgentManager>>,
    cwd: String,
    profile_id: Option<String>,
    model: Option<String>,
) -> Result<u64, String> {
    let mut manager = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    manager.start(app, &cwd, profile_id.as_deref(), model.as_deref())
}

#[tauri::command]
pub async fn agent_send(
    state: State<'_, std::sync::Mutex<AgentManager>>,
    id: u64,
    message: String,
) -> Result<(), String> {
    // Lock and write synchronously — the PTY write is fast for small messages.
    // If the writer is blocked (dead process), the lock will fail fast rather
    // than hang the Tauri runtime, because agent_start already moved the
    // writer into an Arc<Mutex> that the reader thread doesn't hold.
    let manager = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    manager.send(id, &message)
}

#[tauri::command]
pub fn agent_stop(
    state: State<'_, std::sync::Mutex<AgentManager>>,
    id: u64,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    manager.stop(id)
}

/// Returns the capabilities supported by a given runtime profile.
#[tauri::command]
pub fn agent_capabilities(profile_id: String) -> Result<Vec<crate::models::runtime::AgentCapability>, String> {
    let profiles = crate::services::settings_service::SettingsService::list_profiles()?;
    let profile = profiles
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;
    Ok(profile.capabilities)
}

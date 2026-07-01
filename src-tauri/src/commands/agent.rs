use tauri::{AppHandle, State};

use crate::services::agent_service::AgentManager;

#[tauri::command]
pub async fn agent_start(
    app: AppHandle,
    state: State<'_, std::sync::Mutex<AgentManager>>,
    cwd: String,
) -> Result<u64, String> {
    let mut manager = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    manager.start(app, &cwd)
}

#[tauri::command]
pub fn agent_send(
    state: State<'_, std::sync::Mutex<AgentManager>>,
    id: u64,
    message: String,
) -> Result<(), String> {
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

use tauri::{AppHandle, State};

use crate::services::omp_rpc_session_service::{
    self, OmpRpcSessionRegistry,
};

#[tauri::command]
pub fn omp_rpc_probe() -> Result<String, String> {
    omp_rpc_session_service::probe_omp_rpc()
}

#[tauri::command]
pub fn omp_rpc_start(
    app: AppHandle,
    session_id: String,
    provider: String,
    model: String,
) -> Result<(), String> {
    omp_rpc_session_service::start_session(app, session_id, &provider, &model)
}

#[tauri::command]
pub fn omp_rpc_send(
    app: AppHandle,
    session_id: String,
    message: String,
) -> Result<(), String> {
    omp_rpc_session_service::send_prompt(&app, &session_id, &message)
}

#[tauri::command]
pub fn omp_rpc_cancel(app: AppHandle, session_id: String) -> Result<(), String> {
    omp_rpc_session_service::cancel_session(&app, &session_id)
}

#[tauri::command]
pub fn omp_rpc_shutdown(app: AppHandle, session_id: String) -> Result<(), String> {
    omp_rpc_session_service::shutdown_session(&app, &session_id)
}

#[tauri::command]
pub fn omp_rpc_resolve(
    app: AppHandle,
    session_id: String,
    frame_id: String,
    answer: String,
) -> Result<(), String> {
    omp_rpc_session_service::resolve_user_input(&app, &session_id, &frame_id, &answer)
}

#[tauri::command]
pub fn omp_rpc_status(
    _app: AppHandle,
    _registry: State<'_, OmpRpcSessionRegistry>,
    session_id: String,
) -> Result<String, String> {
    if let Some(session) = _registry.get(&session_id) {
        if let Ok(s) = session.lock() {
            return Ok(match s.status {
                omp_rpc_session_service::OmpRpcSessionStatus::Starting => "starting",
                omp_rpc_session_service::OmpRpcSessionStatus::Running => "running",
                omp_rpc_session_service::OmpRpcSessionStatus::Exited => "exited",
            }
            .to_string());
        }
    }
    Ok("none".to_string())
}

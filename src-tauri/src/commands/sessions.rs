use crate::{
    models::session::{Session, SessionTab, TabKind},
    services::session_service::SessionService,
};

#[tauri::command]
pub fn create_session(project_path: String, title: String) -> Result<Session, String> {
    SessionService::create_session(&project_path, &title)
}

#[tauri::command]
pub fn list_sessions(project_path: String) -> Result<Vec<Session>, String> {
    SessionService::list_sessions(&project_path)
}

#[tauri::command]
pub fn rename_session(id: String, title: String) -> Result<(), String> {
    SessionService::rename_session(&id, &title)
}

#[tauri::command]
pub fn delete_session(id: String) -> Result<(), String> {
    SessionService::delete_session(&id)
}

#[tauri::command]
pub fn create_tab(
    session_id: String,
    kind: String,
    title: String,
    terminal_id: Option<u64>,
    file_path: Option<String>,
) -> Result<SessionTab, String> {
    SessionService::create_tab(
        &session_id,
        TabKind::from_str(&kind),
        &title,
        terminal_id,
        file_path.as_deref(),
    )
}

#[tauri::command]
pub fn list_tabs(session_id: String) -> Result<Vec<SessionTab>, String> {
    SessionService::list_tabs(&session_id)
}

#[tauri::command]
pub fn delete_tab(id: String) -> Result<(), String> {
    SessionService::delete_tab(&id)
}

#[tauri::command]
pub fn update_tab_terminal(id: String, terminal_id: Option<u64>) -> Result<(), String> {
    SessionService::update_tab_terminal(&id, terminal_id)
}

#[tauri::command]
pub fn update_tab_file_path(id: String, file_path: Option<String>) -> Result<(), String> {
    SessionService::update_tab_file_path(&id, file_path.as_deref())
}

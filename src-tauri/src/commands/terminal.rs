use tauri::{AppHandle, State};

use crate::{app_state::AppState, models::terminal::TerminalSession};

#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: State<AppState>,
    shell: String,
    cwd: Option<String>,
) -> Result<TerminalSession, String> {
    let cwd_ref = cwd.as_deref();
    state
        .terminals
        .lock()
        .create(app, &shell, cwd_ref)
}

#[tauri::command]
pub fn write_terminal(state: State<AppState>, id: u64, data: String) -> Result<(), String> {
    state
        .terminals
        .lock()
        .write(id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<AppState>,
    id: u64,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state
        .terminals
        .lock()
        .resize(id, rows, cols)
}

#[tauri::command]
pub fn close_terminal(state: State<AppState>, id: u64) -> Result<(), String> {
    state
        .terminals
        .lock()
        .close(id)
}

#[tauri::command]
pub fn list_terminals(state: State<AppState>) -> Result<Vec<TerminalSession>, String> {
    Ok(state
        .terminals
        .lock()
        .list())
}

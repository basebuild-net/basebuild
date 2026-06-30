use crate::{models::git::GitStatus, services::git_service::GitService};

#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatus, String> {
    GitService::status(path)
}

#[tauri::command]
pub fn git_diff(path: String, staged: bool, file: String) -> Result<String, String> {
    GitService::diff(path, staged, &file)
}

#[tauri::command]
pub fn git_add(path: String, file: String) -> Result<(), String> {
    GitService::add(path, &file)
}

#[tauri::command]
pub fn git_reset(path: String, file: String) -> Result<(), String> {
    GitService::reset(path, &file)
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    GitService::commit(path, &message)
}

#[tauri::command]
pub fn git_log(path: String, limit: Option<usize>) -> Result<Vec<crate::models::git::GitCommit>, String> {
    GitService::log(path, limit.unwrap_or(20))
}

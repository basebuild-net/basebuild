use crate::{
    models::git::{BranchInfo2, GitCommit, GitStatus},
    services::git_service::GitService,
};

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
pub fn git_discard(path: String, file: String) -> Result<(), String> {
    GitService::discard(path, &file)
}

#[tauri::command]
pub fn git_stage_all(path: String) -> Result<(), String> {
    GitService::stage_all(path)
}

#[tauri::command]
pub fn git_unstage_all(path: String) -> Result<(), String> {
    GitService::unstage_all(path)
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<String, String> {
    GitService::pull(path)
}

#[tauri::command]
pub fn git_push(path: String) -> Result<String, String> {
    GitService::push(path)
}

#[tauri::command]
pub fn git_fetch(path: String) -> Result<String, String> {
    GitService::fetch(path)
}

#[tauri::command]
pub fn git_branch_list(path: String) -> Result<Vec<BranchInfo2>, String> {
    GitService::branch_list(path)
}

#[tauri::command]
pub fn git_branch_create(path: String, name: String) -> Result<(), String> {
    GitService::branch_create(path, &name)
}

#[tauri::command]
pub fn git_branch_switch(path: String, name: String) -> Result<(), String> {
    GitService::branch_switch(path, &name)
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    GitService::commit(path, &message)
}

#[tauri::command]
pub fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    GitService::log(path, limit.unwrap_or(20))
}

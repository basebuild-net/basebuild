use crate::{
    models::git::{BranchInfo2, GitCommit, GitStatus},
    services::git_service::GitService,
};

/// All git commands are async and run on a blocking thread pool via
/// `tauri::async_runtime::spawn_blocking`. This prevents blocking I/O
/// (subprocess spawns, file reads) from freezing the main thread and
/// triggering the freeze watchdog.

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::status(path))
        .await
        .map_err(|e| format!("Git status task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_diff(path: String, staged: bool, file: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::diff(path, staged, &file))
        .await
        .map_err(|e| format!("Git diff task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_add(path: String, file: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::add(path, &file))
        .await
        .map_err(|e| format!("Git add task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_reset(path: String, file: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::reset(path, &file))
        .await
        .map_err(|e| format!("Git reset task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_discard(path: String, file: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::discard(path, &file))
        .await
        .map_err(|e| format!("Git discard task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_stage_all(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::stage_all(path))
        .await
        .map_err(|e| format!("Git stage_all task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_unstage_all(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::unstage_all(path))
        .await
        .map_err(|e| format!("Git unstage_all task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::pull(path))
        .await
        .map_err(|e| format!("Git pull task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::push(path))
        .await
        .map_err(|e| format!("Git push task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::fetch(path))
        .await
        .map_err(|e| format!("Git fetch task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_branch_list(path: String) -> Result<Vec<BranchInfo2>, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::branch_list(path))
        .await
        .map_err(|e| format!("Git branch_list task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_branch_create(path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::branch_create(path, &name))
        .await
        .map_err(|e| format!("Git branch_create task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_branch_switch(path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GitService::branch_switch(path, &name))
        .await
        .map_err(|e| format!("Git branch_switch task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::commit(path, &message))
        .await
        .map_err(|e| format!("Git commit task panicked: {e}"))?
}

#[tauri::command]
pub async fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || GitService::log(path, limit.unwrap_or(20)))
        .await
        .map_err(|e| format!("Git log task panicked: {e}"))?
}

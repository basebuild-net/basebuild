use crate::services::worktree_service::{Workspace, WorktreeService};

#[tauri::command]
pub fn workspace_create(
    project_path: String,
    plan_id: Option<String>,
    reference_id: String,
    slug: String,
) -> Result<Workspace, String> {
    WorktreeService::create(&project_path, plan_id.as_deref(), &reference_id, &slug)
}

#[tauri::command]
pub fn workspace_list(project_path: String) -> Result<Vec<Workspace>, String> {
    WorktreeService::list(&project_path)
}

#[tauri::command]
pub fn workspace_remove(id: String, force: bool) -> Result<(), String> {
    WorktreeService::remove(&id, force)
}

#[tauri::command]
pub fn workspace_is_supported(project_path: String) -> Result<bool, String> {
    Ok(WorktreeService::is_supported(&project_path))
}

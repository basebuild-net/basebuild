use crate::{
    models::workspace::WorkspaceRestoreState,
    services::workspace_service::WorkspaceService,
};

#[tauri::command]
pub fn get_workspace_restore_state(project_path: String) -> Result<WorkspaceRestoreState, String> {
    WorkspaceService::get_restore_state(&project_path)
}

#[tauri::command]
pub fn save_workspace_restore_state(
    state: WorkspaceRestoreState,
) -> Result<WorkspaceRestoreState, String> {
    WorkspaceService::save_restore_state(state)
}

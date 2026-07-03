use crate::services::openspec_service;

/// Derive a kebab-case change name from a title.
#[tauri::command]
pub fn openspec_derive_change_name(title: String) -> Result<String, String> {
    Ok(openspec_service::derive_change_name(&title))
}

/// Resolve a unique change name for a project, appending -2, -3, … on collision.
#[tauri::command]
pub fn openspec_resolve_change_name(project_path: String, title: String) -> Result<String, String> {
    Ok(openspec_service::resolve_unique_change_name(&project_path, &title))
}

/// Parse the completed/total checkbox counts from a plan's linked change.
#[tauri::command]
pub fn openspec_task_progress(project_path: String, change_name: String) -> Result<(u32, u32), String> {
    Ok(openspec_service::read_task_progress(&project_path, &change_name))
}

/// Parse task progress from a raw tasks.md string.
#[tauri::command]
pub fn openspec_parse_task_progress(content: String) -> Result<(u32, u32), String> {
    Ok(openspec_service::parse_task_progress(&content))
}

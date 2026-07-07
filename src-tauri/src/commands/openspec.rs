use tauri::AppHandle;

use crate::services::openspec_service;
use crate::models::openspec_catalog::{ChangeCatalogEntry, StructuredTasks};

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

/// List all OpenSpec changes in a project (active + archived).
#[tauri::command]
pub fn openspec_list_changes(project_path: String) -> Result<Vec<ChangeCatalogEntry>, String> {
    openspec_service::list_changes(&project_path)
}

/// Parse a tasks.md string into structured phases + tasks with line offsets.
#[tauri::command]
pub fn openspec_parse_tasks_structured(content: String) -> Result<StructuredTasks, String> {
    Ok(openspec_service::parse_tasks_structured(&content))
}

/// Read and parse a change's tasks.md into structured phases + tasks.
#[tauri::command]
pub fn openspec_read_tasks_structured(
    project_path: String,
    change_name: String,
) -> Result<StructuredTasks, String> {
    let tasks_path = openspec_service::change_dir(&project_path, &change_name).join("tasks.md");
    let content = std::fs::read_to_string(&tasks_path)
        .map_err(|e| format!("Failed to read tasks.md: {e}"))?;
    Ok(openspec_service::parse_tasks_structured(&content))
}

/// Toggle a task checkbox on a specific line of a change's tasks.md.
#[tauri::command]
pub fn openspec_toggle_task(
    app: AppHandle,
    project_path: String,
    change_name: String,
    line: u32,
    make_checked: bool,
) -> Result<(), String> {
    openspec_service::toggle_task(&app, &project_path, &change_name, line, make_checked)
}

/// Archive a change directory (moves to openspec/changes/archive/).
#[tauri::command]
pub fn openspec_archive_change(
    project_path: String,
    change_name: String,
) -> Result<(), String> {
    openspec_service::archive_change(&project_path, &change_name)
}

/// Link a change to a plan (by plan id). Refuses double-link.
#[tauri::command]
pub fn openspec_link_change_to_plan(
    change_name: String,
    plan_id: String,
) -> Result<(), String> {
    openspec_service::link_change_to_plan(&change_name, &plan_id)
}

/// Unlink a plan from its change. Refuses if plan is active.
#[tauri::command]
pub fn openspec_unlink_plan_from_change(plan_id: String) -> Result<(), String> {
    openspec_service::unlink_plan_from_change(&plan_id)
}

/// Re-parse a change's tasks.md and emit TaskProgressChanged if counts
/// changed. Returns true if progress changed. Used by frontend polling.
#[tauri::command]
pub fn openspec_refresh_task_progress(
    app: AppHandle,
    project_path: String,
    change_name: String,
    last_completed: u32,
    last_total: u32,
) -> Result<bool, String> {
    openspec_service::refresh_task_progress(&app, &project_path, &change_name, last_completed, last_total)
}

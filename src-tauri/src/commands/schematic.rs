use std::path::PathBuf;

use tauri::AppHandle;

use crate::services::schematic_service::{self, SchematicReport};

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SchematicPayload {
    pub content: String,
}

#[tauri::command]
pub fn get_project_schematic(project_path: String) -> Result<SchematicPayload, String> {
    let path = PathBuf::from(project_path);
    let content = schematic_service::read(&path)?;
    Ok(SchematicPayload { content })
}

#[tauri::command]
pub fn has_project_schematic(project_path: String) -> Result<bool, String> {
    let path = PathBuf::from(project_path);
    Ok(schematic_service::exists(&path))
}

#[tauri::command]
pub fn set_project_schematic(app: AppHandle, project_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    schematic_service::write(&path, &content)?;
    let report = schematic_service::inspect(&path);
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::SchematicUpdated,
        &project_path,
        &project_path,
        None,
        "Project schematic",
        Some(format!("{:?}", report.health)),
    );
    Ok(())
}

/// Parse and validate the project schematic: per-section fill state, overall
/// health, and end-goal staleness. Deterministic — no model calls.
#[tauri::command]
pub fn inspect_project_schematic(project_path: String) -> Result<SchematicReport, String> {
    let path = PathBuf::from(project_path);
    Ok(schematic_service::inspect(&path))
}

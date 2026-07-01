use std::path::PathBuf;

use crate::services::schematic_service;

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
pub fn set_project_schematic(project_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(project_path);
    schematic_service::write(&path, &content)?;
    Ok(())
}

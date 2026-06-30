use crate::{
    models::{project::ProjectDetection, recent_project::RecentProject},
    services::{project_service::ProjectService, storage_service::StorageService},
};

#[tauri::command]
pub fn remember_recent_project(path: String) -> Result<RecentProject, String> {
    StorageService::remember_recent_project(path)
}

#[tauri::command]
pub fn list_recent_projects(limit: Option<u32>) -> Result<Vec<RecentProject>, String> {
    StorageService::list_recent_projects(limit.unwrap_or(10))
}

#[tauri::command]
pub fn detect_project(path: String) -> ProjectDetection {
    ProjectService::detect(path)
}

#[tauri::command]
pub fn create_project_basebuild_config(path: String) -> Result<ProjectDetection, String> {
    ProjectService::create_project_config(path)
}

#[tauri::command]
pub fn remove_recent_project(path: String) -> Result<(), String> {
    StorageService::remove_recent_project(&path)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }
    Ok(())
}

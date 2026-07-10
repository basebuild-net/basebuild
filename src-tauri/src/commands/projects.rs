use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    models::{project::ProjectDetection, recent_project::RecentProject},
    services::{project_service::ProjectService, storage_service::StorageService},
};

#[tauri::command]
pub async fn pick_project_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open Basebuild project")
            .set_directory(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
            .blocking_pick_folder()
    });

    let result = handle.await.map_err(|e| format!("Dialog task failed: {e}"))?;
    Ok(result.and_then(|fp| match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}

#[tauri::command]
pub async fn pick_context_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let result: Option<FilePath> = app.dialog()
            .file()
            .set_title("Select context file or folder")
            .add_filter("Basebuild files", &["md", "json", "yaml", "yml", "toml", "txt"])
            .set_directory(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
            .blocking_pick_file();
        result
    });

    let result = handle.await.map_err(|e| format!("Dialog task failed: {e}"))?;
    Ok(result.and_then(|fp| match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}

#[tauri::command]
pub async fn pick_context_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let result: Option<FilePath> = app.dialog()
            .file()
            .set_title("Select context folder")
            .set_directory(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
            .blocking_pick_folder();
        result
    });

    let result = handle.await.map_err(|e| format!("Dialog task failed: {e}"))?;
    Ok(result.and_then(|fp| match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}
#[tauri::command]
pub fn remember_recent_project(path: String) -> Result<RecentProject, String> {
    StorageService::remember_recent_project(path)
}

#[tauri::command]
pub fn list_recent_projects(limit: Option<u32>) -> Result<Vec<RecentProject>, String> {
    StorageService::list_recent_projects(limit.unwrap_or(10))
}

#[tauri::command]
pub fn get_last_focused_project() -> Result<Option<RecentProject>, String> {
    StorageService::get_last_focused_project()
}

#[tauri::command]
pub fn set_last_focused_project(path: String) -> Result<RecentProject, String> {
    StorageService::set_last_focused_project(path)
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
pub fn set_last_active_session(project_path: String, session_id: String) -> Result<(), String> {
    StorageService::set_last_active_session(&project_path, &session_id)
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

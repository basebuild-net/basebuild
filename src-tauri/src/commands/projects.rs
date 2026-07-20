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
            .set_directory(
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")),
            )
            .blocking_pick_folder()
    });

    let result = handle
        .await
        .map_err(|e| format!("Dialog task failed: {e}"))?;
    Ok(result.and_then(|fp| match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}

#[tauri::command]
pub async fn pick_context_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let result: Option<FilePath> = app
            .dialog()
            .file()
            .set_title("Select context file or folder")
            .add_filter(
                "Basebuild files",
                &["md", "json", "yaml", "yml", "toml", "txt"],
            )
            .set_directory(
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")),
            )
            .blocking_pick_file();
        result
    });

    let result = handle
        .await
        .map_err(|e| format!("Dialog task failed: {e}"))?;
    Ok(result.and_then(|fp| match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().to_string()),
        FilePath::Url(_) => None,
    }))
}

#[tauri::command]
pub async fn pick_context_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let result: Option<FilePath> = app
            .dialog()
            .file()
            .set_title("Select context folder")
            .set_directory(
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")),
            )
            .blocking_pick_folder();
        result
    });

    let result = handle
        .await
        .map_err(|e| format!("Dialog task failed: {e}"))?;
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
pub async fn list_recent_projects(limit: Option<u32>) -> Result<Vec<RecentProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        StorageService::list_recent_projects(limit.unwrap_or(10))
    })
    .await
    .map_err(|error| format!("Recent-project task panicked: {error}"))?
}

#[tauri::command]
pub async fn get_last_focused_project() -> Result<Option<RecentProject>, String> {
    tauri::async_runtime::spawn_blocking(StorageService::get_last_focused_project)
        .await
        .map_err(|error| format!("Focused-project task panicked: {error}"))?
}

#[tauri::command]
pub fn set_last_focused_project(path: String) -> Result<RecentProject, String> {
    StorageService::set_last_focused_project(path)
}

#[tauri::command]
pub async fn detect_project(path: String) -> Result<ProjectDetection, String> {
    tauri::async_runtime::spawn_blocking(move || ProjectService::detect(path))
        .await
        .map_err(|error| format!("Project-detection task panicked: {error}"))
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
        crate::services::process_helpers::hidden_command("explorer")
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

/// Return the global basebuild data directory (~/.basebuild) where chat
/// history, config packs, and other local state is stored. Used by the
/// History modal's "Open folder" button so users can browse their data.
#[tauri::command]
pub fn basebuild_data_dir() -> Result<String, String> {
    let paths = crate::services::storage_paths::StoragePathService::ensure_global_layout()?;
    Ok(paths.global_dir.to_string_lossy().to_string())
}

/// Initialize a test project for "Test Run Mode": creates an empty folder
/// with a basic `index.html` and the Basebuild config, then remembers it as
/// a recent project. If the folder already exists (from a prior test run),
/// it is reused as-is so the user can re-run the workflow without recreating
/// it. Returns the absolute project path.
#[tauri::command]
pub fn test_run_mode_init() -> Result<String, String> {
    let base_dir = std::env::temp_dir().join("basebuild-test-project");
    // Create the project folder if it doesn't exist. Reuse if present so the
    // user can re-run the workflow without recreating the project.
    std::fs::create_dir_all(&base_dir)
        .map_err(|e| format!("Failed to create test project directory: {e}"))?;

    // Write a basic index.html if it doesn't exist.
    let index_path = base_dir.join("index.html");
    if !index_path.exists() {
        std::fs::write(
            &index_path,
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Test Project</title>\n</head>\n<body>\n  <h1>Hello from Test Project</h1>\n  <p>This project was created by Basebuild's Test Run Mode.</p>\n</body>\n</html>\n",
        )
        .map_err(|e| format!("Failed to write index.html: {e}"))?;
    }

    // Create the Basebuild config (.basebuild/config.toml + prompts/ + etc.).
    ProjectService::create_project_config(&base_dir)?;

    // Remember it as a recent project so it appears in the sidebar.
    let path_str = base_dir.to_string_lossy().to_string();
    let _ = StorageService::remember_recent_project(&path_str);

    Ok(path_str)
}

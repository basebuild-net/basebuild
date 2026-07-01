use crate::services::file_service::{self, DirEntry};

#[tauri::command]
pub fn list_files(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = std::path::PathBuf::from(path);
    file_service::list_directory(&dir)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let file = std::path::PathBuf::from(path);
    std::fs::read_to_string(&file).map_err(|e| format!("Failed to read file: {e}"))
}

use crate::services::file_service::{self, DirEntry};

#[tauri::command]
pub fn list_files(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = std::path::PathBuf::from(path);
    file_service::list_directory(&dir)
}

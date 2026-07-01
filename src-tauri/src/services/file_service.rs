use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
}

pub fn list_directory(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        result.push(DirEntry {
            name,
            path,
            is_dir: meta.is_dir(),
            is_file: meta.is_file(),
            size: meta.len(),
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

use std::path::{Path, PathBuf};

pub const SCHEMATIC_DIR: &str = ".basebuild";
pub const SCHEMATIC_FILE: &str = "project-schematic.md";

fn schematic_path(project_path: &Path) -> PathBuf {
    project_path.join(SCHEMATIC_DIR).join(SCHEMATIC_FILE)
}

pub fn read(project_path: &Path) -> Result<String, String> {
    let path = schematic_path(project_path);
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read schematic: {e}"))
}

pub fn exists(project_path: &Path) -> bool {
    schematic_path(project_path).is_file()
}

pub fn write(project_path: &Path, content: &str) -> Result<PathBuf, String> {
    let dir = project_path.join(SCHEMATIC_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create .basebuild dir: {e}"))?;
    let path = dir.join(SCHEMATIC_FILE);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write schematic: {e}"))?;
    Ok(path)
}

use std::path::{Path, PathBuf};

use crate::models::project::ProjectDetection;

#[derive(Debug, Default)]
pub struct ProjectService;

impl ProjectService {
    pub fn detect(path: impl AsRef<Path>) -> ProjectDetection {
        let path = path.as_ref();
        let git_root = find_git_root(path);

        ProjectDetection {
            path: path.to_path_buf(),
            has_git: git_root.is_some(),
            git_root,
            has_openspec: path.join("openspec").is_dir(),
            has_basebuild: path.join(".basebuild").is_dir(),
        }
    }

    pub fn create_project_config(path: impl AsRef<Path>) -> Result<ProjectDetection, String> {
        let config_dir = Self::project_config_dir(path.as_ref());
        std::fs::create_dir_all(config_dir.join("prompts"))
            .map_err(|error| format!("Failed to create project prompts directory: {error}"))?;
        std::fs::create_dir_all(config_dir.join("workflows"))
            .map_err(|error| format!("Failed to create project workflows directory: {error}"))?;
        std::fs::create_dir_all(config_dir.join("cache"))
            .map_err(|error| format!("Failed to create project cache directory: {error}"))?;
        std::fs::create_dir_all(config_dir.join("logs"))
            .map_err(|error| format!("Failed to create project logs directory: {error}"))?;

        let config_path = config_dir.join("config.toml");
        if !config_path.exists() {
            std::fs::write(
                &config_path,
                "version = 1\nactive_pack = \"official.idea-generation\"\n\n[project]\nname = \"Basebuild Project\"\n",
            )
            .map_err(|error| format!("Failed to write project Basebuild config: {error}"))?;
        }

        let gitignore_path = config_dir.join(".gitignore");
        if !gitignore_path.exists() {
            std::fs::write(&gitignore_path, "cache/\nlogs/\nruns/\nstate.db\n")
                .map_err(|error| format!("Failed to write project Basebuild gitignore: {error}"))?;
        }

        Ok(Self::detect(path))
    }

    pub fn project_config_dir(path: impl AsRef<Path>) -> PathBuf {
        path.as_ref().join(".basebuild")
    }
}

fn find_git_root(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);

    while let Some(candidate) = current {
        if candidate.join(".git").exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }

    None
}

use std::{env, fs, path::{Path, PathBuf}};

use crate::models::storage::StoragePaths;

pub const BASEBUILD_DIR_NAME: &str = ".basebuild";

#[derive(Debug, Default)]
pub struct StoragePathService;

impl StoragePathService {
    pub fn global_basebuild_dir() -> Result<PathBuf, String> {
        if let Some(path) = env::var_os("BASEBUILD_HOME") {
            return Ok(PathBuf::from(path));
        }

        home_dir()
            .map(|home| home.join(BASEBUILD_DIR_NAME))
            .ok_or_else(|| "Could not resolve the user home directory for ~/.basebuild".to_string())
    }

    pub fn project_basebuild_dir(project_path: impl AsRef<Path>) -> PathBuf {
        project_path.as_ref().join(BASEBUILD_DIR_NAME)
    }

    pub fn resolve(project_path: Option<PathBuf>) -> Result<StoragePaths, String> {
        let global_dir = Self::global_basebuild_dir()?;
        let project_dir = project_path.map(Self::project_basebuild_dir);

        Ok(StoragePaths {
            global_dir,
            project_dir,
        })
    }

    pub fn global_config_packs_dir() -> Result<PathBuf, String> {
        Ok(Self::global_basebuild_dir()?.join("packs"))
    }

    pub fn ensure_global_layout() -> Result<StoragePaths, String> {
        let paths = Self::resolve(None)?;
        fs::create_dir_all(paths.global_dir.join("configs"))
            .map_err(|error| format!("Failed to create global configs directory: {error}"))?;
        fs::create_dir_all(paths.global_dir.join("marketplace").join("cache"))
            .map_err(|error| format!("Failed to create marketplace cache directory: {error}"))?;
        fs::create_dir_all(paths.global_dir.join("updates"))
            .map_err(|error| format!("Failed to create updates directory: {error}"))?;
        Ok(paths)
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

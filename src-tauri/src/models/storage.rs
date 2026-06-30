use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePaths {
    pub global_dir: PathBuf,
    pub project_dir: Option<PathBuf>,
}

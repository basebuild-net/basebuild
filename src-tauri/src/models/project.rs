use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetection {
    pub path: PathBuf,
    pub git_root: Option<PathBuf>,
    pub has_git: bool,
    pub has_openspec: bool,
    pub has_basebuild: bool,
}

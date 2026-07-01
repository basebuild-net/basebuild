use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Unmerged,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: PathBuf,
    pub index_status: Option<char>,
    pub worktree_status: Option<char>,
    pub change_type: FileChangeType,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: BranchInfo,
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
    pub untracked: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo2 {
    pub name: String,
    pub upstream: Option<String>,
    pub is_current: bool,
}

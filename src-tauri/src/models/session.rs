use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_path: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub session_id: String,
    pub kind: TabKind,
    pub title: String,
    pub terminal_id: Option<u64>,
    pub file_path: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind", content = "value")]
pub enum TabKind {
    Terminal,
    Empty,
    File,
    Chat,
}

impl TabKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TabKind::Terminal => "terminal",
            TabKind::Empty => "empty",
            TabKind::File => "file",
            TabKind::Chat => "chat",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "file" => TabKind::File,
            "empty" => TabKind::Empty,
            "chat" => TabKind::Chat,
            _ => TabKind::Terminal,
        }
    }
}

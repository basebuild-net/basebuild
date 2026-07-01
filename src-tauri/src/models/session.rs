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
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind", content = "value")]
pub enum TabKind {
    Terminal,
    Omp,
    Source,
    Config,
}

impl TabKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TabKind::Terminal => "terminal",
            TabKind::Omp => "omp",
            TabKind::Source => "source",
            TabKind::Config => "config",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "omp" => TabKind::Omp,
            "source" => TabKind::Source,
            "config" => TabKind::Config,
            _ => TabKind::Terminal,
        }
    }
}

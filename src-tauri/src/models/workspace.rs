use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRestoreState {
    pub project_path: String,
    pub last_session_id: Option<String>,
    pub last_tab_id: Option<String>,
    pub side_section: Option<String>,
    pub sidebar_collapsed: bool,
    pub side_collapsed: bool,
    pub side_width: i64,
    pub updated_at: i64,
}

impl WorkspaceRestoreState {
    pub fn default_for(project_path: &str) -> Self {
        Self {
            project_path: project_path.to_string(),
            last_session_id: None,
            last_tab_id: None,
            side_section: Some("plans".to_string()),
            sidebar_collapsed: false,
            side_collapsed: false,
            side_width: 260,
            updated_at: 0,
        }
    }

    pub fn clamped(mut self) -> Self {
        self.side_width = self.side_width.clamp(180, 520);
        self
    }
}

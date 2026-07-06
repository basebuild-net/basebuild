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
    /// Per-tab chat grid layouts, keyed by tab id. Each value is the grid's
    /// JSON (`{rows, chatColumnWidths, rowHeights}`). Absent/null on legacy
    /// restore states — the frontend treats absent as a 1×1 grid built from
    /// the tab's chatSessionId. Added by `parallel-plan-workspaces`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_grid_states: Option<String>,
    /// JSON string of the `PanelGridState` (the unified panel grid split
    /// tree + closed panels + active panel id). Absent on legacy restore
    /// states — the frontend treats absent as a single-panel grid. Added
    /// by `project-grid-workspace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_grid: Option<String>,
    pub updated_at: i64,
}

impl WorkspaceRestoreState {
    pub fn default_for(project_path: &str) -> Self {
        Self {
            project_path: project_path.to_string(),
            last_session_id: None,
            last_tab_id: None,
            panel_grid: None,
            side_section: Some("plans".to_string()),
            sidebar_collapsed: false,
            side_collapsed: false,
            side_width: 260,
            tab_grid_states: None,
            updated_at: 0,
        }
    }

    pub fn clamped(mut self) -> Self {
        self.side_width = self.side_width.clamp(180, 520);
        self
    }
}

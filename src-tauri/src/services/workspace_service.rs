use rusqlite::{params, OptionalExtension};

use crate::{models::workspace::WorkspaceRestoreState, services::storage_service::StorageService};

type DbResult<T> = Result<T, String>;

#[derive(Debug, Default)]
pub struct WorkspaceService;

impl WorkspaceService {
    pub fn get_restore_state(project_path: &str) -> DbResult<WorkspaceRestoreState> {
        if project_path.trim().is_empty() {
            return Err("Project path is required.".to_string());
        }
        let conn = StorageService::connect()?;
        let state = conn
            .query_row(
                "SELECT project_path, last_session_id, last_tab_id, side_section, sidebar_collapsed, side_collapsed, side_width, tab_grid_states, panel_grid, updated_at
                 FROM workspace_restore_state WHERE project_path = ?1",
                params![project_path],
                |row| {
                    Ok(WorkspaceRestoreState {
                        project_path: row.get(0)?,
                        last_session_id: row.get(1)?,
                        last_tab_id: row.get(2)?,
                        side_section: row.get(3)?,
                        sidebar_collapsed: row.get::<_, i64>(4)? != 0,
                        side_collapsed: row.get::<_, i64>(5)? != 0,
                        side_width: row.get(6)?,
                        tab_grid_states: row.get(7)?,
                        panel_grid: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(state
            .unwrap_or_else(|| WorkspaceRestoreState::default_for(project_path))
            .clamped())
    }

    pub fn save_restore_state(state: WorkspaceRestoreState) -> DbResult<WorkspaceRestoreState> {
        if state.project_path.trim().is_empty() {
            return Err("Project path is required.".to_string());
        }
        let mut state = state.clamped();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO workspace_restore_state (
                project_path, last_session_id, last_tab_id, side_section, sidebar_collapsed, side_collapsed, side_width, tab_grid_states, panel_grid, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(project_path) DO UPDATE SET
                last_session_id = excluded.last_session_id,
                last_tab_id = excluded.last_tab_id,
                side_section = excluded.side_section,
                sidebar_collapsed = excluded.sidebar_collapsed,
                side_collapsed = excluded.side_collapsed,
                side_width = excluded.side_width,
                tab_grid_states = excluded.tab_grid_states,
                panel_grid = excluded.panel_grid,
                updated_at = excluded.updated_at",
            params![
                state.project_path,
                state.last_session_id,
                state.last_tab_id,
                state.side_section,
                state.sidebar_collapsed as i32,
                state.side_collapsed as i32,
                state.side_width,
                state.tab_grid_states,
                state.panel_grid,
                state.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to save workspace restore state: {e}"))?;
        Ok(state)
    }
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use crate::models::workspace::WorkspaceRestoreState;

    #[test]
    fn workspace_width_is_clamped() {
        let too_small = WorkspaceRestoreState { side_width: 20, ..WorkspaceRestoreState::default_for("C:/project") }.clamped();
        let too_large = WorkspaceRestoreState { side_width: 900, ..WorkspaceRestoreState::default_for("C:/project") }.clamped();
        assert_eq!(too_small.side_width, 180);
        assert_eq!(too_large.side_width, 520);
    }
}

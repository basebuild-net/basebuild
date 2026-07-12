use crate::services::idea_round_service::{IdeaRound, IdeaRoundService};
use crate::services::session_service::SessionService;

/// Resolve the project path for a session (rounds are recorded per project).
fn project_path_for(session_id: &str) -> String {
    SessionService::get(session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default()
}

#[tauri::command]
pub fn start_idea_round(session_id: String) -> Result<String, String> {
    let project_path = project_path_for(&session_id);
    IdeaRoundService::start_round(&session_id, &project_path)
}

#[tauri::command]
pub fn finish_idea_round(session_id: String) -> Result<Option<String>, String> {
    let project_path = project_path_for(&session_id);
    IdeaRoundService::finish_round(&session_id, &project_path)
}

#[tauri::command]
pub fn list_idea_rounds(session_id: String) -> Result<Vec<IdeaRound>, String> {
    IdeaRoundService::list_rounds(&session_id)
}

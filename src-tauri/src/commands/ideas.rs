use crate::{
    models::idea::{Idea, IdeaCategory, IdeaStatus},
    services::session_service::SessionService,
};

#[tauri::command]
pub fn create_category(session_id: String, name: String, description: String) -> Result<IdeaCategory, String> {
    SessionService::create_category(&session_id, &name, &description)
}

#[tauri::command]
pub fn list_categories(session_id: String) -> Result<Vec<IdeaCategory>, String> {
    SessionService::list_categories(&session_id)
}

#[tauri::command]
pub fn delete_category(id: String) -> Result<(), String> {
    SessionService::delete_category(&id)
}

#[tauri::command]
pub fn create_idea(session_id: String, title: String, description: String, category_id: Option<String>) -> Result<Idea, String> {
    SessionService::create_idea(&session_id, &title, &description, category_id.as_deref())
}

#[tauri::command]
pub fn list_ideas(session_id: String) -> Result<Vec<Idea>, String> {
    SessionService::list_ideas(&session_id)
}

#[tauri::command]
pub fn update_idea_status(id: String, status: String) -> Result<(), String> {
    SessionService::update_idea_status(&id, IdeaStatus::from_str(&status))
}

#[tauri::command]
pub fn delete_idea(id: String) -> Result<(), String> {
    SessionService::delete_idea(&id)
}

use crate::{
    models::planning_prompt::PlanningPromptEntry,
    services::planning_prompt_service::PlanningPromptService,
};

#[tauri::command]
pub fn planning_prompt_list() -> Result<Vec<PlanningPromptEntry>, String> {
    PlanningPromptService::list()
}

#[tauri::command]
pub fn planning_prompt_set(key: String, value: String) -> Result<(), String> {
    PlanningPromptService::set(&key, &value)
}

#[tauri::command]
pub fn planning_prompt_reset(key: String) -> Result<(), String> {
    PlanningPromptService::reset(&key)
}

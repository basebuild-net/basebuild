use crate::services::final_touches_service::{FinalTouchStep, FinalTouchStepInput, FinalTouchesService};

#[tauri::command]
pub fn final_touch_list_steps(project_path: String) -> Result<Vec<FinalTouchStep>, String> {
    FinalTouchesService::list_steps(&project_path)
}

#[tauri::command]
pub fn final_touch_create_step(input: FinalTouchStepInput) -> Result<FinalTouchStep, String> {
    FinalTouchesService::create_step(input)
}

#[tauri::command]
pub fn final_touch_update_step(
    id: String,
    input: FinalTouchStepInput,
) -> Result<FinalTouchStep, String> {
    FinalTouchesService::update_step(&id, input)
}

#[tauri::command]
pub fn final_touch_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    FinalTouchesService::set_enabled(&id, enabled)
}

#[tauri::command]
pub fn final_touch_reorder_step(id: String, new_order: i64) -> Result<(), String> {
    FinalTouchesService::reorder_step(&id, new_order)
}

#[tauri::command]
pub fn final_touch_delete_step(id: String) -> Result<(), String> {
    FinalTouchesService::delete_step(&id)
}

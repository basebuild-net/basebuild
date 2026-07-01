use crate::{
    models::requirement::RequirementStatus, services::requirement_service::RequirementService,
};

#[tauri::command]
pub fn list_requirements() -> Vec<RequirementStatus> {
    RequirementService::check_all()
}

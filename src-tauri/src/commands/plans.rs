use crate::{
    models::plan::{NewPlan, Plan, PlanFocusContext, PlanStatus},
    services::plan_service::PlanService,
};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanInput {
    pub session_id: String,
    pub title: String,
    pub description: String,
    pub goal: Option<String>,
    pub status: Option<String>,
    pub priority: Option<u8>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanInput {
    pub title: String,
    pub description: String,
    pub goal: Option<String>,
    pub status: String,
    pub priority: Option<u8>,
    pub tags: Vec<String>,
}

fn parse_status(s: &str) -> PlanStatus {
    PlanStatus::from_str(s)
}

#[tauri::command]
pub fn create_plan(input: CreatePlanInput) -> Result<Plan, String> {
    let plan = NewPlan {
        title: input.title,
        description: input.description,
        goal: input.goal,
        status: parse_status(input.status.as_deref().unwrap_or("draft")),
        priority: input.priority,
        tags: input.tags.unwrap_or_default(),
    };
    PlanService::create(&input.session_id, &plan)
}

#[tauri::command]
pub fn list_plans(session_id: String) -> Result<Vec<Plan>, String> {
    PlanService::list(&session_id)
}

#[tauri::command]
pub fn get_plan(id: String) -> Result<Option<Plan>, String> {
    PlanService::get(&id)
}

#[tauri::command]
pub fn update_plan(id: String, input: UpdatePlanInput) -> Result<Plan, String> {
    let plan = NewPlan {
        title: input.title,
        description: input.description,
        goal: input.goal,
        status: parse_status(&input.status),
        priority: input.priority,
        tags: input.tags,
    };
    PlanService::update(&id, &plan)
}

#[tauri::command]
pub fn set_plan_status(id: String, status: String) -> Result<Plan, String> {
    PlanService::set_status(&id, parse_status(&status))
}

#[tauri::command]
pub fn set_plan_context(id: String, context: PlanFocusContext) -> Result<Plan, String> {
    PlanService::set_context(&id, &context)
}

#[tauri::command]
pub fn delete_plan(id: String) -> Result<(), String> {
    PlanService::delete(&id)
}

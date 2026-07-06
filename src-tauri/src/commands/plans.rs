use crate::{
    models::plan::{NewPlan, Plan, PlanFocusContext, PlanStatus},
    services::{plan_service::PlanService, session_service::SessionService},
};

use serde::Deserialize;
use tauri::AppHandle;
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
    #[serde(default)]
    pub idea_id: Option<String>,
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
pub fn create_plan(app: AppHandle, input: CreatePlanInput) -> Result<Plan, String> {
    let plan = NewPlan {
        title: input.title,
        description: input.description,
        goal: input.goal,
        status: parse_status(input.status.as_deref().unwrap_or("draft")),
        priority: input.priority,
        tags: input.tags.unwrap_or_default(),
        idea_id: input.idea_id,
    };
    let created = PlanService::create(&input.session_id, &plan)?;
    let project_path = SessionService::get(&input.session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::PlanCreated,
        &created.id,
        &project_path,
        Some(input.session_id),
        &created.title,
        None,
    );
    Ok(created)
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
pub fn update_plan(app: AppHandle, id: String, input: UpdatePlanInput) -> Result<Plan, String> {
    let plan = NewPlan {
        title: input.title,
        description: input.description,
        goal: input.goal,
        status: parse_status(&input.status),
        priority: input.priority,
        tags: input.tags,
        idea_id: None,
    };
    let updated = PlanService::update(&id, &plan)?;
    let project_path = SessionService::get(&updated.session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::PlanUpdated,
        &updated.id,
        &project_path,
        Some(updated.session_id.clone()),
        &updated.title,
        None,
    );
    Ok(updated)
}

#[tauri::command]
pub async fn set_plan_status(app: AppHandle, id: String, status: String) -> Result<Plan, String> {
    let status = parse_status(&status);
    // draft → openspec: run the generate_openspec pipeline stage to write
    // artifacts atomically, set change_name, and only then flip status. On
    // failure, the plan stays in draft with a surfaced error.
    if status == PlanStatus::Openspec {
        let plan = PlanService::get(&id)?.ok_or("Plan not found".to_string())?;
        if plan.status != PlanStatus::Openspec {
            let session = SessionService::get(&plan.session_id)?
                .ok_or("Plan's session not found".to_string())?
                .project_path;
            let request = crate::models::pipeline::PipelineStartRequest {
                session_id: plan.session_id.clone(),
                project_path: session,
                kind: "generate_openspec".to_string(),
                idea_id: None,
                plan_id: Some(id.clone()),
                input: None,
                chat_session_id: None,
            };
            crate::services::pipeline_service::PipelineService::start_stage(&app, request)?;
        }
    }
    let plan = PlanService::get(&id)?.ok_or("Plan not found".to_string())?;
    let prev_status = plan.status;
    let updated = PlanService::set_status(&id, status)?;
    let project_path = SessionService::get(&updated.session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    let detail = if prev_status == status {
        None
    } else {
        Some(format!("{} → {}", prev_status.as_str(), status.as_str()))
    };
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::PlanStatusChanged,
        &updated.id,
        &project_path,
        Some(updated.session_id.clone()),
        &updated.title,
        detail,
    );
    Ok(updated)
}
#[tauri::command]
pub fn set_plan_context(id: String, context: PlanFocusContext) -> Result<Plan, String> {
    PlanService::set_context(&id, &context)
}

#[tauri::command]
pub fn delete_plan(id: String) -> Result<(), String> {
    PlanService::delete(&id)
}

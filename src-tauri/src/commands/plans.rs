use crate::{
    models::plan::{BatchPromoteResult, NewPlan, Plan, PlanFocusContext, PlanStatus},
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
pub fn list_project_plans(project_path: String) -> Result<Vec<Plan>, String> {
    PlanService::list_for_project(&project_path)
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
    // draft → openspec: kick off the generate_openspec pipeline stage in the
    // background. The plan status flips to "openspec" immediately so the UI
    // reflects the transition without waiting for 4 model calls. The pipeline
    // run shows up in BackgroundAgents via the StageStarted planning event.
    // If the stage fails, the plan reverts to draft with an error event.
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
            // Set status to openspec immediately.
            let updated = PlanService::set_status(&id, PlanStatus::Openspec)?;
            let project_path = SessionService::get(&updated.session_id)
                .ok()
                .flatten()
                .map(|s| s.project_path)
                .unwrap_or_default();
            crate::services::planning_events::emit(
                &app,
                crate::models::planning_event::PlanningEventKind::PlanStatusChanged,
                &updated.id,
                &project_path,
                Some(updated.session_id.clone()),
                &updated.title,
                Some(format!("{} → openspec", plan.status.as_str())),
            );
            // Spawn the pipeline stage detached — it runs in the background
            // and emits its own StageStarted/StageSucceeded/StageFailed events.
            let stage_app = app.clone();
            let plan_id = id.clone();
            let plan_title = updated.title.clone();
            let plan_session = updated.session_id.clone();
            tauri::async_runtime::spawn(async move {
                let fail_app = stage_app.clone();
                let run = tauri::async_runtime::spawn_blocking(move || {
                    crate::services::pipeline_service::PipelineService::start_stage(
                        &stage_app, request,
                    )
                })
                .await;
                let failed = match run {
                    Ok(Ok(result)) => result.status != "succeeded",
                    Ok(Err(_)) => true,
                    Err(_) => true,
                };
                if failed {
                    // Revert the plan to draft so the user can retry.
                    let _ = PlanService::set_status(&plan_id, PlanStatus::Draft);
                    let _ = crate::services::planning_events::emit(
                        &fail_app,
                        crate::models::planning_event::PlanningEventKind::PlanStatusChanged,
                        &plan_id,
                        &project_path,
                        Some(plan_session),
                        &plan_title,
                        Some("openspec → draft (generation failed)".to_string()),
                    );
                }
            });
            return Ok(updated);
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

/// Batch-promote multiple ideas to plans. Returns created plans and per-idea
/// errors (idea_id, error message). Emits a planning event per created plan.
#[tauri::command]
pub fn batch_promote_ideas(
    app: AppHandle,
    session_id: String,
    idea_ids: Vec<String>,
) -> Result<BatchPromoteResult, String> {
    let (created, errors) = PlanService::batch_promote_ideas(&session_id, &idea_ids)?;
    // Emit a planning event per created plan so the UI refreshes.
    for plan in &created {
        let _ = crate::services::planning_events::emit(
            &app,
            crate::models::planning_event::PlanningEventKind::PlanCreated,
            plan.id.clone(),
            "", // project_path — not available here; the event is session-scoped
            Some(session_id.clone()),
            plan.title.clone(),
            Some(format!("Batch-promoted {} plan(s)", created.len())),
        );
    }
    let errors: Vec<crate::models::plan::BatchPromoteError> = errors
        .into_iter()
        .map(|(idea_id, error)| crate::models::plan::BatchPromoteError { idea_id, error })
        .collect();
    Ok(BatchPromoteResult { created, errors })
}

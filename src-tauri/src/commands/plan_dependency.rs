use tauri::Runtime;

use crate::{
    models::plan_dependency::{
        AssignWithProfileRequest, DependencyGraph, FileClaim, LaunchProfile, MergeReviewEntry,
        PlanDependencies, PublishEventRequest, SetDependenciesRequest, SetFileClaimRequest,
        ValidationResult,
    },
    services::plan_dependency_service::PlanDependencyService,
};

type AppResult<T> = Result<T, String>;

#[tauri::command]
pub async fn plan_set_dependencies(request: SetDependenciesRequest) -> AppResult<crate::models::plan::Plan> {
    PlanDependencyService::set_dependencies(&request)
}

#[tauri::command]
pub async fn plan_get_dependencies(planId: String) -> AppResult<PlanDependencies> {
    PlanDependencyService::get_dependencies(&planId)
}

#[tauri::command]
pub async fn plan_dependency_graph(sessionId: String) -> AppResult<DependencyGraph> {
    PlanDependencyService::build_graph(&sessionId)
}

#[tauri::command]
pub async fn plan_validate_readiness(planId: String) -> AppResult<ValidationResult> {
    PlanDependencyService::validate_readiness(&planId)
}

#[tauri::command]
pub async fn plan_file_claims_set(request: SetFileClaimRequest) -> AppResult<()> {
    PlanDependencyService::set_file_claims(
        &request.run_id,
        &request.plan_id,
        &request.session_id,
        &request.paths,
        &request.action,
    )
}

#[tauri::command]
pub async fn plan_file_claims_list(sessionId: String) -> AppResult<Vec<FileClaim>> {
    PlanDependencyService::list_file_claims(&sessionId)
}

#[tauri::command]
pub async fn plan_coordination_event_publish(
    request: PublishEventRequest,
) -> AppResult<crate::models::plan_dependency::CoordinationEvent> {
    PlanDependencyService::publish_event(
        &request.session_id,
        &request.run_id,
        &request.plan_id,
        &request.kind,
        &request.payload,
    )
}

#[tauri::command]
pub async fn plan_coordination_events(
    sessionId: String,
    since: Option<i64>,
) -> AppResult<Vec<crate::models::plan_dependency::CoordinationEvent>> {
    PlanDependencyService::list_events(&sessionId, since)
}

#[tauri::command]
pub async fn plan_set_launch_profile(profile: LaunchProfile) -> AppResult<()> {
    PlanDependencyService::set_launch_profile(&profile)
}

#[tauri::command]
pub async fn plan_get_launch_profile(projectPath: String) -> AppResult<Option<LaunchProfile>> {
    PlanDependencyService::get_launch_profile(&projectPath)
}

#[tauri::command]
pub async fn plan_merge_queue_list(sessionId: String) -> AppResult<Vec<MergeReviewEntry>> {
    PlanDependencyService::list_merge_queue(&sessionId)
}

#[tauri::command]
pub async fn plan_merge_queue_review(
    entryId: String,
    decision: String,
) -> AppResult<MergeReviewEntry> {
    PlanDependencyService::review_merge_entry(&entryId, &decision)
}

#[tauri::command]
pub async fn plan_assign_with_profile<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: AssignWithProfileRequest,
) -> AppResult<crate::models::plan_run::PlanRun> {
    // Save the profile as project defaults.
    PlanDependencyService::set_launch_profile(&request.profile)?;

    // Set dependencies metadata from the profile (workspace policy, scheduling mode).
    let session = crate::services::session_service::SessionService::get(
        &crate::services::plan_service::PlanService::get(&request.plan_id)?
            .ok_or("Plan not found")?
            .session_id,
    )
    .ok()
    .flatten();
    let _ = session;

    // Assign the plan to the chat session using the existing assign path,
    // which creates a real run (not just a status flip).
    crate::services::plan_runner_service::PlanRunnerService::assign_to_chat(
        &app,
        &request.plan_id,
        &request.chat_session_id,
    )
}

use tauri::AppHandle;

use crate::{
    models::plan_run::{EnqueuePlanRequest, PlanQueueEntry, PlanRun, StartQueueRequest},
    services::plan_runner_service::PlanRunnerService,
};

#[tauri::command]
pub fn plan_run_enqueue(request: EnqueuePlanRequest) -> Result<PlanQueueEntry, String> {
    PlanRunnerService::enqueue(request)
}

#[tauri::command]
pub fn plan_run_list_queue(session_id: String) -> Result<Vec<PlanQueueEntry>, String> {
    PlanRunnerService::list_queue(&session_id)
}

#[tauri::command]
pub fn plan_run_reorder(session_id: String, entry_id: String, new_order: i64) -> Result<(), String> {
    PlanRunnerService::reorder(&session_id, &entry_id, new_order)
}

#[tauri::command]
pub fn plan_run_remove(entry_id: String) -> Result<(), String> {
    PlanRunnerService::remove_from_queue(&entry_id)
}

#[tauri::command]
pub fn plan_run_start(app: AppHandle, request: StartQueueRequest) -> Result<(), String> {
    PlanRunnerService::start_queue(app, request)
}

#[tauri::command]
pub fn plan_run_pause(session_id: String) -> Result<(), String> {
    PlanRunnerService::pause_queue(&session_id)
}

#[tauri::command]
pub fn plan_run_cancel(app: AppHandle, run_id: String, cancel_plan: bool) -> Result<(), String> {
    PlanRunnerService::cancel_run(&app, &run_id, cancel_plan)
}

#[tauri::command]
pub fn plan_run_complete(app: AppHandle, run_id: String, succeeded: bool) -> Result<(), String> {
    PlanRunnerService::complete_run(&app, &run_id, succeeded)
}

#[tauri::command]
pub fn plan_run_check_completion(app: AppHandle, run_id: String) -> Result<(u32, u32), String> {
    PlanRunnerService::check_run_completion(&app, &run_id)
}

#[tauri::command]
pub fn plan_run_start_omp(
    app: AppHandle,
    session_id: String,
    plan_id: String,
) -> Result<PlanRun, String> {
    PlanRunnerService::start_omp_run(&app, &session_id, &plan_id)
}

#[tauri::command]
pub fn plan_run_list(session_id: String) -> Result<Vec<PlanRun>, String> {
    PlanRunnerService::list_runs(&session_id)
}

#[tauri::command]
pub fn plan_run_get(run_id: String) -> Result<Option<PlanRun>, String> {
    PlanRunnerService::get_run(&run_id)
}

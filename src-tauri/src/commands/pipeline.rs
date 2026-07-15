use tauri::AppHandle;

use crate::{
    models::pipeline::{PipelineRun, PipelineStartRequest},
    services::pipeline_service::PipelineService,
};

#[tauri::command]
pub fn pipeline_start(
    app: AppHandle,
    request: PipelineStartRequest,
) -> Result<PipelineRun, String> {
    PipelineService::start_stage(&app, request)
}

#[tauri::command]
pub fn pipeline_cancel(app: AppHandle, run_id: String) -> Result<(), String> {
    PipelineService::cancel_run(&app, &run_id)
}

#[tauri::command]
pub fn pipeline_list_runs(session_id: String) -> Result<Vec<PipelineRun>, String> {
    PipelineService::list_runs(&session_id)
}

#[tauri::command]
pub fn pipeline_list_runs_by_project(project_path: String) -> Result<Vec<PipelineRun>, String> {
    PipelineService::list_runs_by_project(&project_path)
}

#[tauri::command]
pub fn pipeline_get_run(run_id: String) -> Result<Option<PipelineRun>, String> {
    PipelineService::get_run(&run_id)
}

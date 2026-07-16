use serde::Deserialize;

use crate::{
    models::execution_advisor::{ExecutionAdviceBundle, ExecutionRole},
    services::execution_advisor_service::ExecutionAdvisorService,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionAdviceRequest {
    pub project_path: String,
    pub plan_id: Option<String>,
    pub idea_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionOverrideRequest {
    pub project_path: String,
    pub role: ExecutionRole,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearExecutionOverrideRequest {
    pub project_path: String,
    pub role: ExecutionRole,
}

#[tauri::command]
pub async fn execution_advice_get(
    input: ExecutionAdviceRequest,
) -> Result<ExecutionAdviceBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ExecutionAdvisorService::get_advice(
            &input.project_path,
            input.plan_id.as_deref(),
            input.idea_id.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Execution advisor task failed: {error}"))?
}

#[tauri::command]
pub fn execution_advice_set_override(input: ExecutionOverrideRequest) -> Result<(), String> {
    ExecutionAdvisorService::set_override(
        &input.project_path,
        input.role,
        &input.provider_id,
        &input.model_id,
    )
}

#[tauri::command]
pub fn execution_advice_clear_override(
    input: ClearExecutionOverrideRequest,
) -> Result<(), String> {
    ExecutionAdvisorService::clear_override(&input.project_path, input.role)
}

use serde::Deserialize;

use crate::{
    models::execution_advisor::{
        AdvisorFeedbackConsent, AdvisorFeedbackEvent, ExecutionAdviceBundle, ExecutionRole,
        NewAdvisorFeedbackEvent,
    },
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackConsentRequest {
    pub enabled: bool,
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
pub fn execution_advice_clear_override(input: ClearExecutionOverrideRequest) -> Result<(), String> {
    ExecutionAdvisorService::clear_override(&input.project_path, input.role)
}

#[tauri::command]
pub fn execution_advice_feedback_consent() -> Result<AdvisorFeedbackConsent, String> {
    ExecutionAdvisorService::feedback_consent()
}

#[tauri::command]
pub fn execution_advice_set_feedback_consent(
    input: FeedbackConsentRequest,
) -> Result<AdvisorFeedbackConsent, String> {
    ExecutionAdvisorService::set_feedback_consent(input.enabled)
}

#[tauri::command]
pub fn execution_advice_record_feedback(
    input: NewAdvisorFeedbackEvent,
) -> Result<AdvisorFeedbackEvent, String> {
    ExecutionAdvisorService::record_feedback(input)
}

#[tauri::command]
pub fn execution_advice_list_feedback() -> Result<Vec<AdvisorFeedbackEvent>, String> {
    ExecutionAdvisorService::list_feedback()
}

#[tauri::command]
pub fn execution_advice_export_feedback() -> Result<String, String> {
    ExecutionAdvisorService::export_feedback()
}

#[tauri::command]
pub fn execution_advice_delete_feedback() -> Result<usize, String> {
    ExecutionAdvisorService::delete_feedback()
}

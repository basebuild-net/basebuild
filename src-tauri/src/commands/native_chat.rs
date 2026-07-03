use tauri::AppHandle;

use crate::{
    models::native_chat::{
        NativeChatMessage, NativeChatSendRequest, NativeChatSendResult, NativeChatSession,
        NativeChatStartRequest, NativeGenerateIdeasRequest, NativeGenerateIdeasResult,
        NativeProviderCatalog, NativeProviderCatalogRefreshRequest, NativeProviderCredential,
        NativeProviderCredentialInput, NativeRequestMetric, NativeRequestMetricsSummary,
        NativeToolApprovalRequest, NativeToolApprovalResult,
    },
    services::native_chat_service::NativeChatService,
};

#[tauri::command]
pub fn native_provider_catalog() -> Result<NativeProviderCatalog, String> {
    Ok(NativeChatService::provider_catalog())
}

#[tauri::command]
pub fn native_provider_catalog_refresh(
    request: Option<NativeProviderCatalogRefreshRequest>,
) -> Result<NativeProviderCatalog, String> {
    crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh(
        request.as_ref().and_then(|r| r.provider_id.clone()),
        request.and_then(|r| r.force).unwrap_or(false),
    )
}

#[tauri::command]
pub fn native_chat_start(request: NativeChatStartRequest) -> Result<NativeChatSession, String> {
    NativeChatService::start_session(request)
}

#[tauri::command]
pub fn native_chat_get(session_id: String) -> Result<Option<NativeChatSession>, String> {
    NativeChatService::get_session(&session_id)
}

#[tauri::command]
pub fn native_chat_list(project_path: String) -> Result<Vec<NativeChatSession>, String> {
    NativeChatService::list_sessions(&project_path)
}

#[tauri::command]
pub fn native_chat_messages(session_id: String) -> Result<Vec<NativeChatMessage>, String> {
    NativeChatService::list_messages(&session_id)
}

#[tauri::command]
pub fn native_chat_send(
    app: AppHandle,
    request: NativeChatSendRequest,
) -> Result<NativeChatSendResult, String> {
    NativeChatService::send_message(&app, request)
}

#[tauri::command]
pub fn native_generate_ideas(
    app: AppHandle,
    request: NativeGenerateIdeasRequest,
) -> Result<NativeGenerateIdeasResult, String> {
    NativeChatService::generate_ideas(&app, request)
}

#[tauri::command]
pub fn native_request_metrics(limit: Option<u32>) -> Result<Vec<NativeRequestMetric>, String> {
    NativeChatService::list_metrics(limit.unwrap_or(100))
}

#[tauri::command]
pub fn native_request_metrics_summary() -> Result<NativeRequestMetricsSummary, String> {
    NativeChatService::metrics_summary()
}

#[tauri::command]
pub fn native_request_tool_approval(
    request: NativeToolApprovalRequest,
) -> Result<NativeToolApprovalResult, String> {
    NativeChatService::request_tool_approval(request)
}

#[tauri::command]
pub fn native_save_provider_credential(
    input: NativeProviderCredentialInput,
) -> Result<NativeProviderCredential, String> {
    NativeChatService::save_credential(input)
}

#[tauri::command]
pub fn native_list_provider_credentials() -> Result<Vec<NativeProviderCredential>, String> {
    NativeChatService::list_credentials()
}

#[tauri::command]
pub fn native_delete_provider_credential(provider_id: String) -> Result<(), String> {
    NativeChatService::delete_credential(&provider_id)
}

#[tauri::command]
pub fn native_provider_login_start(
    provider_id: String,
) -> Result<crate::models::native_chat::ProviderLoginStart, String> {
    crate::services::provider_login_service::ProviderLoginService::start(&provider_id)
}

#[tauri::command]
pub fn native_provider_login_poll(
    provider_id: String,
) -> Result<crate::models::native_chat::ProviderLoginPoll, String> {
    Ok(crate::services::provider_login_service::ProviderLoginService::poll(&provider_id))
}

#[tauri::command]
pub fn native_provider_login_cancel(provider_id: String) -> Result<(), String> {
    crate::services::provider_login_service::ProviderLoginService::cancel(&provider_id);
    Ok(())
}

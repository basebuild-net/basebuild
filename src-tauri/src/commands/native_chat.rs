use crate::{
    models::native_chat::{
        NativeChatMessage, NativeChatSendRequest, NativeChatSendResult, NativeChatSession,
        NativeChatStartRequest, NativeProviderCatalog, NativeProviderCredential,
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
pub fn native_chat_send(request: NativeChatSendRequest) -> Result<NativeChatSendResult, String> {
    NativeChatService::send_message(request)
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

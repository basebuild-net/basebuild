use tauri::AppHandle;

use crate::{
    models::native_chat::{
        ChatModelDefault, NativeChatBootstrap, NativeChatHistoryEntry, NativeChatMessage,
        NativeChatSendRequest, NativeChatSendResult, NativeChatSession, NativeChatStartRequest,
        NativeGenerateIdeasRequest, NativeGenerateIdeasResult, NativeProviderCatalog,
        NativeProviderCatalogRefreshRequest, NativeProviderCredentialInput,
        NativeProviderLoginState, NativeRequestMetric, NativeRequestMetricsSummary,
        NativeToolApprovalRequest, NativeToolApprovalResult, NativeToolEvent,
        ResolvedChatModelDefault,
    },
    models::permission::{PermissionDecision, SessionRule},
    services::native_chat_service::NativeChatService,
};

#[tauri::command]
pub async fn native_provider_catalog() -> Result<NativeProviderCatalog, String> {
    tauri::async_runtime::spawn_blocking(NativeChatService::provider_catalog)
        .await
        .map_err(|error| format!("Provider-catalog task panicked: {error}"))
}

#[tauri::command]
pub async fn native_chat_bootstrap(project_path: String) -> Result<NativeChatBootstrap, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::bootstrap(&project_path))
        .await
        .map_err(|error| format!("Chat-bootstrap task panicked: {error}"))?
}

#[tauri::command]
pub async fn native_provider_catalog_refresh(
    request: Option<NativeProviderCatalogRefreshRequest>,
) -> Result<NativeProviderCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh(
            request.as_ref().and_then(|r| r.provider_id.clone()),
            request.and_then(|r| r.force).unwrap_or(false),
        )
    })
    .await
    .map_err(|e| format!("Catalog refresh task panicked: {e}"))?
}

#[tauri::command]
pub async fn native_catalog_sync(
) -> Result<crate::services::catalog_sync_service::CatalogSyncResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = crate::services::catalog_sync_service::sync_catalog();
        crate::services::provider_model_catalog_service::ProviderModelCatalogService::invalidate();
        result
    })
    .await
    .map_err(|e| format!("Catalog sync task panicked: {e}"))
}
#[tauri::command]
pub fn native_chat_start(request: NativeChatStartRequest) -> Result<NativeChatSession, String> {
    NativeChatService::start_session(request)
}

#[tauri::command]
pub async fn native_chat_get(session_id: String) -> Result<Option<NativeChatSession>, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::get_session(&session_id))
        .await
        .map_err(|error| format!("Chat-session task panicked: {error}"))?
}

#[tauri::command]
pub async fn native_chat_rename(session_id: String, title: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        NativeChatService::rename_session(&session_id, &title)
    })
    .await
    .map_err(|error| format!("Chat-rename task panicked: {error}"))?
}

#[tauri::command]
pub fn native_chat_update_session_model(
    session_id: String,
    provider_id: String,
    model_id: String,
    effort_level: String,
) -> Result<NativeChatSession, String> {
    NativeChatService::update_session_model(&session_id, &provider_id, &model_id, &effort_level)
}

#[tauri::command]
pub fn native_chat_list(project_path: String) -> Result<Vec<NativeChatSession>, String> {
    NativeChatService::list_sessions(&project_path)
}

#[tauri::command]
pub fn native_chat_history(limit: Option<i64>) -> Result<Vec<NativeChatHistoryEntry>, String> {
    NativeChatService::chat_history(limit)
}

#[tauri::command]
pub async fn native_chat_messages(session_id: String) -> Result<Vec<NativeChatMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::list_messages(&session_id))
        .await
        .map_err(|error| format!("Chat-message task panicked: {error}"))?
}

/// Delete all persisted messages and tool events for a chat session.
/// Preserves the session record and its provider/model/effort selection.
/// Returns the count of deleted messages.
#[tauri::command]
pub fn native_chat_clear_messages(session_id: String) -> Result<usize, String> {
    NativeChatService::clear_session_messages(&session_id)
}

#[tauri::command]
pub async fn native_chat_send(
    app: AppHandle,
    request: NativeChatSendRequest,
) -> Result<NativeChatSendResult, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::send_message(&app, request))
        .await
        .map_err(|e| format!("Chat send task panicked: {e}"))?
}
#[tauri::command]
pub async fn native_generate_ideas(
    app: AppHandle,
    request: NativeGenerateIdeasRequest,
) -> Result<NativeGenerateIdeasResult, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::generate_ideas(&app, request))
        .await
        .map_err(|e| format!("Generate ideas task panicked: {e}"))?
}

#[tauri::command]
pub fn native_request_metrics(limit: Option<u32>) -> Result<Vec<NativeRequestMetric>, String> {
    NativeChatService::list_metrics(limit.unwrap_or(100))
}

#[tauri::command]
pub async fn native_session_latest_metric(
    session_id: String,
) -> Result<Option<NativeRequestMetric>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        NativeChatService::latest_metric_for_session(&session_id)
    })
    .await
    .map_err(|error| format!("Session-metric task panicked: {error}"))?
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
pub fn native_chat_cancel(app: AppHandle, session_id: String) -> Result<bool, String> {
    crate::services::plan_lifecycle_service::PlanLifecycleService::stop_chat(&app, &session_id)
}

/// Resolve a pending tool-call approval. Called by the UI's inline approval
/// card. `decision` is "allow", "allow_session", or "deny". When "allow_session",
/// a session rule is added so subsequent matching calls skip the prompt.
/// `command_prefix` is only used for run_command session rules.
#[tauri::command]
pub fn native_chat_resolve_approval(
    tool_call_id: String,
    decision: String,
    command_prefix: Option<String>,
) -> Result<bool, String> {
    let (perm_decision, session_rule) = match decision.as_str() {
        "allow" => (PermissionDecision::Allow, None),
        "allow_session" => {
            // Session rule: the tool name is read from the pending approval.
            // We use a permissive tool_name and let the gateway match; the UI
            // passes command_prefix for run_command scoping.
            (
                PermissionDecision::Allow,
                Some(SessionRule {
                    tool_name: "*".to_string(),
                    command_prefix,
                    decision: PermissionDecision::Allow,
                }),
            )
        }
        _ => (PermissionDecision::Deny, None),
    };
    let resolution = crate::services::agent_loop_service::ApprovalResolution {
        decision: perm_decision,
        session_rule,
    };
    Ok(crate::services::agent_loop_service::resolve_approval(
        &tool_call_id,
        resolution,
    ))
}

#[tauri::command]
pub async fn native_chat_tool_events(session_id: String) -> Result<Vec<NativeToolEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || NativeChatService::list_tool_events(&session_id))
        .await
        .map_err(|error| format!("Chat-tool-event task panicked: {error}"))?
}

#[tauri::command]
pub fn native_save_provider_credential(input: NativeProviderCredentialInput) -> Result<(), String> {
    NativeChatService::save_credential(input).map(|_| ())
}

#[tauri::command]
pub fn native_delete_provider_credential(provider_id: String) -> Result<(), String> {
    NativeChatService::delete_credential(&provider_id)
}

/// Re-read the active OMP profile and refresh the provider catalog after an
/// in-app or external OMP login.
#[tauri::command]
pub fn native_provider_refresh_omp_credentials(
    provider_id: Option<String>,
) -> Result<crate::models::native_chat::NativeProviderCatalog, String> {
    crate::services::native_chat_service::NativeChatService::refresh_omp_credential_cache();
    crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh(
        provider_id,
        true,
    )
}

#[tauri::command]
pub fn native_provider_login_start(
    provider_id: String,
) -> Result<NativeProviderLoginState, String> {
    crate::services::provider_login_service::ProviderLoginService::start(&provider_id)
}

#[tauri::command]
pub fn native_provider_login_poll(provider_id: String) -> Result<NativeProviderLoginState, String> {
    crate::services::provider_login_service::ProviderLoginService::poll(&provider_id)
}

#[tauri::command]
pub fn native_provider_login_submit(
    provider_id: String,
    value: String,
) -> Result<NativeProviderLoginState, String> {
    crate::services::provider_login_service::ProviderLoginService::submit(&provider_id, &value)
}

#[tauri::command]
pub async fn native_chat_model_default(
    project_path: String,
) -> Result<ResolvedChatModelDefault, String> {
    tauri::async_runtime::spawn_blocking(move || {
        NativeChatService::resolve_model_default(&project_path)
    })
    .await
    .map_err(|error| format!("Chat-model-default task panicked: {error}"))?
}

#[tauri::command]
pub fn native_chat_set_project_model_default(
    project_path: String,
    default: ChatModelDefault,
) -> Result<(), String> {
    NativeChatService::set_project_model_default(&project_path, &default)
}

#[tauri::command]
pub fn native_chat_set_global_model_default(default: ChatModelDefault) -> Result<(), String> {
    NativeChatService::set_global_model_default(&default)
}

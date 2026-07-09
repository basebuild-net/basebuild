use tauri::AppHandle;

use crate::{
    models::native_chat::{
        ChatModelDefault, NativeChatMessage, NativeChatSendRequest, NativeChatSendResult,
        NativeChatSession, NativeChatStartRequest, NativeGenerateIdeasRequest,
        NativeGenerateIdeasResult, NativeProviderCatalog, NativeProviderCatalogRefreshRequest,
        NativeProviderCredential, NativeProviderCredentialInput, NativeRequestMetric,
        NativeRequestMetricsSummary, NativeToolApprovalRequest, NativeToolApprovalResult,
        NativeToolEvent, ResolvedChatModelDefault,
    },
    models::permission::{PermissionDecision, SessionRule},
    services::native_chat_service::NativeChatService,
};

#[tauri::command]
pub fn native_provider_catalog() -> Result<NativeProviderCatalog, String> {
    Ok(NativeChatService::provider_catalog())
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
pub async fn native_catalog_sync() -> Result<crate::services::catalog_sync_service::CatalogSyncResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::services::catalog_sync_service::sync_catalog()
    })
    .await
    .map_err(|e| format!("Catalog sync task panicked: {e}"))
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
pub fn native_chat_messages(session_id: String) -> Result<Vec<NativeChatMessage>, String> {
    NativeChatService::list_messages(&session_id)
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
    tauri::async_runtime::spawn_blocking(move || {
        NativeChatService::send_message(&app, request)
    })
    .await
    .map_err(|e| format!("Chat send task panicked: {e}"))?
}
#[tauri::command]
pub async fn native_generate_ideas(
    app: AppHandle,
    request: NativeGenerateIdeasRequest,
) -> Result<NativeGenerateIdeasResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        NativeChatService::generate_ideas(&app, request)
    })
    .await
    .map_err(|e| format!("Generate ideas task panicked: {e}"))?
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
pub fn native_chat_cancel(session_id: String) -> Result<bool, String> {
    Ok(crate::services::agent_loop_service::cancel_run(&session_id))
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
            (PermissionDecision::Allow, Some(SessionRule {
                tool_name: "*".to_string(),
                command_prefix,
                decision: PermissionDecision::Allow,
            }))
        }
        _ => (PermissionDecision::Deny, None),
    };
    let resolution = crate::services::agent_loop_service::ApprovalResolution {
        decision: perm_decision,
        session_rule,
    };
    Ok(crate::services::agent_loop_service::resolve_approval(&tool_call_id, resolution))
}

#[tauri::command]
pub fn native_chat_tool_events(session_id: String) -> Result<Vec<NativeToolEvent>, String> {
    NativeChatService::list_tool_events(&session_id)
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

/// Returns the `omp login <provider>` command string for the frontend to
/// run in a terminal tab. Returns an error if OMP is not installed.
#[tauri::command]
pub fn native_provider_omp_login_command(provider_id: String) -> Result<String, String> {
    if !crate::services::provider_client::omp_available() {
        return Err(
            "Oh My Pi (OMP) is not installed. Install OMP to authenticate with this provider."
                .to_string(),
        );
    }
    Ok(format!("omp login {provider_id}"))
}

/// Re-reads OMP credentials and refreshes the provider's model catalog.
/// Called by the frontend after `omp login <provider>` completes in a
/// terminal tab.
#[tauri::command]
pub fn native_provider_refresh_omp_credentials(
    provider_id: String,
) -> Result<crate::models::native_chat::NativeProviderCatalog, String> {
    // Refresh the provider's catalog (picks up new credentials from OMP).
    crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(
        &provider_id, true,
    )?;
    // Return the updated catalog.
    Ok(crate::services::native_chat_service::NativeChatService::provider_catalog())
}

#[tauri::command]
pub fn native_chat_model_default(project_path: String) -> Result<ResolvedChatModelDefault, String> {
    NativeChatService::resolve_model_default(&project_path)
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


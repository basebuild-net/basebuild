//! Tauri commands for the MCP client.
//!
//! Commands are async because the underlying `McpService` connection and
//! tool-call methods are async (rmcp uses tokio). Tauri 2 runs async commands
//! on its async runtime.

use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;
use crate::models::native_chat::NativeToolApprovalRequest;
use crate::services::mcp_oauth_service::{McpOAuthPoll, McpOAuthStart};
use crate::services::mcp_service::{LoadResult, NamespacedPrompt, NamespacedTool, ServerState};
use crate::services::native_chat_service::NativeChatService;

/// Event channel for MCP tool-call lifecycle events (approval prompts, results).
const MCP_TOOL_EVENT: &str = "mcp://tool-event";

/// Load MCP configs for a project and (re)connect enabled servers.
/// Returns the load result so the UI can surface validation errors.
#[tauri::command]
pub async fn mcp_reload(app: AppHandle, project_path: String) -> Result<LoadResult, String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    let result = svc.reload().await;
    // Broadcast updated server list.
    let _ = app.emit("mcp://servers-changed", &project_path);
    Ok(result)
}

/// List all discovered MCP servers with their connection state.
#[tauri::command]
pub async fn mcp_list_servers(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<ServerState>, String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    Ok(svc.list_servers())
}

/// List all tools from connected servers, namespaced `mcp:<server>/<tool>`.
#[tauri::command]
pub async fn mcp_list_tools(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<NamespacedTool>, String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    Ok(svc.list_tools())
}

/// List all prompts from connected servers as slash commands.
#[tauri::command]
pub async fn mcp_list_prompts(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<NamespacedPrompt>, String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    Ok(svc.list_prompts())
}

/// Disconnect a specific server (disabling it for the session).
#[tauri::command]
pub async fn mcp_disconnect(
    app: AppHandle,
    project_path: String,
    server_name: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    svc.disconnect(&server_name).await;
    let _ = app.emit("mcp://servers-changed", &project_path);
    Ok(())
}

/// Call an MCP tool. Routes through the approval gateway before execution.
/// Emits an `mcp://tool-event` with the approval request, and on approval
/// executes the tool and emits the result.
#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    project_path: String,
    server_name: String,
    tool_name: String,
    arguments: serde_json::Value,
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    // 1. Check the approval gateway.
    let approval = NativeChatService::request_tool_approval(NativeToolApprovalRequest {
        action: "command".to_string(),
        scope: Some(format!("mcp:{server_name}/{tool_name}")),
        source_workflow: Some("native_chat".to_string()),
    })?;

    // Emit the approval decision so the UI can show it.
    let _ = app.emit(
        MCP_TOOL_EVENT,
        serde_json::json!({
            "type": "approval",
            "server": &server_name,
            "tool": &tool_name,
            "decision": &approval.decision,
            "reason": &approval.reason,
            "sessionId": session_id,
        }),
    );

    if approval.decision == "deny" {
        return Ok(serde_json::json!({
            "ok": false,
            "denied": true,
            "reason": approval.reason,
        }));
    }

    // 2. Execute the tool call.
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    let result = svc.call_tool(&server_name, &tool_name, arguments).await;

    match &result {
        Ok(value) => {
            let _ = app.emit(
                MCP_TOOL_EVENT,
                serde_json::json!({
                    "type": "result",
                    "server": &server_name,
                    "tool": &tool_name,
                    "ok": true,
                    "result": value,
                    "sessionId": session_id,
                }),
            );
        }
        Err(e) => {
            let _ = app.emit(
                MCP_TOOL_EVENT,
                serde_json::json!({
                    "type": "result",
                    "server": &server_name,
                    "tool": &tool_name,
                    "ok": false,
                    "error": e,
                    "sessionId": session_id,
                }),
            );
        }
    }

    result
}

/// Get an MCP prompt from a connected server (for slash-command injection).
#[tauri::command]
pub async fn mcp_get_prompt(
    app: AppHandle,
    project_path: String,
    server_name: String,
    prompt_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    svc.get_prompt(&server_name, &prompt_name, arguments).await
}

/// Start an OAuth flow for an HTTP/SSE MCP server.
#[tauri::command]
pub async fn mcp_oauth_start(server_url: String) -> Result<McpOAuthStart, String> {
    crate::services::mcp_oauth_service::McpOAuthService::start_flow(&server_url).await
}

/// Poll an in-flight OAuth flow.
#[tauri::command]
pub async fn mcp_oauth_poll(server_url: String) -> Result<McpOAuthPoll, String> {
    Ok(crate::services::mcp_oauth_service::McpOAuthService::poll_flow(&server_url))
}

/// Cancel an in-flight OAuth flow.
#[tauri::command]
pub async fn mcp_oauth_cancel(server_url: String) -> Result<(), String> {
    crate::services::mcp_oauth_service::McpOAuthService::cancel_flow(&server_url);
    Ok(())
}

/// Clear the stored OAuth token for a server URL.
#[tauri::command]
pub async fn mcp_oauth_clear(server_url: String) -> Result<(), String> {
    crate::services::mcp_oauth_service::McpOAuthService::clear_token(&server_url)
}

/// Disconnect all MCP servers for a project (e.g. on project close).
#[tauri::command]
pub async fn mcp_shutdown_all(app: AppHandle, project_path: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let svc = state.get_or_create_mcp_service(&project_path);
    svc.shutdown_all().await;
    Ok(())
}

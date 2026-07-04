use crate::{
    models::connector::{Connector, ConnectorCapability, ConnectorManifest, ProviderClaim},
    services::connector_service::{ConnectorGrantRecord, ConnectorService},
};
use tauri::AppHandle;

#[tauri::command]
pub fn connector_register(manifest: ConnectorManifest) -> Result<Connector, String> {
    ConnectorService::register(manifest)
}

#[tauri::command]
pub fn connector_list() -> Result<Vec<Connector>, String> {
    ConnectorService::list()
}

#[tauri::command]
pub fn connector_get(id: String) -> Result<Option<Connector>, String> {
    ConnectorService::get(&id)
}

#[tauri::command]
pub fn connector_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    ConnectorService::set_enabled(&id, enabled)
}

#[tauri::command]
pub fn connector_delete(id: String) -> Result<(), String> {
    ConnectorService::delete(&id)
}

#[tauri::command]
pub fn connector_list_grants(connector_id: String) -> Result<Vec<ConnectorGrantRecord>, String> {
    ConnectorService::list_grants(&connector_id)
}

#[tauri::command]
pub fn connector_revoke_grants(connector_id: String) -> Result<(), String> {
    ConnectorService::revoke_grants(&connector_id)
}

#[tauri::command]
pub fn connector_record_grant(
    app: AppHandle,
    connector_id: String,
    capability: String,
    decision: String,
    scope: String,
) -> Result<(), String> {
    let cap = ConnectorCapability::from_str(&capability)
        .ok_or_else(|| format!("Unknown capability: {capability}"))?;
    let dec = match decision.as_str() {
        "allow" => crate::models::permission::PermissionDecision::Allow,
        "deny" => crate::models::permission::PermissionDecision::Deny,
        _ => crate::models::permission::PermissionDecision::Ask,
    };
    let sc = match scope.as_str() {
        "session" => crate::models::connector::ConnectorGrantScope::Session,
        "project" => crate::models::connector::ConnectorGrantScope::Project,
        _ => crate::models::connector::ConnectorGrantScope::Once,
    };
    ConnectorService::record_grant(&app, &connector_id, cap, dec, sc)?;
    Ok(())
}

#[tauri::command]
pub fn connector_list_claims(connector_id: String) -> Result<Vec<ProviderClaim>, String> {
    ConnectorService::list_claims(&connector_id)
}

#[tauri::command]
pub fn connector_approve_claim(app: AppHandle, id: String) -> Result<(), String> {
    ConnectorService::approve_claim(&app, &id)
}

#[tauri::command]
pub fn connector_deny_claim(app: AppHandle, id: String) -> Result<(), String> {
    ConnectorService::deny_claim(&app, &id)
}

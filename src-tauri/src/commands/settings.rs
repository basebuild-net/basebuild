use crate::models::{
    permission::{ApprovalMode, ApprovalRule, AuditEntry, PermissionRules},
    runtime::RuntimeProfile,
};
use crate::services::settings_service::{ProfileValidation, SettingsService};

 #[tauri::command]
pub fn list_runtime_profiles() -> Result<Vec<RuntimeProfile>, String> {
    SettingsService::list_profiles()
}

#[tauri::command]
pub fn upsert_runtime_profile(profile: RuntimeProfile) -> Result<(), String> {
    SettingsService::upsert_profile(&profile)
}

#[tauri::command]
pub fn delete_runtime_profile(id: String) -> Result<(), String> {
    SettingsService::delete_profile(&id)
}

#[tauri::command]
pub fn validate_runtime_profile(profile: RuntimeProfile) -> Result<ProfileValidation, String> {
    SettingsService::validate_profile(&profile)
}

#[tauri::command]
pub fn get_runtime_defaults() -> Result<crate::models::runtime::RuntimeDefaults, String> {
    SettingsService::get_defaults()
}

#[tauri::command]
pub fn set_runtime_defaults(
    defaults: crate::models::runtime::RuntimeDefaults,
) -> Result<(), String> {
    SettingsService::set_defaults(&defaults)
}

#[tauri::command]
pub fn reset_runtime_defaults() -> Result<(), String> {
    SettingsService::reset_defaults()
}

#[tauri::command]
pub fn get_permission_rules() -> Result<PermissionRules, String> {
    SettingsService::get_permission_rules()
}

#[tauri::command]
pub fn set_permission_rules(rules: PermissionRules) -> Result<(), String> {
    SettingsService::set_permission_rules(&rules)
}

#[tauri::command]
pub fn reset_permission_rules() -> Result<(), String> {
    SettingsService::reset_permission_rules()
}

#[tauri::command]
pub fn list_audit_trail(limit: Option<u32>) -> Result<Vec<AuditEntry>, String> {
    SettingsService::list_audit(limit.unwrap_or(50))
}

#[tauri::command]
pub fn clear_audit_trail() -> Result<(), String> {
    SettingsService::clear_audit()
}

// ─── Approval Gateway ───

#[tauri::command]
pub fn get_approval_mode(project_path: String) -> Result<ApprovalMode, String> {
    SettingsService::get_approval_mode(&project_path)
}

#[tauri::command]
pub fn set_approval_mode(project_path: String, mode: ApprovalMode) -> Result<(), String> {
    SettingsService::set_approval_mode(&project_path, mode)
}

#[tauri::command]
pub fn list_approval_rules(project_path: String) -> Result<Vec<ApprovalRule>, String> {
    SettingsService::list_approval_rules(&project_path)
}

#[tauri::command]
pub fn add_approval_rule(rule: ApprovalRule) -> Result<(), String> {
    SettingsService::add_approval_rule(&rule)
}

#[tauri::command]
pub fn remove_approval_rule(id: String) -> Result<(), String> {
    SettingsService::remove_approval_rule(&id)
}

// Placeholder state to keep the command signature stable; not used yet.
#[allow(dead_code)]
pub struct _SettingsState;

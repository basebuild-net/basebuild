//! Integration tests for the approval gateway.
//!
//! Runs in a separate binary so the BASEBUILD_HOME env var doesn't race with
//! unit tests in settings_service / native_chat_service that use the real DB.

use basebuild_app_lib::services::settings_service::SettingsService;
use basebuild_app_lib::models::permission::{ApprovalMode, PermissionDecision, SessionRule};

fn temp_env() -> tempfile::TempDir {
    let dir = tempfile::TempDir::new().unwrap();
    std::env::set_var("BASEBUILD_HOME", dir.path());
    // Initialize schema.
    let _ = basebuild_app_lib::services::storage_service::StorageService::connect()
        .expect("db connect + init");
    dir
}

#[test]
fn gateway_auto_mode_allows_all() {
    let _env = temp_env();
    let project = "/test/auto";
    SettingsService::set_approval_mode(project, ApprovalMode::Auto).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "write_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Allow);
    assert!(!decision.requires_prompt);
}

#[test]
fn gateway_safe_mode_prompts_all() {
    let _env = temp_env();
    let project = "/test/safe";
    SettingsService::set_approval_mode(project, ApprovalMode::Safe).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "read_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Ask);
    assert!(decision.requires_prompt);
}

#[test]
fn gateway_balanced_allows_reads_prompts_writes() {
    let _env = temp_env();
    let project = "/test/balanced";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let read_decision = SettingsService::resolve_tool_call(project, "read_file", None, &[]);
    assert_eq!(read_decision.decision, PermissionDecision::Allow);
    assert!(!read_decision.requires_prompt);
    let write_decision = SettingsService::resolve_tool_call(project, "write_file", None, &[]);
    assert_eq!(write_decision.decision, PermissionDecision::Ask);
    assert!(write_decision.requires_prompt);
}

#[test]
fn gateway_session_rule_matches() {
    let _env = temp_env();
    let project = "/test/session";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let session_rules = vec![SessionRule {
        tool_name: "run_command".to_string(),
        command_prefix: Some("npm test".to_string()),
        decision: PermissionDecision::Allow,
    }];
    let matching = SettingsService::resolve_tool_call(
        project, "run_command", Some("npm test -- --watch"), &session_rules,
    );
    assert_eq!(matching.decision, PermissionDecision::Allow);
    let non_matching = SettingsService::resolve_tool_call(
        project, "run_command", Some("rm -rf /"), &session_rules,
    );
    assert_eq!(non_matching.decision, PermissionDecision::Ask);
}

#[test]
fn gateway_persistent_rule_matches() {
    use basebuild_app_lib::models::permission::ApprovalRule;
    let _env = temp_env();
    let project = "/test/persistent";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let rule = ApprovalRule {
        id: "rule-1".to_string(),
        project_path: project.to_string(),
        tool_name: "edit_file".to_string(),
        command_prefix: None,
        decision: PermissionDecision::Allow,
        created_at: 0,
    };
    SettingsService::add_approval_rule(&rule).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "edit_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Allow);
}

#[test]
fn gateway_deny_feeds_back() {
    let _env = temp_env();
    let project = "/test/deny";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let session_rules = vec![SessionRule {
        tool_name: "write_file".to_string(),
        command_prefix: None,
        decision: PermissionDecision::Deny,
    }];
    let decision = SettingsService::resolve_tool_call(project, "write_file", None, &session_rules);
    assert_eq!(decision.decision, PermissionDecision::Deny);
    assert!(!decision.requires_prompt);
}

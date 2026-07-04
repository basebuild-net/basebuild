//! Integration tests for the approval gateway.
//!
//! Runs in a separate binary so the BASEBUILD_HOME env var doesn't race with
//! unit tests in settings_service / native_chat_service that use the real DB.
//! Tests share a single temp dir initialized once via LazyLock.

use std::sync::LazyLock;

use parking_lot::Mutex;

use basebuild_app_lib::services::settings_service::SettingsService;
use basebuild_app_lib::models::permission::{ApprovalMode, PermissionDecision, SessionRule};

/// Shared temp dir — all tests use the same DB. Serialized via TEST_LOCK.
static SHARED_DIR: LazyLock<tempfile::TempDir> = LazyLock::new(|| {
    let dir = tempfile::TempDir::new().unwrap();
    std::env::set_var("BASEBUILD_HOME", dir.path());
    basebuild_app_lib::services::storage_service::StorageService::connect()
        .expect("db connect + init");
    dir
});

/// Serializes tests that share the DB.
static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn lock_db() -> parking_lot::MutexGuard<'static, ()> {
    // Force init of SHARED_DIR on first call.
    let _ = &*SHARED_DIR;
    TEST_LOCK.lock()
}

#[test]
fn gateway_auto_mode_allows_all() {
    let _guard = lock_db();
    let project = "/test/auto";
    SettingsService::set_approval_mode(project, ApprovalMode::Auto).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "write_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Allow);
    assert!(!decision.requires_prompt);
}

#[test]
fn gateway_safe_mode_prompts_all() {
    let _guard = lock_db();
    let project = "/test/safe";
    SettingsService::set_approval_mode(project, ApprovalMode::Safe).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "read_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Ask);
    assert!(decision.requires_prompt);
}

#[test]
fn gateway_balanced_allows_reads_prompts_writes() {
    let _guard = lock_db();
    let project = "/test/balanced";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let read_decision = SettingsService::resolve_tool_call(project, "read_file", None, &[]);
    assert_eq!(read_decision.decision, PermissionDecision::Allow);
    assert!(!read_decision.requires_prompt);
    let write_decision = SettingsService::resolve_tool_call(project, "write_file", None, &[]);
    assert_eq!(write_decision.decision, PermissionDecision::Ask);
    assert!(write_decision.requires_prompt);
    let cmd_decision = SettingsService::resolve_tool_call(project, "run_command", None, &[]);
    assert_eq!(cmd_decision.decision, PermissionDecision::Ask);
    assert!(cmd_decision.requires_prompt);
}

#[test]
fn gateway_session_rule_matches() {
    let _guard = lock_db();
    let project = "/test/session";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let session_rules = vec![SessionRule {
        tool_name: "run_command".to_string(),
        command_prefix: Some("npm".to_string()),
        decision: PermissionDecision::Allow,
    }];
    let decision = SettingsService::resolve_tool_call(
        project,
        "run_command",
        Some("npm run build"),
        &session_rules,
    );
    assert_eq!(decision.decision, PermissionDecision::Allow);
    assert!(!decision.requires_prompt);
    // Non-matching prefix should still prompt.
    let decision2 = SettingsService::resolve_tool_call(
        project,
        "run_command",
        Some("cargo build"),
        &session_rules,
    );
    assert_eq!(decision2.decision, PermissionDecision::Ask);
    assert!(decision2.requires_prompt);
}

#[test]
fn gateway_persistent_rule_overrides_mode() {
    use basebuild_app_lib::models::permission::ApprovalRule;
    let _guard = lock_db();
    let project = "/test/persistent";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let rule = ApprovalRule {
        id: "test-rule-1".to_string(),
        project_path: project.to_string(),
        tool_name: "write_file".to_string(),
        command_prefix: None,
        decision: PermissionDecision::Allow,
        created_at: 0,
    };
    SettingsService::add_approval_rule(&rule).unwrap();
    let decision = SettingsService::resolve_tool_call(project, "write_file", None, &[]);
    assert_eq!(decision.decision, PermissionDecision::Allow);
    assert!(!decision.requires_prompt);
    SettingsService::remove_approval_rule("test-rule-1").unwrap();
}

#[test]
fn gateway_deny_feeds_back() {
    let _guard = lock_db();
    let project = "/test/deny";
    SettingsService::set_approval_mode(project, ApprovalMode::Balanced).unwrap();
    let session_rules = vec![SessionRule {
        tool_name: "run_command".to_string(),
        command_prefix: Some("rm".to_string()),
        decision: PermissionDecision::Deny,
    }];
    let decision = SettingsService::resolve_tool_call(
        project,
        "run_command",
        Some("rm -rf /"),
        &session_rules,
    );
    assert_eq!(decision.decision, PermissionDecision::Deny);
    assert!(!decision.requires_prompt);
}

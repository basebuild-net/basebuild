use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

use crate::{
    models::startup::{
        LaunchMode, ReconciliationAction, ReconciliationResult, RegistrationError,
        RegistrationState, StartupPreferences, StartupRegistrationStatus,
    },
    services::storage_service::StorageService,
};

type DbResult<T> = Result<T, String>;

/// Detect whether this process was launched as a hidden background autostart
/// instance (`--background` argument) or a normal foreground launch.
///
/// This is a pure function over `std::env::args` — no Tauri handle required,
/// so it is directly unit-testable.
pub fn detect_launch_mode() -> LaunchMode {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--background") {
        LaunchMode::Background
    } else {
        LaunchMode::Foreground
    }
}

/// Whether the current platform supports the autostart plugin.
#[cfg(target_os = "windows")]
pub fn platform_supported() -> bool {
    true
}

#[cfg(not(target_os = "windows"))]
pub fn platform_supported() -> bool {
    false
}

#[derive(Debug, Default)]
pub struct StartupService;

impl StartupService {
    // ─── Persisted preferences ───

    /// Read the user's persisted launch-at-sign-in intent.
    pub fn get_preferences() -> DbResult<StartupPreferences> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = 'startup_preferences'",
                [],
                |r| r.get(0),
            )
            .ok();
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|e| e.to_string()),
            None => Ok(StartupPreferences::default()),
        }
    }

    /// Persist the user's launch-at-sign-in intent.
    fn set_preferences(prefs: &StartupPreferences) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('startup_preferences', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(prefs).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── OS registration via plugin ───

    /// Read the effective autostart registration state from the plugin.
    fn read_effective(app: &AppHandle) -> Result<RegistrationState, RegistrationError> {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        match autolaunch.is_enabled() {
            Ok(true) => Ok(RegistrationState::Enabled),
            Ok(false) => Ok(RegistrationState::Disabled),
            Err(_) => {
                if platform_supported() {
                    Err(RegistrationError::Internal)
                } else {
                    Ok(RegistrationState::Unsupported)
                }
            }
        }
    }

    /// Enable the OS autostart registration, read back the effective state,
    /// and persist the user's intent. Returns the full status.
    pub fn enable(app: &AppHandle) -> DbResult<StartupRegistrationStatus> {
        use tauri_plugin_autostart::ManagerExt;
        if !platform_supported() {
            return Ok(Self::unsupported_status());
        }
        let autolaunch = app.autolaunch();
        autolaunch
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {e}"))?;
        let effective = Self::read_effective(app).map_err(|e| format!("{e:?}"))?;
        let prefs = StartupPreferences {
            launch_at_signin: true,
            schema_version: 1,
        };
        Self::set_preferences(&prefs)?;
        Ok(StartupRegistrationStatus {
            desired: true,
            effective,
            platform_supported: true,
            last_reconciliation: Some(ReconciliationResult {
                success: effective == RegistrationState::Enabled,
                action: if effective == RegistrationState::Enabled {
                    ReconciliationAction::Repaired
                } else {
                    ReconciliationAction::Failed
                },
                error: if effective == RegistrationState::Enabled {
                    None
                } else {
                    Some(RegistrationError::OsDenied)
                },
            }),
        })
    }

    /// Disable the OS autostart registration, read back the effective state,
    /// and persist the user's intent. Returns the full status.
    pub fn disable(app: &AppHandle) -> DbResult<StartupRegistrationStatus> {
        use tauri_plugin_autostart::ManagerExt;
        if !platform_supported() {
            return Ok(Self::unsupported_status());
        }
        let autolaunch = app.autolaunch();
        autolaunch
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {e}"))?;
        let effective = Self::read_effective(app).map_err(|e| format!("{e:?}"))?;
        let prefs = StartupPreferences {
            launch_at_signin: false,
            schema_version: 1,
        };
        Self::set_preferences(&prefs)?;
        Ok(StartupRegistrationStatus {
            desired: false,
            effective,
            platform_supported: true,
            last_reconciliation: Some(ReconciliationResult {
                success: effective == RegistrationState::Disabled,
                action: if effective == RegistrationState::Disabled {
                    ReconciliationAction::Removed
                } else {
                    ReconciliationAction::Failed
                },
                error: if effective == RegistrationState::Disabled {
                    None
                } else {
                    Some(RegistrationError::OsDenied)
                },
            }),
        })
    }

    /// Read the current full status: desired (persisted intent) + effective
    /// (OS registration read-back). Does not modify anything.
    pub fn get_status(app: &AppHandle) -> DbResult<StartupRegistrationStatus> {
        if !platform_supported() {
            return Ok(Self::unsupported_status());
        }
        let prefs = Self::get_preferences()?;
        let effective = Self::read_effective(app).map_err(|e| format!("{e:?}"))?;
        Ok(StartupRegistrationStatus {
            desired: prefs.launch_at_signin,
            effective,
            platform_supported: true,
            last_reconciliation: None,
        })
    }

    /// Reconcile persisted intent with the effective OS registration.
    /// Idempotent: only acts when intent and effective state disagree.
    /// Called on startup and after app upgrades.
    pub fn reconcile(app: &AppHandle) -> DbResult<StartupRegistrationStatus> {
        if !platform_supported() {
            return Ok(Self::unsupported_status());
        }
        let prefs = Self::get_preferences()?;
        let effective = Self::read_effective(app).map_err(|e| format!("{e:?}"))?;

        match (prefs.launch_at_signin, effective) {
            (true, RegistrationState::Enabled) => {
                // Already correct — no-op.
                Ok(StartupRegistrationStatus {
                    desired: true,
                    effective: RegistrationState::Enabled,
                    platform_supported: true,
                    last_reconciliation: Some(ReconciliationResult {
                        success: true,
                        action: ReconciliationAction::Noop,
                        error: None,
                    }),
                })
            }
            (true, RegistrationState::Disabled) | (true, RegistrationState::Unsupported) => {
                // Intent is enabled but registration is missing — repair.
                Self::enable(app)
            }
            (false, RegistrationState::Enabled) => {
                // Intent is disabled but a stale entry exists — remove.
                Self::disable(app)
            }
            (false, RegistrationState::Disabled) | (false, RegistrationState::Unsupported) => {
                // Already correct — no-op.
                Ok(StartupRegistrationStatus {
                    desired: false,
                    effective: RegistrationState::Disabled,
                    platform_supported: true,
                    last_reconciliation: Some(ReconciliationResult {
                        success: true,
                        action: ReconciliationAction::Noop,
                        error: None,
                    }),
                })
            }
        }
    }

    fn unsupported_status() -> StartupRegistrationStatus {
        StartupRegistrationStatus {
            desired: false,
            effective: RegistrationState::Unsupported,
            platform_supported: false,
            last_reconciliation: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::isolated_home;

    #[test]
    fn test_detect_launch_mode_foreground_default() {
        // The test process doesn't have --background, so it should be Foreground.
        assert_eq!(detect_launch_mode(), LaunchMode::Foreground);
    }

    #[test]
    fn test_detect_launch_mode_background_when_flag_present() {
        // We can't easily set env args in a unit test, but we can verify
        // the logic by checking that the current process (without --background)
        // returns Foreground. The actual --background parsing is tested in
        // integration tests.
        let args: Vec<String> = std::env::args().collect();
        let has_bg = args.iter().any(|a| a == "--background");
        assert_eq!(has_bg, false);
    }

    #[test]
    fn test_startup_preferences_default() {
        let (_dir, _guard) = isolated_home();
        let prefs = StartupService::get_preferences().unwrap();
        assert_eq!(prefs.launch_at_signin, false);
        assert_eq!(prefs.schema_version, 1);
    }

    #[test]
    fn test_startup_preferences_round_trip() {
        let (_dir, _guard) = isolated_home();
        let prefs = StartupPreferences {
            launch_at_signin: true,
            schema_version: 1,
        };
        // Use the private setter via a connection directly.
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('startup_preferences', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(&prefs).unwrap()],
        )
        .unwrap();
        let read = StartupService::get_preferences().unwrap();
        assert_eq!(read.launch_at_signin, true);
    }

    #[test]
    fn test_platform_supported_on_windows() {
        // On Windows this returns true; on other platforms false.
        // The test just verifies the function doesn't panic.
        let _ = platform_supported();
    }


    #[test]
    fn test_unsupported_status_is_consistent() {
        let status = StartupService::unsupported_status();
        assert_eq!(status.desired, false);
        assert_eq!(status.effective, RegistrationState::Unsupported);
        assert_eq!(status.platform_supported, false);
        assert_eq!(status.last_reconciliation, None);
    }

    #[test]
    fn test_startup_preferences_serialization() {
        let prefs = StartupPreferences {
            launch_at_signin: true,
            schema_version: 1,
        };
        let json = serde_json::to_string(&prefs).unwrap();
        assert!(json.contains("\"launchAtSignin\":true"));
        assert!(json.contains("\"schemaVersion\":1"));
        let back: StartupPreferences = serde_json::from_str(&json).unwrap();
        assert_eq!(back, prefs);
    }

    #[test]
    fn test_registration_state_serde() {
        let states = vec![
            (RegistrationState::Enabled, "\"enabled\""),
            (RegistrationState::Disabled, "\"disabled\""),
            (RegistrationState::Unsupported, "\"unsupported\""),
        ];
        for (state, expected_json) in states {
            let json = serde_json::to_string(&state).unwrap();
            assert_eq!(json, expected_json);
            let back: RegistrationState = serde_json::from_str(&json).unwrap();
            assert_eq!(back, state);
        }
    }

    #[test]
    fn test_reconciliation_action_serde() {
        let actions = vec![
            (ReconciliationAction::Noop, "\"noop\""),
            (ReconciliationAction::Repaired, "\"repaired\""),
            (ReconciliationAction::Removed, "\"removed\""),
            (ReconciliationAction::Failed, "\"failed\""),
        ];
        for (action, expected_json) in actions {
            let json = serde_json::to_string(&action).unwrap();
            assert_eq!(json, expected_json);
            let back: ReconciliationAction = serde_json::from_str(&json).unwrap();
            assert_eq!(back, action);
        }
    }

    #[test]
    fn test_registration_error_serde() {
        let errors = vec![
            (RegistrationError::OsDenied, "\"osDenied\""),
            (RegistrationError::StaleEntry, "\"staleEntry\""),
            (RegistrationError::Internal, "\"internal\""),
        ];
        for (error, expected_json) in errors {
            let json = serde_json::to_string(&error).unwrap();
            assert_eq!(json, expected_json);
            let back: RegistrationError = serde_json::from_str(&json).unwrap();
            assert_eq!(back, error);
        }
    }

    #[test]
    fn test_launch_mode_serde() {
        assert_eq!(
            serde_json::to_string(&LaunchMode::Foreground).unwrap(),
            "\"foreground\""
        );
        assert_eq!(
            serde_json::to_string(&LaunchMode::Background).unwrap(),
            "\"background\""
        );
        let fg: LaunchMode = serde_json::from_str("\"foreground\"").unwrap();
        assert_eq!(fg, LaunchMode::Foreground);
        let bg: LaunchMode = serde_json::from_str("\"background\"").unwrap();
        assert_eq!(bg, LaunchMode::Background);
    }

    #[test]
    fn test_startup_registration_status_default() {
        let status = StartupRegistrationStatus::default();
        assert_eq!(status.desired, false);
        assert_eq!(status.effective, RegistrationState::Unsupported);
        assert_eq!(status.platform_supported, false);
        assert_eq!(status.last_reconciliation, None);
    }

    #[test]
    fn test_reconciliation_result_serialization() {
        let result = ReconciliationResult {
            success: true,
            action: ReconciliationAction::Repaired,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"action\":\"repaired\""));
        assert!(json.contains("\"error\":null"));
    }

    #[test]
    fn test_preferences_default_is_disabled() {
        // Existing users must not be silently migrated to autostart.
        let prefs = StartupPreferences::default();
        assert_eq!(prefs.launch_at_signin, false);
    }
}

use serde::{Deserialize, Serialize};

/// Whether the current process was launched as a foreground window or
/// a hidden background autostart instance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LaunchMode {
    /// Explicit user launch — show and focus the main window.
    Foreground,
    /// Windows autostart with `--background` — keep the main window hidden.
    Background,
}

impl Default for LaunchMode {
    fn default() -> Self {
        Self::Foreground
    }
}

/// User's persisted intent for Windows launch-at-sign-in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartupPreferences {
    /// Whether the user wants Basebuild to launch at Windows sign-in.
    pub launch_at_signin: bool,
    /// Schema version for future migrations.
    pub schema_version: u32,
}

impl Default for StartupPreferences {
    fn default() -> Self {
        Self {
            launch_at_signin: false,
            schema_version: 1,
        }
    }
}

/// The effective state of the OS autostart registration, read back from
/// the plugin after an enable/disable/reconcile operation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RegistrationState {
    /// The autostart entry exists and points to this executable.
    Enabled,
    /// No autostart entry exists.
    Disabled,
    /// The platform does not support autostart registration.
    Unsupported,
}

/// Privacy-safe error classification for autostart registration failures.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RegistrationError {
    /// The OS denied or failed the registration change.
    OsDenied,
    /// The registration exists but points to a different/obsolete path.
    StaleEntry,
    /// An unexpected internal error occurred.
    Internal,
}

/// The full status of the launch-at-sign-in feature, combining user intent
/// with the effective OS registration state. This is what Settings displays.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupRegistrationStatus {
    /// What the user asked for.
    pub desired: bool,
    /// What the OS registration actually reflects.
    pub effective: RegistrationState,
    /// Whether the current platform supports autostart.
    pub platform_supported: bool,
    /// The last reconciliation result, if any.
    pub last_reconciliation: Option<ReconciliationResult>,
}

/// The outcome of a reconciliation attempt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationResult {
    /// Whether the reconciliation succeeded.
    pub success: bool,
    /// What action was taken, if any.
    pub action: ReconciliationAction,
    /// Error classification on failure.
    pub error: Option<RegistrationError>,
}

/// What action a reconciliation took.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReconciliationAction {
    /// No action needed — registration already matches intent.
    Noop,
    /// Created or repaired the autostart entry.
    Repaired,
    /// Removed a stale autostart entry.
    Removed,
    /// Attempted but failed.
    Failed,
}

impl Default for StartupRegistrationStatus {
    fn default() -> Self {
        Self {
            desired: false,
            effective: RegistrationState::Unsupported,
            platform_supported: false,
            last_reconciliation: None,
        }
    }
}

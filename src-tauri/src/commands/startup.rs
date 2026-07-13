use tauri::AppHandle;

use crate::{
    models::startup::{LaunchMode, StartupRegistrationStatus},
    services::startup_service::{self, StartupService},
};

/// Read the current launch-at-sign-in status: desired intent + effective
/// OS registration state. Non-blocking, no network I/O.
#[tauri::command]
pub fn startup_get_status(app: AppHandle) -> Result<StartupRegistrationStatus, String> {
    eprintln!("[startup] get_status");
    StartupService::get_status(&app)
}

/// Enable launch at sign-in. Registers with the OS, reads back the effective
/// state, and persists the user's intent.
#[tauri::command]
pub fn startup_enable(app: AppHandle) -> Result<StartupRegistrationStatus, String> {
    eprintln!("[startup] enable — registering autostart");
    let result = StartupService::enable(&app);
    match &result {
        Ok(status) => eprintln!("[startup] enable succeeded — effective: {:?}", status.effective),
        Err(e) => eprintln!("[startup] enable failed: {e}"),
    }
    result
}

/// Disable launch at sign-in. Removes the OS registration, reads back the
/// effective state, and persists the user's intent.
#[tauri::command]
pub fn startup_disable(app: AppHandle) -> Result<StartupRegistrationStatus, String> {
    eprintln!("[startup] disable — removing autostart registration");
    let result = StartupService::disable(&app);
    match &result {
        Ok(status) => eprintln!("[startup] disable succeeded — effective: {:?}", status.effective),
        Err(e) => eprintln!("[startup] disable failed: {e}"),
    }
    result
}

/// Reconcile persisted intent with the effective OS registration.
/// Idempotent: only acts when intent and effective state disagree.
/// Called on startup and after app upgrades.
#[tauri::command]
pub fn startup_reconcile(app: AppHandle) -> Result<StartupRegistrationStatus, String> {
    eprintln!("[startup] reconcile — checking autostart registration");
    let result = StartupService::reconcile(&app);
    match &result {
        Ok(status) => {
            if let Some(recon) = &status.last_reconciliation {
                eprintln!("[startup] reconcile — action: {:?}, success: {}", recon.action, recon.success);
            }
        }
        Err(e) => eprintln!("[startup] reconcile failed: {e}"),
    }
    result
}

/// Read the current process's launch mode (foreground or background).
/// Used by the frontend to decide whether to reveal the main window.
#[tauri::command]
pub fn startup_launch_mode() -> Result<LaunchMode, String> {
    let mode = startup_service::detect_launch_mode();
    eprintln!("[startup] launch_mode — {:?}", mode);
    Ok(mode)
}

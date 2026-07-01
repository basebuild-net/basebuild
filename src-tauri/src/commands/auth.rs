use crate::services::auth_service::{
    AuthService, DeviceStartResult, NativeProfile, PollResult, StoredAuth,
};

#[tauri::command]
pub fn auth_status() -> Result<Option<StoredAuth>, String> {
    AuthService::load_stored_auth()
}

#[tauri::command]
pub fn auth_start_device_flow(
    client_name: String,
    client_version: Option<String>,
    platform: Option<String>,
) -> Result<DeviceStartResult, String> {
    let result = AuthService::start_device_flow(
        &client_name,
        client_version.as_deref(),
        platform.as_deref(),
    )?;
    // Open the system browser to the verification URL
    AuthService::open_browser(&result.verification_uri_complete)?;
    Ok(result)
}

#[tauri::command]
pub fn auth_poll_device_flow(device_code: String) -> Result<PollResult, String> {
    AuthService::poll_device_flow(&device_code)
}

#[tauri::command]
pub fn auth_fetch_profile() -> Result<NativeProfile, String> {
    AuthService::fetch_profile()
}

#[tauri::command]
pub fn auth_sign_out() -> Result<(), String> {
    AuthService::revoke_token()
}

#[tauri::command]
pub fn auth_get_token() -> Result<Option<String>, String> {
    AuthService::get_access_token()
}

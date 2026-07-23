use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::services::storage_paths::StoragePathService;
/// If `image` is a relative path like `/avatars/user.png`, prepend BASE_URL.
fn absolutize_image(image: Option<&str>) -> Option<String> {
    image.and_then(|s| {
        if s.is_empty() {
            return None;
        }
        if s.starts_with("http://") || s.starts_with("https://") {
            return Some(s.to_string());
        }
        if s.starts_with('/') {
            return Some(format!("{BASE_URL}{s}"));
        }
        Some(format!("{BASE_URL}/{s}"))
    })
}

const BASE_URL: &str = "https://basebuild.net";

/// Persisted native app token + user profile stored locally.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuth {
    pub access_token: String,
    pub expires_at: String,
    pub scopes: Vec<String>,
    pub user: Option<NativeProfile>,
}

/// Write-only guest credential used solely for anonymous aggregate usage sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestSyncAuth {
    pub installation_id: String,
    pub access_token: String,
    pub expires_at: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProfile {
    pub id: String,
    pub username: String,
    pub email: String,
    pub image: Option<String>,
    pub is_admin: bool,
    pub is_editor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStartResult {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", content = "data")]
#[serde(rename_all = "camelCase")]
pub enum PollResult {
    Pending {
        interval: u64,
    },
    Denied,
    Expired,
    Success {
        access_token: String,
        expires_at: String,
        scopes: Vec<String>,
        user: NativeProfile,
    },
}

/// Desktop auth service — manages the device flow and native token persistence.
/// Token is stored as JSON in `~/.basebuild/auth.json`.
pub struct AuthService {
    #[allow(dead_code)]
    lock: Mutex<()>,
}

impl Default for AuthService {
    fn default() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

impl AuthService {
    fn token_path() -> Result<PathBuf, String> {
        let dir = StoragePathService::global_basebuild_dir()?;
        Ok(dir.join("auth.json"))
    }

    fn guest_sync_token_path() -> Result<PathBuf, String> {
        let dir = StoragePathService::global_basebuild_dir()?;
        Ok(dir.join("guest-sync.json"))
    }

    /// Load stored auth from disk, if present.
    pub fn load_stored_auth() -> Result<Option<StoredAuth>, String> {
        let path = Self::token_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let data =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read auth file: {e}"))?;
        let auth: StoredAuth =
            serde_json::from_str(&data).map_err(|e| format!("Failed to parse auth file: {e}"))?;
        Ok(Some(auth))
    }

    /// Save auth to disk.
    fn save_auth(auth: &StoredAuth) -> Result<(), String> {
        let path = Self::token_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create auth dir: {e}"))?;
        }
        let data = serde_json::to_string_pretty(auth)
            .map_err(|e| format!("Failed to serialize auth: {e}"))?;
        fs::write(&path, data).map_err(|e| format!("Failed to write auth file: {e}"))?;
        Ok(())
    }

    /// Delete stored auth (sign out).
    pub fn clear_auth() -> Result<(), String> {
        let path = Self::token_path()?;
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete auth file: {e}"))?;
        }
        Ok(())
    }

    pub fn load_guest_sync_auth() -> Result<Option<GuestSyncAuth>, String> {
        let path = Self::guest_sync_token_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read guest sync auth: {e}"))?;
        let auth = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse guest sync auth: {e}"))?;
        Ok(Some(auth))
    }

    pub fn save_guest_sync_auth(auth: &GuestSyncAuth) -> Result<(), String> {
        let path = Self::guest_sync_token_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create guest sync auth directory: {e}"))?;
        }
        let data = serde_json::to_string_pretty(auth)
            .map_err(|e| format!("Failed to serialize guest sync auth: {e}"))?;
        fs::write(&path, data).map_err(|e| format!("Failed to write guest sync auth: {e}"))
    }

    pub fn clear_guest_sync_auth() -> Result<(), String> {
        let path = Self::guest_sync_token_path()?;
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete guest sync auth: {e}"))?;
        }
        Ok(())
    }

    /// Start the device authorization flow by calling the website API.
    pub fn start_device_flow(
        client_name: &str,
        client_version: Option<&str>,
        platform: Option<&str>,
    ) -> Result<DeviceStartResult, String> {
        let url = format!("{BASE_URL}/api/auth/device/start");
        let body = json!({
            "clientName": client_name,
            "clientVersion": client_version,
            "platform": platform,
            "scopes": ["mcp:usage", "profile:read", "device:revoke"],
        });

        let resp = reqwest::blocking::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .map_err(|e| format!("Failed to connect to {BASE_URL}: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().unwrap_or_default();
            return Err(format!("Device start failed ({status}): {text}"));
        }

        resp.json::<DeviceStartResult>()
            .map_err(|e| format!("Failed to parse device start response: {e}"))
    }

    /// Poll the device flow for completion.
    pub fn poll_device_flow(device_code: &str) -> Result<PollResult, String> {
        let url = format!("{BASE_URL}/api/auth/device/poll");
        let body = json!({ "deviceCode": device_code });

        let resp = reqwest::blocking::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .map_err(|e| format!("Failed to connect to {BASE_URL}: {e}"))?;

        let status = resp.status();
        let text = resp.text().unwrap_or_default();

        // Parse the response — error fields tell us the state
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse poll response: {e}"))?;

        if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
            return Ok(match error {
                "authorization_pending" => {
                    let interval = parsed.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);
                    PollResult::Pending { interval }
                }
                "authorization_denied" => PollResult::Denied,
                "expired_token" => PollResult::Expired,
                "slow_down" => {
                    let interval = parsed
                        .get("interval")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(10);
                    PollResult::Pending { interval }
                }
                _ => return Err(format!("Unexpected poll error: {error}")),
            });
        }

        if !status.is_success() {
            return Err(format!("Poll failed ({status}): {text}"));
        }

        // Success — parse the token + user
        let access_token = parsed
            .get("accessToken")
            .and_then(|v| v.as_str())
            .ok_or("Missing accessToken in poll response")?
            .to_string();
        let expires_at = parsed
            .get("expiresAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let scopes: Vec<String> = parsed
            .get("scopes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let user_obj = parsed.get("user").ok_or("Missing user in poll response")?;
        let user = NativeProfile {
            id: user_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            username: user_obj
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            email: user_obj
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            image: absolutize_image(user_obj.get("image").and_then(|v| v.as_str())),
            is_admin: user_obj
                .get("isAdmin")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            is_editor: user_obj
                .get("isEditor")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        };

        // Persist auth
        let stored = StoredAuth {
            access_token: access_token.clone(),
            expires_at: expires_at.clone(),
            scopes: scopes.clone(),
            user: Some(user.clone()),
        };
        Self::save_auth(&stored)?;

        Ok(PollResult::Success {
            access_token,
            expires_at,
            scopes,
            user,
        })
    }

    /// Fetch the user profile using the stored native token.
    pub fn fetch_profile() -> Result<NativeProfile, String> {
        let auth = Self::load_stored_auth()?.ok_or("Not authenticated")?;
        let url = format!("{BASE_URL}/api/auth/native/profile");
        let resp = reqwest::blocking::Client::new()
            .get(&url)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .send()
            .map_err(|e| format!("Failed to fetch profile: {e}"))?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            Self::clear_auth()?;
            return Err("Token expired or revoked".to_string());
        }

        if !resp.status().is_success() {
            return Err(format!("Profile fetch failed: {}", resp.status()));
        }

        let parsed: serde_json::Value = resp
            .json()
            .map_err(|e| format!("Failed to parse profile: {e}"))?;

        Ok(NativeProfile {
            id: parsed
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            username: parsed
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            email: parsed
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            image: absolutize_image(parsed.get("image").and_then(|v| v.as_str())),
            is_admin: parsed
                .get("isAdmin")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            is_editor: parsed
                .get("isEditor")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        })
    }

    /// Revoke the stored token (sign out).
    pub fn revoke_token() -> Result<(), String> {
        let auth = Self::load_stored_auth()?.ok_or("Not authenticated")?;
        let url = format!("{BASE_URL}/api/auth/native/revoke");
        let _ = reqwest::blocking::Client::new()
            .post(&url)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .send()
            .map_err(|e| format!("Failed to revoke token: {e}"))?;
        Self::clear_auth()?;
        Ok(())
    }

    /// Get the stored token for MCP sync calls.
    pub fn get_access_token() -> Result<Option<String>, String> {
        let auth = Self::load_stored_auth()?;
        Ok(auth.map(|a| a.access_token))
    }

    /// Open the system browser to the verification URL.
    pub fn open_browser(url: &str) -> Result<(), String> {
        open::that(url).map_err(|e| format!("Failed to open browser: {e}"))
    }
}

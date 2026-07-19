//! Provider OAuth for Basebuild-native OpenAI Codex and OMP-backed providers.
//!
//! OpenAI subscription tokens are stored in Basebuild's local SQLite database.
//! Other provider flows use OMP's structured RPC protocol and remain owned by
//! OMP. No credential is copied through the webview or written to logs.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, LazyLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::models::native_chat::{NativeProviderCredentialInput, NativeProviderLoginState};
use crate::services::native_chat_service::NativeChatService;
use crate::services::process_helpers::hidden_command;
use crate::services::provider_client::NATIVE_CODEX_BASE_URL;
use crate::services::provider_model_catalog_service::ProviderModelCatalogService;
use crate::services::storage_service::StorageService;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const OPENAI_CODEX_PROVIDER_ID: &str = "openai-codex";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_DEVICE_USERCODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const OPENAI_DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const OPENAI_DEVICE_AUTH_URL: &str = "https://auth.openai.com/codex/device";
const OPENAI_DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_STORAGE_KEY: &str = "provider_oauth:openai-codex";
const TOKEN_REFRESH_SKEW_MS: i64 = 60_000;

#[derive(Clone, Serialize, Deserialize)]
struct OpenAiOAuthToken {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

type LoginInput = (String, String);

struct LoginSession {
    state: Arc<Mutex<NativeProviderLoginState>>,
    pending_request_id: Arc<Mutex<Option<String>>>,
    input: Sender<LoginInput>,
    cancelled: Arc<AtomicBool>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, LoginSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static OPENAI_REFRESH_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub struct ProviderLoginService;

impl ProviderLoginService {
    pub fn start(provider_id: &str) -> Result<NativeProviderLoginState, String> {
        let provider_id = provider_id.trim();
        if provider_id.is_empty() {
            return Err("Provider id is required.".to_string());
        }
        if !crate::models::model_catalog::provider_ids().contains(&provider_id) {
            return Err(format!("Unknown provider '{provider_id}'."));
        }
        if provider_id != OPENAI_CODEX_PROVIDER_ID
            && !crate::services::provider_client::omp_available()
        {
            return Err("Oh My Pi is not installed or is not available on PATH.".to_string());
        }

        let mut sessions = SESSIONS.lock();
        // A fresh click always restarts the flow. Reusing a stale session
        // left the user stuck: the browser tab only opens once, so a
        // closed/abandoned attempt could never be retried until the
        // 10-minute timeout expired.
        if let Some(existing) = sessions.remove(provider_id) {
            existing.cancelled.store(true, Ordering::SeqCst);
        }

        let initial = NativeProviderLoginState {
            provider_id: provider_id.to_string(),
            status: "starting".to_string(),
            message: "Starting provider sign-in…".to_string(),
            prompt: None,
            complete: false,
            error: None,
        };
        let state = Arc::new(Mutex::new(initial.clone()));
        let pending_request_id = Arc::new(Mutex::new(None));
        let cancelled = Arc::new(AtomicBool::new(false));
        let (input_tx, input_rx) = mpsc::channel();
        sessions.insert(
            provider_id.to_string(),
            LoginSession {
                state: state.clone(),
                pending_request_id: pending_request_id.clone(),
                input: input_tx,
                cancelled: cancelled.clone(),
            },
        );
        drop(sessions);
        let provider = provider_id.to_string();

        thread::spawn(move || {
            if provider == OPENAI_CODEX_PROVIDER_ID {
                run_openai_device_login(state, cancelled);
            } else {
                run_omp_login(provider, state, pending_request_id, input_rx, cancelled);
            }
        });
        Ok(initial)
    }

    pub fn poll(provider_id: &str) -> Result<NativeProviderLoginState, String> {
        let sessions = SESSIONS.lock();
        let session = sessions
            .get(provider_id)
            .ok_or_else(|| format!("No sign-in is active for '{provider_id}'."))?;
        let state = session.state.lock().clone();
        Ok(state)
    }

    pub fn submit(provider_id: &str, value: &str) -> Result<NativeProviderLoginState, String> {
        let value = value.trim();
        if value.is_empty() {
            return Err("The authorization response is required.".to_string());
        }
        let sessions = SESSIONS.lock();
        let session = sessions
            .get(provider_id)
            .ok_or_else(|| format!("No sign-in is active for '{provider_id}'."))?;
        let request_id = {
            let state = session.state.lock();
            if state.status != "waiting_input" {
                return Err("This sign-in is not waiting for input.".to_string());
            }
            session
                .pending_request_id
                .lock()
                .clone()
                .ok_or_else(|| "The sign-in prompt is invalid.".to_string())?
        };
        session
            .input
            .send((request_id, value.to_string()))
            .map_err(|_| "The provider sign-in process has stopped.".to_string())?;
        let state = session.state.lock().clone();
        Ok(state)
    }

    /// Cancel an in-flight sign-in. The worker thread observes the flag and
    /// exits; the state is marked cancelled so pollers stop cleanly.
    pub fn cancel(provider_id: &str) -> Result<NativeProviderLoginState, String> {
        let sessions = SESSIONS.lock();
        let session = sessions
            .get(provider_id)
            .ok_or_else(|| format!("No sign-in is active for '{provider_id}'."))?;
        session.cancelled.store(true, Ordering::SeqCst);
        let mut state = session.state.lock();
        if !state.complete && state.status != "error" {
            state.status = "cancelled".to_string();
            state.message = "Provider sign-in cancelled.".to_string();
            state.prompt = None;
            state.error = None;
        }
        Ok(state.clone())
    }

    pub fn refresh_native_token(provider_id: &str) -> Result<(), String> {
        if provider_id != OPENAI_CODEX_PROVIDER_ID {
            return Ok(());
        }
        let _refresh_guard = OPENAI_REFRESH_LOCK.lock();
        let Some(token) = load_openai_token()? else {
            return Ok(());
        };
        if token.expires_at > now_millis() + TOKEN_REFRESH_SKEW_MS {
            return Ok(());
        }
        let refreshed = refresh_openai_token(&token.refresh_token)?;
        save_openai_token(&refreshed)
    }

    pub fn clear_native_token(provider_id: &str) -> Result<(), String> {
        if provider_id != OPENAI_CODEX_PROVIDER_ID {
            return Ok(());
        }
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM app_defaults WHERE key = ?1",
            params![OPENAI_OAUTH_STORAGE_KEY],
        )
        .map_err(|error| format!("Failed to remove provider OAuth state: {error}"))?;
        Ok(())
    }
}

fn update_state(
    state: &Arc<Mutex<NativeProviderLoginState>>,
    status: &str,
    message: impl Into<String>,
    prompt: Option<String>,
) {
    let mut current = state.lock();
    current.status = status.to_string();
    current.message = message.into();
    current.prompt = prompt;
}

fn fail(state: &Arc<Mutex<NativeProviderLoginState>>, message: impl Into<String>) {
    let message = message.into();
    let mut current = state.lock();
    current.status = "error".to_string();
    current.message = "Provider sign-in failed.".to_string();
    current.prompt = None;
    current.error = Some(message);
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn oauth_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to initialize provider sign-in: {error}"))
}

fn load_openai_token() -> Result<Option<OpenAiOAuthToken>, String> {
    let conn = StorageService::connect()?;
    let value = conn
        .query_row(
            "SELECT value FROM app_defaults WHERE key = ?1",
            params![OPENAI_OAUTH_STORAGE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read provider OAuth state: {error}"))?;
    value
        .map(|json| {
            serde_json::from_str(&json)
                .map_err(|error| format!("Stored provider OAuth state is invalid: {error}"))
        })
        .transpose()
}

fn save_openai_token(token: &OpenAiOAuthToken) -> Result<(), String> {
    let value = serde_json::to_string(token)
        .map_err(|error| format!("Failed to encode provider OAuth state: {error}"))?;
    let conn = StorageService::connect()?;
    conn.execute(
        "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![OPENAI_OAUTH_STORAGE_KEY, value],
    )
    .map_err(|error| format!("Failed to save provider OAuth state: {error}"))?;
    NativeChatService::save_credential(NativeProviderCredentialInput {
        provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
        label: "OpenAI Codex subscription".to_string(),
        api_key: token.access_token.clone(),
        base_url: Some(NATIVE_CODEX_BASE_URL.to_string()),
    })?;
    Ok(())
}

fn parse_openai_token(value: &Value) -> Result<OpenAiOAuthToken, String> {
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OpenAI returned no access token.".to_string())?;
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OpenAI returned no refresh token.".to_string())?;
    let expires_in = value
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "OpenAI returned an invalid token lifetime.".to_string())?;
    Ok(OpenAiOAuthToken {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.to_string(),
        expires_at: now_millis().saturating_add(expires_in.saturating_mul(1_000)),
    })
}

fn exchange_openai_code(code: &str, verifier: &str) -> Result<OpenAiOAuthToken, String> {
    let response = oauth_http_client()?
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", OPENAI_DEVICE_REDIRECT_URI),
            ("client_id", OPENAI_CLIENT_ID),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|error| format!("OpenAI token exchange failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenAI token exchange failed with status {}.",
            response.status().as_u16()
        ));
    }
    let value = response
        .json::<Value>()
        .map_err(|error| format!("OpenAI returned an invalid token response: {error}"))?;
    parse_openai_token(&value)
}

fn refresh_openai_token(refresh_token: &str) -> Result<OpenAiOAuthToken, String> {
    let response = oauth_http_client()?
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", OPENAI_CLIENT_ID),
        ])
        .send()
        .map_err(|error| format!("OpenAI token refresh failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenAI token refresh failed with status {}. Sign in again.",
            response.status().as_u16()
        ));
    }
    let value = response
        .json::<Value>()
        .map_err(|error| format!("OpenAI returned an invalid refresh response: {error}"))?;
    let mut token = parse_openai_token(&value)?;
    if token.refresh_token.is_empty() {
        token.refresh_token = refresh_token.to_string();
    }
    Ok(token)
}

fn run_openai_device_login(state: Arc<Mutex<NativeProviderLoginState>>, cancelled: Arc<AtomicBool>) {
    let client = match oauth_http_client() {
        Ok(client) => client,
        Err(error) => {
            fail(&state, error);
            return;
        }
    };
    let response = match client
        .post(OPENAI_DEVICE_USERCODE_URL)
        .json(&json!({ "client_id": OPENAI_CLIENT_ID }))
        .send()
    {
        Ok(response) => response,
        Err(error) => {
            fail(
                &state,
                format!("OpenAI device authorization failed: {error}"),
            );
            return;
        }
    };
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let detail = response
            .json::<Value>()
            .ok()
            .and_then(|body| {
                ["error_description", "error", "message"]
                    .iter()
                    .find_map(|key| {
                        body.get(key)
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .map(String::from)
                    })
            });
        let message = if status == 403 {
            format!(
                "OpenAI rejected the device sign-in (status 403){}. Device code \
                 authorization is likely disabled for your ChatGPT account: open \
                 chatgpt.com → Settings → Security, enable \"Device code \
                 authorization\", then click Sign in again.",
                detail
                    .map(|text| format!(": {text}"))
                    .unwrap_or_default()
            )
        } else {
            format!(
                "OpenAI device authorization failed with status {status}{}.",
                detail
                    .map(|text| format!(": {text}"))
                    .unwrap_or_default()
            )
        };
        fail(&state, message);
        return;
    }
    let value = match response.json::<Value>() {
        Ok(value) => value,
        Err(error) => {
            fail(
                &state,
                format!("OpenAI returned an invalid authorization response: {error}"),
            );
            return;
        }
    };
    let Some(device_auth_id) = value.get("device_auth_id").and_then(Value::as_str) else {
        fail(&state, "OpenAI returned no device authorization id.");
        return;
    };
    let Some(user_code) = value.get("user_code").and_then(Value::as_str) else {
        fail(&state, "OpenAI returned no device authorization code.");
        return;
    };
    let interval_secs = value
        .get("interval")
        .and_then(|interval| {
            interval
                .as_u64()
                .or_else(|| interval.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or(5)
        .saturating_add(3);
    if let Err(error) = open::that(OPENAI_DEVICE_AUTH_URL) {
        fail(
            &state,
            format!("Could not open the OpenAI authorization page: {error}"),
        );
        return;
    }
    update_state(
        &state,
        "waiting_browser",
        format!("Enter code {user_code} on the OpenAI page opened in your browser."),
        None,
    );

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        thread::sleep(Duration::from_secs(interval_secs));
        if cancelled.load(Ordering::SeqCst) {
            return;
        }
        let poll = match client
            .post(OPENAI_DEVICE_TOKEN_URL)
            .json(&json!({
                "device_auth_id": device_auth_id,
                "user_code": user_code,
            }))
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                fail(
                    &state,
                    format!("OpenAI authorization polling failed: {error}"),
                );
                return;
            }
        };
        if matches!(poll.status().as_u16(), 403 | 404) {
            continue;
        }
        if !poll.status().is_success() {
            fail(
                &state,
                format!(
                    "OpenAI authorization failed with status {}.",
                    poll.status().as_u16()
                ),
            );
            return;
        }
        let value = match poll.json::<Value>() {
            Ok(value) => value,
            Err(error) => {
                fail(
                    &state,
                    format!("OpenAI returned an invalid authorization result: {error}"),
                );
                return;
            }
        };
        let Some(code) = value.get("authorization_code").and_then(Value::as_str) else {
            fail(&state, "OpenAI returned no authorization code.");
            return;
        };
        let Some(verifier) = value.get("code_verifier").and_then(Value::as_str) else {
            fail(&state, "OpenAI returned no code verifier.");
            return;
        };
        update_state(&state, "waiting", "Completing OpenAI sign-in…", None);
        match exchange_openai_code(code, verifier).and_then(|token| save_openai_token(&token)) {
            Ok(()) => {
                ProviderModelCatalogService::invalidate();
                let mut current = state.lock();
                current.status = "complete".to_string();
                current.message = "OpenAI subscription connected.".to_string();
                current.prompt = None;
                current.complete = true;
                current.error = None;
            }
            Err(error) => fail(&state, error),
        }
        return;
    }
    fail(&state, "OpenAI sign-in timed out.");
}

fn run_omp_login(
    provider_id: String,
    state: Arc<Mutex<NativeProviderLoginState>>,
    pending_request_id: Arc<Mutex<Option<String>>>,
    input_rx: Receiver<LoginInput>,
    cancelled: Arc<AtomicBool>,
) {
    let mut child = match hidden_command("omp")
        .args([
            "--mode",
            "rpc",
            "--allow-home",
            "--no-session",
            "--no-tools",
            "--no-title",
            "--no-skills",
            "--no-rules",
            "--no-extensions",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            fail(&state, format!("Could not start Oh My Pi: {error}"));
            return;
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        fail(&state, "Could not open the Oh My Pi input stream.");
        let _ = child.kill();
        return;
    };
    let Some(stdout) = child.stdout.take() else {
        fail(&state, "Could not open the Oh My Pi output stream.");
        let _ = child.kill();
        return;
    };

    let (line_tx, line_rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let command = json!({
        "id": "basebuild-provider-login",
        "type": "login",
        "providerId": provider_id,
    });
    if writeln!(stdin, "{command}")
        .and_then(|_| stdin.flush())
        .is_err()
    {
        fail(&state, "Could not start the Oh My Pi sign-in request.");
        let _ = child.kill();
        return;
    }

    update_state(
        &state,
        "waiting",
        "Waiting for the provider authorization page…",
        None,
    );
    let deadline = Instant::now() + LOGIN_TIMEOUT;

    while Instant::now() < deadline {
        if cancelled.load(Ordering::SeqCst) {
            let _ = child.kill();
            return;
        }
        while let Ok((request_id, value)) = input_rx.try_recv() {
            let response = json!({
                "type": "extension_ui_response",
                "id": request_id,
                "value": value,
            });
            if writeln!(stdin, "{response}")
                .and_then(|_| stdin.flush())
                .is_err()
            {
                fail(
                    &state,
                    "Could not submit the provider authorization response.",
                );
                let _ = child.kill();
                return;
            }
            update_state(&state, "waiting", "Completing provider sign-in…", None);
        }

        match line_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if frame.get("type").and_then(Value::as_str) == Some("extension_ui_request") {
                    match frame.get("method").and_then(Value::as_str) {
                        Some("open_url") => {
                            let url = frame
                                .get("launchUrl")
                                .and_then(Value::as_str)
                                .or_else(|| frame.get("url").and_then(Value::as_str));
                            let instructions = frame
                                .get("instructions")
                                .and_then(Value::as_str)
                                .unwrap_or("Complete sign-in in your browser.");
                            if let Some(url) = url {
                                if open::that(url).is_err() {
                                    fail(&state, "Could not open the provider authorization page.");
                                    let _ = child.kill();
                                    return;
                                }
                            }
                            update_state(&state, "waiting_browser", instructions, None);
                        }
                        Some("input") => {
                            let Some(request_id) = frame.get("id").and_then(Value::as_str) else {
                                continue;
                            };
                            let title = frame
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or("Paste the authorization code or callback URL");
                            *pending_request_id.lock() = Some(request_id.to_string());
                            update_state(&state, "waiting_input", title, Some(title.to_string()));
                        }
                        Some("notify") => {
                            if let Some(message) = frame.get("message").and_then(Value::as_str) {
                                update_state(&state, "waiting", message, None);
                            }
                        }
                        _ => {}
                    }
                    continue;
                }
                if frame.get("type").and_then(Value::as_str) == Some("response")
                    && frame.get("command").and_then(Value::as_str) == Some("login")
                {
                    if frame.get("success").and_then(Value::as_bool) == Some(true) {
                        if let Err(error) = NativeChatService::unblock_provider(&provider_id) {
                            fail(&state, error);
                            let _ = child.kill();
                            return;
                        }
                        NativeChatService::refresh_omp_credential_cache();
                        ProviderModelCatalogService::invalidate();
                        let mut current = state.lock();
                        current.status = "complete".to_string();
                        current.message = "Provider connected.".to_string();
                        current.prompt = None;
                        current.complete = true;
                        current.error = None;
                    } else {
                        fail(
                            &state,
                            frame
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Oh My Pi rejected the provider sign-in."),
                        );
                    }
                    let _ = child.kill();
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if child.try_wait().ok().flatten().is_some() {
                    fail(&state, "Oh My Pi stopped before sign-in completed.");
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fail(&state, "Oh My Pi stopped before sign-in completed.");
                let _ = child.kill();
                return;
            }
        }
    }

    let _ = child.kill();
    fail(&state, "Provider sign-in timed out.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_updates_do_not_expose_prompt_ids_in_message() {
        let state = Arc::new(Mutex::new(NativeProviderLoginState {
            provider_id: "anthropic".to_string(),
            status: "starting".to_string(),
            message: String::new(),
            prompt: None,
            complete: false,
            error: None,
        }));
        update_state(&state, "waiting_browser", "Complete sign-in", None);
        let value = state.lock().clone();
        assert_eq!(value.status, "waiting_browser");
        assert_eq!(value.message, "Complete sign-in");
        assert!(value.prompt.is_none());
    }

    #[test]
    fn openai_token_response_requires_complete_rotating_credentials() {
        let token = parse_openai_token(&json!({
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 3600
        }))
        .expect("valid token");
        assert_eq!(token.access_token, "access");
        assert_eq!(token.refresh_token, "refresh");
        assert!(token.expires_at > now_millis());

        let missing_refresh = parse_openai_token(&json!({
            "access_token": "access",
            "expires_in": 3600
        }));
        assert!(missing_refresh.is_err());
    }
}

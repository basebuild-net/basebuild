//! Provider OAuth for Basebuild-native OpenAI Codex and OMP-backed providers.
//!
//! OpenAI Codex sign-in is NATIVE-FIRST: the primary flow is the standard
//! authorization-code + PKCE browser flow with a localhost callback, owned
//! entirely by Basebuild; the device-code flow is the native fallback when
//! the callback port is unavailable. Oh My Pi is ADDITIVE — it is only used
//! as a last resort (and for providers whose OAuth it owns), never as a
//! dependency of the native path. Subscription tokens are stored in
//! Basebuild's local SQLite database. No credential is copied through the
//! webview or written to logs.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
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
const OPENAI_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
/// Registered redirect URI for the Codex OAuth client — the port is fixed.
const OPENAI_BROWSER_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const OPENAI_BROWSER_CALLBACK_ADDR: &str = "127.0.0.1:1455";
const OPENAI_BROWSER_SCOPE: &str = "openid profile email offline_access";
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
// (Legacy global refresh lock removed — refresh is per-account now.)
/// Per-account refresh locks so refreshing one Codex account never blocks or
/// overwrites another's token slot.
static ACCOUNT_REFRESH_LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
                run_openai_native_login(state, pending_request_id, input_rx, cancelled);
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


    /// Authenticated round-trip test for a Codex account: exchanges the
    /// stored refresh token for a fresh access token. Proves the grant is
    /// still valid without touching the chat path.
    pub fn test_codex_account(
        record: &mut crate::services::provider_account_service::ProviderAccountRecord,
    ) -> Result<(), String> {
        let Some(identity) = record
            .identity_key
            .clone()
            .or_else(|| crate::services::provider_client::codex_account_identity(&record.api_key))
        else {
            return Err("This account's token carries no ChatGPT account id.".to_string());
        };
        let account_key = openai_account_storage_key(&identity);
        let token = load_openai_token_at(&account_key)?
            .or(load_openai_token()?.filter(|token| {
                crate::services::provider_client::codex_account_identity(&token.access_token)
                    .as_deref()
                    == Some(identity.as_str())
            }))
            .ok_or_else(|| "No stored OAuth token for this account. Log in again.".to_string())?;
        let refreshed = refresh_openai_token(&token.refresh_token)?;
        save_openai_token_at(&account_key, &refreshed)?;
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE native_provider_accounts SET api_key = ?1, updated_at = ?2 WHERE id = ?3",
            params![&refreshed.access_token, now_millis() / 1000, &record.id],
        )
        .map_err(|error| format!("Failed to store refreshed token: {error}"))?;
        record.api_key = refreshed.access_token;
        Ok(())
    }

    /// Refresh the OAuth token backing one account record (Codex only; other
    /// auth methods are a no-op). Loads the account's own token slot (legacy
    /// single-slot as fallback for pre-migration tokens), refreshes when near
    /// expiry under a per-account lock, persists the new token, and updates
    /// both the record and its stored row with the fresh access token.
    pub fn refresh_account_token(
        record: &mut crate::services::provider_account_service::ProviderAccountRecord,
    ) -> Result<(), String> {
        if record.provider_id != OPENAI_CODEX_PROVIDER_ID
            || record.auth_method != crate::services::provider_account_service::AUTH_OAUTH
        {
            return Ok(());
        }
        let Some(identity) = record
            .identity_key
            .clone()
            .or_else(|| crate::services::provider_client::codex_account_identity(&record.api_key))
        else {
            return Ok(());
        };
        let lock = {
            let mut locks = ACCOUNT_REFRESH_LOCKS.lock();
            locks
                .entry(identity.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock();
        let account_key = openai_account_storage_key(&identity);
        let token = match load_openai_token_at(&account_key)? {
            Some(token) => Some(token),
            None => {
                // Pre-migration fallback: the legacy slot, but only when it
                // actually belongs to this account.
                load_openai_token()?.filter(|token| {
                    crate::services::provider_client::codex_account_identity(&token.access_token)
                        .as_deref()
                        == Some(identity.as_str())
                })
            }
        };
        let Some(token) = token else {
            return Ok(());
        };
        let token = if token.expires_at > now_millis() + TOKEN_REFRESH_SKEW_MS {
            token
        } else {
            let refreshed = refresh_openai_token(&token.refresh_token)?;
            save_openai_token_at(&account_key, &refreshed)?;
            // Keep the legacy single slot in sync when it mirrors this account.
            if load_openai_token()?
                .and_then(|t| {
                    crate::services::provider_client::codex_account_identity(&t.access_token)
                })
                .as_deref()
                == Some(identity.as_str())
            {
                save_openai_token_at(OPENAI_OAUTH_STORAGE_KEY, &refreshed)?;
            }
            refreshed
        };
        if token.access_token != record.api_key {
            let conn = StorageService::connect()?;
            conn.execute(
                "UPDATE native_provider_accounts SET api_key = ?1, updated_at = ?2 WHERE id = ?3",
                params![&token.access_token, now_millis() / 1000, &record.id],
            )
            .map_err(|error| format!("Failed to store refreshed token: {error}"))?;
            record.api_key = token.access_token;
        }
        Ok(())
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

fn openai_account_storage_key(identity: &str) -> String {
    format!("{OPENAI_OAUTH_STORAGE_KEY}:{identity}")
}

fn load_openai_token_at(key: &str) -> Result<Option<OpenAiOAuthToken>, String> {
    let conn = StorageService::connect()?;
    let value = conn
        .query_row(
            "SELECT value FROM app_defaults WHERE key = ?1",
            params![key],
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

fn load_openai_token() -> Result<Option<OpenAiOAuthToken>, String> {
    load_openai_token_at(OPENAI_OAUTH_STORAGE_KEY)
}

fn save_openai_token_at(key: &str, token: &OpenAiOAuthToken) -> Result<(), String> {
    let value = serde_json::to_string(token)
        .map_err(|error| format!("Failed to encode provider OAuth state: {error}"))?;
    let conn = StorageService::connect()?;
    conn.execute(
        "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| format!("Failed to save provider OAuth state: {error}"))?;
    Ok(())
}

/// Best-effort human label for a Codex account decoded locally from the
/// access-token JWT: "email · plan", either half alone, or the generic
/// subscription label. Identity details never leave the machine.
fn codex_account_label(access_token: &str) -> String {
    let claims = decode_jwt_claims(access_token);
    let email = claims
        .as_ref()
        .and_then(|c| {
            c.get("email")
                .or_else(|| c.get("https://api.openai.com/profile").and_then(|p| p.get("email")))
        })
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let plan = claims
        .as_ref()
        .and_then(|c| c.get("https://api.openai.com/auth"))
        .and_then(|auth| auth.get("chatgpt_plan_type"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|plan| {
            let mut chars = plan.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        });
    match (email, plan) {
        (Some(email), Some(plan)) => format!("{email} · {plan}"),
        (Some(email), None) => email,
        (None, Some(plan)) => format!("ChatGPT {plan}"),
        (None, None) => "OpenAI Codex subscription".to_string(),
    }
}

/// Decode a JWT payload (base64url, unverified — we only read our own claims).
fn decode_jwt_claims(token: &str) -> Option<Value> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

fn save_openai_token(token: &OpenAiOAuthToken) -> Result<(), String> {
    // Legacy single slot: kept in sync with the most recent login for the
    // one-release rollback window.
    save_openai_token_at(OPENAI_OAUTH_STORAGE_KEY, token)?;
    // Per-account slot keyed by the ChatGPT account id claim, so several
    // Codex accounts can coexist and refresh independently.
    if let Some(identity) =
        crate::services::provider_client::codex_account_identity(&token.access_token)
    {
        save_openai_token_at(&openai_account_storage_key(&identity), token)?;
    }
    NativeChatService::save_credential(NativeProviderCredentialInput {
        provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
        label: codex_account_label(&token.access_token),
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

fn exchange_openai_code(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<OpenAiOAuthToken, String> {
    let response = oauth_http_client()?
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
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

/// How the native browser OAuth flow ended. `Finished` means the flow wrote
/// its own terminal state; `Unavailable` means it never started (callback
/// port busy or listener setup failed) and the caller should try the native
/// device-code flow instead.
enum BrowserLoginOutcome {
    Finished,
    Unavailable { reason: String },
}

/// Native OpenAI Codex sign-in chain. Every step is Basebuild-owned:
/// 1. Browser authorization-code + PKCE flow with a localhost callback
///    (no ChatGPT account setting required).
/// 2. Device-code flow if the callback port is unavailable.
/// 3. Only as a last, additive resort — when the device flow is rejected
///    because the account disables device code authorization — delegate to
///    Oh My Pi if it happens to be installed.
fn run_openai_native_login(
    state: Arc<Mutex<NativeProviderLoginState>>,
    pending_request_id: Arc<Mutex<Option<String>>>,
    input_rx: Receiver<LoginInput>,
    cancelled: Arc<AtomicBool>,
) {
    match run_openai_browser_login(state.clone(), cancelled.clone()) {
        BrowserLoginOutcome::Finished => return,
        BrowserLoginOutcome::Unavailable { reason } => {
            update_state(
                &state,
                "waiting",
                format!("Browser sign-in unavailable ({reason}). Trying device code sign-in…"),
                None,
            );
        }
    }
    match run_openai_device_login(state.clone(), cancelled.clone()) {
        DeviceLoginOutcome::Finished => {}
        DeviceLoginOutcome::DeviceAuthDisabled { detail } => {
            if crate::services::provider_client::omp_available() {
                update_state(
                    &state,
                    "waiting",
                    "Device code sign-in is disabled for this ChatGPT account. \
                     Switching to browser sign-in through Oh My Pi…",
                    None,
                );
                run_omp_login(
                    OPENAI_CODEX_PROVIDER_ID.to_string(),
                    state,
                    pending_request_id,
                    input_rx,
                    cancelled,
                );
            } else {
                fail(&state, device_auth_disabled_message(detail));
            }
        }
    }
}

fn run_openai_browser_login(
    state: Arc<Mutex<NativeProviderLoginState>>,
    cancelled: Arc<AtomicBool>,
) -> BrowserLoginOutcome {
    // The redirect URI registered for the Codex client id pins the port, so
    // bind BEFORE opening the browser: a busy port degrades to the device
    // flow instead of sending the user to a dead callback.
    let listener = match TcpListener::bind(OPENAI_BROWSER_CALLBACK_ADDR) {
        Ok(listener) => listener,
        Err(error) => {
            return BrowserLoginOutcome::Unavailable {
                reason: format!("callback port 1455 is busy: {error}"),
            }
        }
    };
    if let Err(error) = listener.set_nonblocking(true) {
        return BrowserLoginOutcome::Unavailable {
            reason: format!("callback listener setup failed: {error}"),
        };
    }

    let (pkce_challenge, pkce_verifier) = oauth2::PkceCodeChallenge::new_random_sha256();
    let csrf_state = uuid::Uuid::new_v4().simple().to_string();
    let auth_url = format!(
        "{OPENAI_AUTHORIZE_URL}?response_type=code&client_id={OPENAI_CLIENT_ID}\
         &redirect_uri={redirect}&scope={scope}&code_challenge={challenge}\
         &code_challenge_method=S256&state={csrf_state}\
         &id_token_add_organizations=true&codex_cli_simplified_flow=true\
         &originator=basebuild",
        redirect = urlencoding::encode(OPENAI_BROWSER_REDIRECT_URI),
        scope = urlencoding::encode(OPENAI_BROWSER_SCOPE),
        challenge = pkce_challenge.as_str(),
    );
    if let Err(error) = open::that(&auth_url) {
        fail(
            &state,
            format!("Could not open the OpenAI sign-in page: {error}"),
        );
        return BrowserLoginOutcome::Finished;
    }
    update_state(
        &state,
        "waiting_browser",
        "Complete the OpenAI sign-in in the browser tab that just opened.",
        None,
    );

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    let code = loop {
        if cancelled.load(Ordering::SeqCst) {
            return BrowserLoginOutcome::Finished;
        }
        if Instant::now() >= deadline {
            fail(&state, "OpenAI sign-in timed out.");
            return BrowserLoginOutcome::Finished;
        }
        match listener.accept() {
            Ok((stream, _)) => match handle_callback_request(stream, &csrf_state) {
                CallbackResult::Code(code) => break code,
                CallbackResult::Denied(reason) => {
                    fail(&state, reason);
                    return BrowserLoginOutcome::Finished;
                }
                CallbackResult::Ignored => {}
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(150));
            }
            Err(_) => thread::sleep(Duration::from_millis(150)),
        }
    };

    update_state(&state, "waiting", "Completing OpenAI sign-in…", None);
    match exchange_openai_code(&code, pkce_verifier.secret(), OPENAI_BROWSER_REDIRECT_URI)
        .and_then(|token| save_openai_token(&token))
    {
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
    BrowserLoginOutcome::Finished
}

enum CallbackResult {
    Code(String),
    Denied(String),
    Ignored,
}

/// Serve one connection on the callback listener. Only `/auth/callback` is
/// meaningful; anything else (favicon probes, port scans) gets a 404 and is
/// ignored. The response page never contains the authorization code.
fn handle_callback_request(stream: TcpStream, expected_state: &str) -> CallbackResult {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let Ok(reader_stream) = stream.try_clone() else {
        return CallbackResult::Ignored;
    };
    let mut request_line = String::new();
    if BufReader::new(reader_stream)
        .read_line(&mut request_line)
        .is_err()
    {
        return CallbackResult::Ignored;
    }
    // "GET /auth/callback?code=…&state=… HTTP/1.1"
    let Some(target) = request_line.split_whitespace().nth(1) else {
        respond(&stream, "400 Bad Request", "Bad request.");
        return CallbackResult::Ignored;
    };
    let result = parse_callback_target(target, expected_state);
    match &result {
        CallbackResult::Code(_) => respond(
            &stream,
            "200 OK",
            "You are signed in. You can close this tab and return to Basebuild.",
        ),
        CallbackResult::Denied(_) => respond(
            &stream,
            "200 OK",
            "Sign-in was not completed. Return to Basebuild for details.",
        ),
        CallbackResult::Ignored => respond(&stream, "404 Not Found", "Not found."),
    }
    result
}

/// Parse the request target of a callback hit. Pure so it is unit-testable
/// without sockets. Enforces the CSRF `state` round-trip.
fn parse_callback_target(target: &str, expected_state: &str) -> CallbackResult {
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    };
    if path != "/auth/callback" {
        return CallbackResult::Ignored;
    }
    let mut code = None;
    let mut state_param = None;
    let mut error = None;
    let mut error_description = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let Ok(value) = urlencoding::decode(value) else {
            continue;
        };
        match key {
            "code" => code = Some(value.into_owned()),
            "state" => state_param = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            _ => {}
        }
    }
    if let Some(error) = error {
        return CallbackResult::Denied(format!(
            "OpenAI sign-in was denied: {}.",
            error_description.unwrap_or(error)
        ));
    }
    if state_param.as_deref() != Some(expected_state) {
        return CallbackResult::Denied(
            "OpenAI sign-in failed: the callback state did not match (possible CSRF). \
             Click Sign in to try again."
                .to_string(),
        );
    }
    match code.filter(|code| !code.is_empty()) {
        Some(code) => CallbackResult::Code(code),
        None => CallbackResult::Denied("OpenAI returned no authorization code.".to_string()),
    }
}

fn respond(mut stream: &TcpStream, status: &str, body: &str) {
    let page = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Basebuild</title></head>\
         <body style=\"font-family:sans-serif;margin:48px\"><h2>{body}</h2></body></html>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.flush();
}

/// How the native OpenAI device-code flow ended. `Finished` means the flow
/// wrote its own terminal state (success, failure, or cancel); the disabled
/// case is returned to the caller so it can fall back to the OMP browser
/// OAuth flow, which does not require the ChatGPT security setting.
enum DeviceLoginOutcome {
    Finished,
    DeviceAuthDisabled { detail: Option<String> },
}

fn device_auth_disabled_message(detail: Option<String>) -> String {
    format!(
        "OpenAI rejected the device sign-in{}. Device code authorization is \
         disabled for your ChatGPT account: open chatgpt.com → Settings → \
         Security, enable \"Device code authorization\", then click Sign in \
         again. Alternatively, install Oh My Pi so Basebuild can sign in \
         through your browser without changing that setting.",
        detail
            .map(|text| format!(" ({text})"))
            .unwrap_or_default()
    )
}

fn run_openai_device_login(
    state: Arc<Mutex<NativeProviderLoginState>>,
    cancelled: Arc<AtomicBool>,
) -> DeviceLoginOutcome {
    let client = match oauth_http_client() {
        Ok(client) => client,
        Err(error) => {
            fail(&state, error);
            return DeviceLoginOutcome::Finished;
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
            return DeviceLoginOutcome::Finished;
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
        if status == 403 {
            return DeviceLoginOutcome::DeviceAuthDisabled { detail };
        }
        fail(
            &state,
            format!(
                "OpenAI device authorization failed with status {status}{}.",
                detail
                    .map(|text| format!(": {text}"))
                    .unwrap_or_default()
            ),
        );
        return DeviceLoginOutcome::Finished;
    }
    let value = match response.json::<Value>() {
        Ok(value) => value,
        Err(error) => {
            fail(
                &state,
                format!("OpenAI returned an invalid authorization response: {error}"),
            );
            return DeviceLoginOutcome::Finished;
        }
    };
    let Some(device_auth_id) = value.get("device_auth_id").and_then(Value::as_str) else {
        fail(&state, "OpenAI returned no device authorization id.");
        return DeviceLoginOutcome::Finished;
    };
    let Some(user_code) = value.get("user_code").and_then(Value::as_str) else {
        fail(&state, "OpenAI returned no device authorization code.");
        return DeviceLoginOutcome::Finished;
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
        return DeviceLoginOutcome::Finished;
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
            return DeviceLoginOutcome::Finished;
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
                return DeviceLoginOutcome::Finished;
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
            return DeviceLoginOutcome::Finished;
        }
        let value = match poll.json::<Value>() {
            Ok(value) => value,
            Err(error) => {
                fail(
                    &state,
                    format!("OpenAI returned an invalid authorization result: {error}"),
                );
                return DeviceLoginOutcome::Finished;
            }
        };
        let Some(code) = value.get("authorization_code").and_then(Value::as_str) else {
            fail(&state, "OpenAI returned no authorization code.");
            return DeviceLoginOutcome::Finished;
        };
        let Some(verifier) = value.get("code_verifier").and_then(Value::as_str) else {
            fail(&state, "OpenAI returned no code verifier.");
            return DeviceLoginOutcome::Finished;
        };
        update_state(&state, "waiting", "Completing OpenAI sign-in…", None);
        match exchange_openai_code(code, verifier, OPENAI_DEVICE_REDIRECT_URI)
            .and_then(|token| save_openai_token(&token))
        {
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
        return DeviceLoginOutcome::Finished;
    }
    fail(&state, "OpenAI sign-in timed out.");
    DeviceLoginOutcome::Finished
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

    #[test]
    fn device_auth_disabled_message_names_the_chatgpt_setting() {
        let message =
            device_auth_disabled_message(Some("device auth disabled for account".to_string()));
        assert!(message.contains("(device auth disabled for account)"));
        assert!(message.contains("Device code authorization"));
        assert!(message.contains("chatgpt.com"));

        let bare = device_auth_disabled_message(None);
        assert!(bare.contains("Settings"));
        assert!(!bare.contains("()"));
    }

    #[test]
    fn callback_request_round_trip_over_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("local addr");
        let client = thread::spawn(move || {
            use std::io::Read;
            let mut stream = TcpStream::connect(addr).expect("connect");
            write!(
                stream,
                "GET /auth/callback?code=xyz&state=s1 HTTP/1.1\r\nHost: localhost\r\n\r\n"
            )
            .expect("send request");
            let mut response = String::new();
            stream.read_to_string(&mut response).expect("read response");
            response
        });
        let (stream, _) = listener.accept().expect("accept");
        let result = handle_callback_request(stream, "s1");
        let response = client.join().expect("client thread");
        assert!(matches!(result, CallbackResult::Code(code) if code == "xyz"));
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(
            !response.contains("xyz"),
            "authorization code must not echo into the response page"
        );
    }

    #[test]
    fn callback_target_accepts_matching_state_and_code() {
        let result = parse_callback_target("/auth/callback?code=abc123&state=expected", "expected");
        match result {
            CallbackResult::Code(code) => assert_eq!(code, "abc123"),
            _ => panic!("expected code"),
        }
    }

    #[test]
    fn callback_target_rejects_state_mismatch() {
        let result = parse_callback_target("/auth/callback?code=abc&state=forged", "expected");
        match result {
            CallbackResult::Denied(reason) => assert!(reason.contains("state")),
            _ => panic!("expected denial"),
        }
    }

    #[test]
    fn callback_target_surfaces_provider_error() {
        let result = parse_callback_target(
            "/auth/callback?error=access_denied&error_description=User%20cancelled&state=expected",
            "expected",
        );
        match result {
            CallbackResult::Denied(reason) => assert!(reason.contains("User cancelled")),
            _ => panic!("expected denial"),
        }
    }

    #[test]
    fn callback_target_ignores_unrelated_paths() {
        assert!(matches!(
            parse_callback_target("/favicon.ico", "expected"),
            CallbackResult::Ignored
        ));
        assert!(matches!(
            parse_callback_target("/auth/callback?state=expected", "expected"),
            CallbackResult::Denied(_)
        ));
    }
}

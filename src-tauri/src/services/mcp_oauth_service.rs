//! OAuth flow for MCP HTTP/SSE servers.
//!
//! Reuses rmcp's `AuthorizationManager` for metadata discovery (RFC 8414) and
//! PKCE token exchange, and uses a localhost loopback listener for the
//! authorization-code callback. Tokens are
//! persisted in `app_defaults` keyed `mcp_oauth:<server-url>` so they survive
//! restarts and are scoped per server URL.
//!
//! All network I/O is user-initiated: OAuth only runs when the user clicks
//! "Authorize" in the Settings MCP section for a server that requires auth.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::services::storage_service::StorageService;
use oauth2::TokenResponse;

/// Key prefix for persisted MCP OAuth tokens in `app_defaults`.
const MCP_OAUTH_KEY_PREFIX: &str = "mcp_oauth:";

/// Loopback listener timeout — generous for a user to complete a browser flow.
const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);

/// The redirect URI used for the OAuth flow. We always bind an ephemeral
/// loopback port; the server's OAuth config may override the path.
const LOOPBACK_HOST: &str = "127.0.0.1";

/// Persisted OAuth token bundle for one MCP server URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMcpToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Lifetime in seconds (when provided by the server).
    pub expires_in: Option<u64>,
    /// Token type (usually "Bearer").
    pub token_type: Option<String>,
    /// Granted scopes.
    pub scopes: Vec<String>,
    /// When we received the token (epoch seconds).
    pub received_at: i64,
}

/// Result of starting an OAuth flow for a server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthStart {
    /// The server URL we're authorizing for.
    pub server_url: String,
    /// The authorization URL to open in the browser.
    pub auth_url: String,
    /// The loopback landing URL.
    pub landing_url: String,
}

/// Poll result for an in-flight OAuth flow.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthPoll {
    /// One of: "pending", "success", "error", "cancelled".
    pub status: String,
    pub message: Option<String>,
}

#[derive(Clone)]
enum FlowStatus {
    Pending,
    Success,
    Error(String),
    Cancelled,
}

/// Active OAuth flows keyed by server URL.
static FLOWS: LazyLock<Mutex<HashMap<String, FlowStatus>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub struct McpOAuthService;

impl McpOAuthService {
    /// Get the stored token for a server URL, if any.
    pub fn get_token(server_url: &str) -> Result<Option<StoredMcpToken>, String> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = ?1",
                params![format!("{MCP_OAUTH_KEY_PREFIX}{server_url}")],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        match value {
            Some(v) => {
                let token: StoredMcpToken =
                    serde_json::from_str(&v).map_err(|e| format!("parse mcp oauth token: {e}"))?;
                Ok(Some(token))
            }
            None => Ok(None),
        }
    }

    /// Persist a token for a server URL.
    pub fn save_token(server_url: &str, token: &StoredMcpToken) -> Result<(), String> {
        let conn = StorageService::connect()?;
        let value = serde_json::to_string(token).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![format!("{MCP_OAUTH_KEY_PREFIX}{server_url}"), value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Clear the stored token for a server URL.
    pub fn clear_token(server_url: &str) -> Result<(), String> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM app_defaults WHERE key = ?1",
            params![format!("{MCP_OAUTH_KEY_PREFIX}{server_url}")],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Get the Authorization header value for a server URL, if a token exists.
    /// Returns `None` if no token is stored.
    pub fn auth_header(server_url: &str) -> Result<Option<String>, String> {
        let token = Self::get_token(server_url)?;
        match token {
            Some(t) => {
                let token_type = t.token_type.unwrap_or_else(|| "Bearer".to_string());
                Ok(Some(format!("{token_type} {}", t.access_token)))
            }
            None => Ok(None),
        }
    }

    /// Start an OAuth flow for a server URL. Spawns a background thread that:
    /// 1. Discovers OAuth metadata from the server (RFC 8414).
    /// 2. Builds the authorization URL with PKCE.
    /// 3. Opens a loopback listener for the callback.
    /// 4. Opens the browser to the authorization URL.
    pub async fn start_flow(server_url: &str) -> Result<McpOAuthStart, String> {
        // Cancel any existing flow for this URL.
        Self::cancel_flow(server_url);

        // Bind the loopback listener first so we know the redirect URI.
        let listener = TcpListener::bind(format!("{LOOPBACK_HOST}:0"))
            .map_err(|e| format!("Failed to start OAuth listener: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to configure OAuth listener: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect_uri = format!("http://{LOOPBACK_HOST}:{port}/callback");

        // Discover OAuth metadata and build the authorization URL.
        let mut auth_manager = rmcp::transport::auth::AuthorizationManager::new(server_url)
            .await
            .map_err(|e| format!("OAuth manager init failed: {e}"))?;

        let metadata = auth_manager
            .discover_metadata()
            .await
            .map_err(|e| format!("OAuth metadata discovery failed: {e}"))?;
        auth_manager.set_metadata(metadata);

        // Use configured scopes or empty (server defaults).
        let scopes: Vec<&str> = Vec::new();
        let auth_url = auth_manager
            .get_authorization_url(&scopes)
            .await
            .map_err(|e| format!("Failed to build authorization URL: {e}"))?;

        // Mark the flow as pending.
        FLOWS
            .lock()
            .insert(server_url.to_string(), FlowStatus::Pending);

        // Spawn the listener thread.
        let server_url_owned = server_url.to_string();
        let redirect_uri_owned = redirect_uri.clone();
        std::thread::spawn(move || {
            Self::run_callback_listener(listener, &server_url_owned, &redirect_uri_owned);
        });

        // Open the authorization URL in the browser.
        let landing_url = format!("http://{LOOPBACK_HOST}:{port}/");
        let _ = open::that(&auth_url);

        Ok(McpOAuthStart {
            server_url: server_url.to_string(),
            auth_url,
            landing_url,
        })
    }

    /// Poll an in-flight OAuth flow.
    pub fn poll_flow(server_url: &str) -> McpOAuthPoll {
        let mut guard = FLOWS.lock();
        match guard.get(server_url).cloned() {
            Some(FlowStatus::Pending) => McpOAuthPoll {
                status: "pending".to_string(),
                message: None,
            },
            Some(FlowStatus::Success) => {
                guard.remove(server_url);
                McpOAuthPoll {
                    status: "success".to_string(),
                    message: None,
                }
            }
            Some(FlowStatus::Error(msg)) => {
                guard.remove(server_url);
                McpOAuthPoll {
                    status: "error".to_string(),
                    message: Some(msg),
                }
            }
            Some(FlowStatus::Cancelled) => {
                guard.remove(server_url);
                McpOAuthPoll {
                    status: "cancelled".to_string(),
                    message: None,
                }
            }
            None => McpOAuthPoll {
                status: "error".to_string(),
                message: Some("No active OAuth flow for this server.".to_string()),
            },
        }
    }

    /// Cancel an in-flight OAuth flow.
    pub fn cancel_flow(server_url: &str) {
        FLOWS
            .lock()
            .insert(server_url.to_string(), FlowStatus::Cancelled);
    }

    /// Run the loopback listener that captures the OAuth callback.
    /// On success, exchanges the code for a token and persists it.
    fn run_callback_listener(listener: TcpListener, server_url: &str, _redirect_uri: &str) {
        let deadline = Instant::now() + OAUTH_TIMEOUT;
        loop {
            // Check for cancellation or completion.
            {
                let guard = FLOWS.lock();
                match guard.get(server_url) {
                    Some(FlowStatus::Cancelled) => return,
                    Some(FlowStatus::Success) | Some(FlowStatus::Error(_)) => return,
                    _ => {}
                }
            }
            if Instant::now() >= deadline {
                FLOWS.lock().insert(
                    server_url.to_string(),
                    FlowStatus::Error("OAuth timed out.".to_string()),
                );
                return;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    Self::handle_callback_conn(stream, server_url);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(120));
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(120));
                }
            }
        }
    }

    /// Handle one callback connection. Exchanges the code for a token.
    fn handle_callback_conn(mut stream: std::net::TcpStream, server_url: &str) {
        let mut reader = BufReader::new(match stream.try_clone() {
            Ok(s) => s,
            Err(_) => return,
        });

        // Parse the request line to extract the callback URL.
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        let mut parts = request_line.split_whitespace();
        let _method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("/");

        // Read and discard headers.
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).is_err() {
                break;
            }
            if header.trim().is_empty() {
                break;
            }
        }

        // The callback URL contains the code and state.
        let callback_url = format!("http://{LOOPBACK_HOST}{path}");

        // Exchange the code for a token using a blocking runtime.
        let result = Self::exchange_code_blocking(server_url, &callback_url);

        match result {
            Ok(token) => {
                if let Err(e) = Self::save_token(server_url, &token) {
                    FLOWS
                        .lock()
                        .insert(server_url.to_string(), FlowStatus::Error(e));
                    Self::respond(
                        &mut stream,
                        &result_page("Failed to save the token. Return to Basebuild."),
                    );
                } else {
                    FLOWS
                        .lock()
                        .insert(server_url.to_string(), FlowStatus::Success);
                    Self::respond(&mut stream, &result_page("MCP server authorized. You can close this tab and return to Basebuild."));
                }
            }
            Err(e) => {
                FLOWS
                    .lock()
                    .insert(server_url.to_string(), FlowStatus::Error(e));
                Self::respond(
                    &mut stream,
                    &result_page("Authorization failed. Return to Basebuild."),
                );
            }
        }
    }

    /// Exchange an authorization code for a token using a blocking tokio runtime.
    /// This runs in the listener thread so it doesn't block the async command.
    fn exchange_code_blocking(
        server_url: &str,
        callback_url: &str,
    ) -> Result<StoredMcpToken, String> {
        // Build a runtime for the async exchange.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("Failed to create runtime: {e}"))?;

        runtime.block_on(async {
            let mut auth_manager = rmcp::transport::auth::AuthorizationManager::new(server_url)
                .await
                .map_err(|e| format!("OAuth manager init failed: {e}"))?;

            let metadata = auth_manager
                .discover_metadata()
                .await
                .map_err(|e| format!("OAuth metadata discovery failed: {e}"))?;
            auth_manager.set_metadata(metadata);

            // Build a session with the redirect URI we registered.
            let redirect_uri = format!("http://{LOOPBACK_HOST}/callback");
            let scopes: Vec<&str> = Vec::new();
            let session = rmcp::transport::auth::AuthorizationSession::new(
                auth_manager,
                &scopes,
                &redirect_uri,
                Some("Basebuild"),
                None,
            )
            .await
            .map_err(|e| format!("OAuth session creation failed: {e}"))?;

            // Handle the callback to exchange the code for a token.
            let token_response = session
                .handle_callback_url(callback_url)
                .await
                .map_err(|e| format!("Token exchange failed: {e}"))?;

            // Extract the fields we need from the oauth2 TokenResponse.
            let access_token = token_response.access_token().secret().to_string();
            let refresh_token = token_response
                .refresh_token()
                .map(|t| t.secret().to_string());
            let expires_in = token_response.expires_in().map(|d| d.as_secs());
            let token_type = Some(token_response.token_type().as_ref().to_string());
            let scopes = token_response
                .scopes()
                .map(|s| s.iter().map(|sc| sc.to_string()).collect())
                .unwrap_or_default();

            Ok(StoredMcpToken {
                access_token,
                refresh_token,
                expires_in,
                token_type,
                scopes,
                received_at: now_seconds(),
            })
        })
    }

    fn respond(stream: &mut std::net::TcpStream, body: &str) {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.as_bytes().len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn result_page(message: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Basebuild MCP Authorization</title>
<style>body{{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center;}}</style>
</head><body><p>{message}</p></body></html>"#
    )
}

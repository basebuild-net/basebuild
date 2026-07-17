//! Web/loopback provider login.
//!
//! Opens the provider's key/authorization page in the system browser and runs a
//! localhost loopback listener that captures the credential via an HTTP POST
//! (never a URL query string, never logged). The captured secret is persisted
//! through the same local credential store used by manual API-key entry.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::models::native_chat::{
    NativeProviderCredentialInput, ProviderLoginPoll, ProviderLoginStart,
};
use crate::services::native_chat_service::NativeChatService;

type DbResult<T> = Result<T, String>;

#[derive(Clone)]
enum LoginStatus {
    Pending,
    Success,
    Error(String),
    Cancelled,
}

/// Active loopback login sessions keyed by provider id. The initializer (empty
/// map) is known here, so this is a `LazyLock`, not a `OnceLock`.
static SESSIONS: LazyLock<Mutex<HashMap<String, LoginStatus>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Resolve a provider's display label and key/authorization page URL.
fn provider_meta(provider_id: &str) -> Option<(&'static str, &'static str)> {
    match provider_id {
        "openai" => Some(("OpenAI", "https://platform.openai.com/api-keys")),
        "anthropic" => Some(("Anthropic", "https://console.anthropic.com/settings/keys")),
        "umans" => Some(("Umans", "https://umans.ai")),
        _ => None,
    }
}

fn set_status(provider_id: &str, status: LoginStatus) {
    SESSIONS.lock().insert(provider_id.to_string(), status);
}

fn is_cancelled(provider_id: &str) -> bool {
    matches!(
        SESSIONS.lock().get(provider_id),
        Some(LoginStatus::Cancelled)
    )
}

pub struct ProviderLoginService;

impl ProviderLoginService {
    /// Start a loopback login flow: bind an ephemeral localhost port, open the
    /// landing page in the browser, and spawn a capture thread.
    pub fn start(provider_id: &str) -> DbResult<ProviderLoginStart> {
        let (label, provider_url) = provider_meta(provider_id)
            .ok_or_else(|| format!("Provider '{provider_id}' does not support web login."))?;

        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to start local login listener: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to configure login listener: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        set_status(provider_id, LoginStatus::Pending);

        let provider_id_owned = provider_id.to_string();
        let label_owned = label.to_string();
        let provider_url_owned = provider_url.to_string();
        std::thread::spawn(move || {
            Self::run_capture(
                listener,
                &provider_id_owned,
                &label_owned,
                &provider_url_owned,
            );
        });

        let landing_url = format!("http://127.0.0.1:{port}/");
        // Open the loopback landing page (which links to the provider's page) in
        // the system browser. The landing URL carries no secret.
        let _ = open::that(&landing_url);

        Ok(ProviderLoginStart {
            provider_id: provider_id.to_string(),
            provider_label: label.to_string(),
            landing_url,
            provider_url: provider_url.to_string(),
        })
    }

    /// Poll the flow. Terminal states are removed on read.
    pub fn poll(provider_id: &str) -> ProviderLoginPoll {
        let mut guard = SESSIONS.lock();
        match guard.get(provider_id).cloned() {
            Some(LoginStatus::Pending) => ProviderLoginPoll {
                status: "pending".to_string(),
                message: None,
            },
            Some(LoginStatus::Success) => {
                guard.remove(provider_id);
                ProviderLoginPoll {
                    status: "success".to_string(),
                    message: None,
                }
            }
            Some(LoginStatus::Error(msg)) => {
                guard.remove(provider_id);
                ProviderLoginPoll {
                    status: "error".to_string(),
                    message: Some(msg),
                }
            }
            Some(LoginStatus::Cancelled) => {
                guard.remove(provider_id);
                ProviderLoginPoll {
                    status: "cancelled".to_string(),
                    message: None,
                }
            }
            None => ProviderLoginPoll {
                status: "error".to_string(),
                message: Some("No active login for this provider.".to_string()),
            },
        }
    }

    /// Cancel an in-flight flow. The capture thread exits on its next tick.
    pub fn cancel(provider_id: &str) {
        set_status(provider_id, LoginStatus::Cancelled);
    }

    fn run_capture(listener: TcpListener, provider_id: &str, label: &str, provider_url: &str) {
        let deadline = Instant::now() + LOGIN_TIMEOUT;
        loop {
            if is_cancelled(provider_id) {
                return;
            }
            if Instant::now() >= deadline {
                set_status(
                    provider_id,
                    LoginStatus::Error("Login timed out.".to_string()),
                );
                return;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if Self::handle_conn(stream, provider_id, label, provider_url) {
                        // Credential captured and persisted.
                        return;
                    }
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

    /// Handle one connection. Returns true when a credential was captured.
    fn handle_conn(
        mut stream: TcpStream,
        provider_id: &str,
        label: &str,
        provider_url: &str,
    ) -> bool {
        let mut reader = BufReader::new(match stream.try_clone() {
            Ok(s) => s,
            Err(_) => return false,
        });

        // Request line: METHOD PATH HTTP/1.1
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return false;
        }
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("/").to_string();

        // Headers → find Content-Length.
        let mut content_length = 0usize;
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).is_err() {
                break;
            }
            let trimmed = header.trim_end();
            if trimmed.is_empty() {
                break;
            }
            if let Some(value) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }

        if method == "POST" && path.starts_with("/submit") {
            let mut body = vec![0u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                Self::respond(&mut stream, "400 Bad Request", "text/plain", "Bad request");
                return false;
            }
            let body_str = String::from_utf8_lossy(&body);
            let fields = parse_form(&body_str);
            let api_key = fields
                .get("api_key")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            let base_url = fields
                .get("base_url")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if api_key.is_empty() {
                Self::respond(
                    &mut stream,
                    "200 OK",
                    "text/html",
                    &result_page("No key was provided. Return to Basebuild and try again."),
                );
                return false;
            }

            let save = NativeChatService::save_credential(NativeProviderCredentialInput {
                provider_id: provider_id.to_string(),
                label: label.to_string(),
                api_key,
                base_url,
            });
            match save {
                Ok(_) => {
                    set_status(provider_id, LoginStatus::Success);
                    Self::respond(
                        &mut stream,
                        "200 OK",
                        "text/html",
                        &result_page(&format!(
                            "{label} connected. You can close this tab and return to Basebuild."
                        )),
                    );
                    true
                }
                Err(e) => {
                    // Do not include the secret; only the failure reason.
                    set_status(provider_id, LoginStatus::Error(e.clone()));
                    Self::respond(
                        &mut stream,
                        "200 OK",
                        "text/html",
                        &result_page("Failed to save the credential. Return to Basebuild."),
                    );
                    false
                }
            }
        } else if path.starts_with("/cancel") {
            set_status(provider_id, LoginStatus::Cancelled);
            Self::respond(
                &mut stream,
                "200 OK",
                "text/html",
                &result_page("Login cancelled. You can close this tab."),
            );
            true
        } else {
            Self::respond(
                &mut stream,
                "200 OK",
                "text/html",
                &landing_page(label, provider_url),
            );
            false
        }
    }

    fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.as_bytes().len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

/// Parse an `application/x-www-form-urlencoded` body into a map.
fn parse_form(body: &str) -> HashMap<String, String> {
    body.split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            let key = it.next()?;
            let value = it.next().unwrap_or("");
            Some((
                urlencoding::decode(key)
                    .map(|c| c.into_owned())
                    .unwrap_or_default(),
                urlencoding::decode(value)
                    .map(|c| c.into_owned())
                    .unwrap_or_default(),
            ))
        })
        .collect()
}

fn landing_page(label: &str, provider_url: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Connect {label}</title>\
         <style>body{{font-family:system-ui,sans-serif;background:#0f0f11;color:#e6e6e6;\
         max-width:520px;margin:48px auto;padding:0 20px;line-height:1.5}}\
         a.btn,button{{display:inline-block;background:#2563eb;color:#fff;border:0;\
         padding:10px 16px;text-decoration:none;cursor:pointer;font-size:14px}}\
         input{{width:100%;box-sizing:border-box;padding:10px;margin:6px 0;background:#1a1a1e;\
         border:1px solid #333;color:#e6e6e6;font-size:14px}}\
         .muted{{color:#9a9a9a;font-size:13px}}</style></head>\
         <body><h2>Connect {label}</h2>\
         <p class=\"muted\">Step 1 — open {label} and copy an API key:</p>\
         <p><a class=\"btn\" href=\"{provider_url}\" target=\"_blank\" rel=\"noopener\">Open {label} \u{2197}</a></p>\
         <p class=\"muted\">Step 2 — paste the key below. It is sent only to Basebuild on this \
         computer (localhost) and stored locally.</p>\
         <form method=\"POST\" action=\"/submit\">\
         <input name=\"api_key\" type=\"password\" placeholder=\"API key\" autofocus />\
         <input name=\"base_url\" type=\"text\" placeholder=\"Base URL (optional)\" />\
         <button type=\"submit\">Connect</button></form></body></html>"
    )
}

fn result_page(message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Basebuild</title>\
         <style>body{{font-family:system-ui,sans-serif;background:#0f0f11;color:#e6e6e6;\
         max-width:520px;margin:48px auto;padding:0 20px;line-height:1.5}}</style></head>\
         <body><h2>Basebuild</h2><p>{message}</p></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_form_decodes_pairs() {
        let form = parse_form("api_key=sk-abc%20123&base_url=https%3A%2F%2Fx.dev%2Fv1");
        assert_eq!(form.get("api_key").map(String::as_str), Some("sk-abc 123"));
        assert_eq!(
            form.get("base_url").map(String::as_str),
            Some("https://x.dev/v1")
        );
    }

    #[test]
    fn provider_meta_known_and_unknown() {
        assert!(provider_meta("openai").is_some());
        assert!(provider_meta("anthropic").is_some());
        assert!(provider_meta("umans").is_some());
        assert!(provider_meta("basebuild-local").is_none());
    }

    #[test]
    fn landing_page_never_contains_secret_field_value() {
        let page = landing_page("OpenAI", "https://example.com");
        assert!(page.contains("Connect OpenAI"));
        assert!(page.contains("type=\"password\""));
    }
}

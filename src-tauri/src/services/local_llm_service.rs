//! Local-LLM detection: probe `127.0.0.1` for running OpenAI-compatible /
//! Ollama servers (LM Studio, Ollama, llama.cpp, KoboldCpp), classify them,
//! and persist the last-known set so a server that goes offline keeps its
//! provider row (and cached models) until it returns.
//!
//! Detection is device-local: it never contacts a non-loopback host and
//! never emits telemetry. Probes run concurrently with a short per-endpoint
//! timeout so an absent server does not stall the catalog.

use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::storage_service::StorageService;

type DbResult<T> = Result<T, String>;

pub const KIND_LMSTUDIO: &str = "lmstudio";
pub const KIND_OLLAMA: &str = "ollama";
pub const KIND_LLAMACPP: &str = "llamacpp";
pub const KIND_KOBOLDCPP: &str = "koboldcpp";

/// Per-endpoint probe timeout. Kept short so a dead port fails fast.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// A local LLM server slot: a well-known loopback endpoint we probe. The set
/// is fixed (no arbitrary port sweep — that is the manual `custom` provider's
/// job and a security footgun to automate).
struct ProbeTarget {
    /// Stable provider id, e.g. `local-lmstudio`.
    provider_id: &'static str,
    kind: &'static str,
    /// Loopback root, e.g. `http://127.0.0.1:1234`.
    root: &'static str,
    /// Discovery style: Ollama uses `/api/tags`; the rest use `/v1/models`.
    ollama: bool,
}

const PROBE_TARGETS: &[ProbeTarget] = &[
    ProbeTarget {
        provider_id: "local-ollama",
        kind: KIND_OLLAMA,
        root: "http://127.0.0.1:11434",
        ollama: true,
    },
    ProbeTarget {
        provider_id: "local-lmstudio",
        kind: KIND_LMSTUDIO,
        root: "http://127.0.0.1:1234",
        ollama: false,
    },
    ProbeTarget {
        provider_id: "local-llamacpp",
        kind: KIND_LLAMACPP,
        root: "http://127.0.0.1:8080",
        ollama: false,
    },
    ProbeTarget {
        provider_id: "local-koboldcpp",
        kind: KIND_KOBOLDCPP,
        root: "http://127.0.0.1:5001",
        ollama: false,
    },
];

/// A detected (or previously detected) local LLM server. Crosses the command
/// boundary to the UI, so it carries only non-secret metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLocalServer {
    /// Stable provider id (`local-lmstudio`, `local-ollama`, …).
    pub provider_id: String,
    /// Server kind (`lmstudio` | `ollama` | `llamacpp` | `koboldcpp`).
    pub kind: String,
    /// The base URL chat/discovery route to. OpenAI-compatible servers get a
    /// `/v1` suffix; Ollama keeps the root (the `ollama-chat` transport adds
    /// its own paths).
    pub base_url: String,
    /// Whether the last scan reached this server.
    pub reachable: bool,
}

pub struct LocalLlmService;

impl LocalLlmService {
    /// The base URL chat routes to (`http://127.0.0.1:<port>/v1`) — every
    /// supported local server exposes an OpenAI-compatible `/v1` surface, so
    /// chat uses `OpenAiCompatibleClient` uniformly. Discovery derives its own
    /// endpoint from the probe target (Ollama uses `/api/tags` at the root).
    fn base_url_for(target: &ProbeTarget) -> String {
        format!("{}/v1", target.root)
    }

    /// Probe every known endpoint concurrently, persist the results (upserting
    /// reachable servers, marking absent ones unreachable), and return the
    /// full known set (reachable + previously-seen).
    pub fn scan() -> DbResult<Vec<DetectedLocalServer>> {
        let results: Vec<(usize, bool)> = std::thread::scope(|scope| {
            let handles: Vec<_> = PROBE_TARGETS
                .iter()
                .enumerate()
                .map(|(idx, target)| scope.spawn(move || (idx, probe(target))))
                .collect();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok())
                .collect()
        });

        let now = now_seconds();
        let conn = StorageService::connect()?;
        for (idx, reachable) in &results {
            let target = &PROBE_TARGETS[*idx];
            if *reachable {
                conn.execute(
                    "INSERT INTO native_local_servers (provider_id, kind, base_url, reachable, last_seen_at, created_at)
                     VALUES (?1, ?2, ?3, 1, ?4, ?4)
                     ON CONFLICT(provider_id) DO UPDATE SET
                         kind = excluded.kind,
                         base_url = excluded.base_url,
                         reachable = 1,
                         last_seen_at = excluded.last_seen_at",
                    params![target.provider_id, target.kind, Self::base_url_for(target), now],
                )
                .map_err(|e| format!("Failed to persist local server: {e}"))?;
            } else {
                // Only downgrade rows that already exist; never insert an
                // unreachable row (a server never seen has no provider card).
                conn.execute(
                    "UPDATE native_local_servers SET reachable = 0 WHERE provider_id = ?1",
                    params![target.provider_id],
                )
                .map_err(|e| format!("Failed to mark local server offline: {e}"))?;
            }
        }
        Self::list_servers()
    }

    /// The persisted known-server set (no I/O beyond the DB). Reachable-first,
    /// then by provider id for a stable order.
    pub fn list_servers() -> DbResult<Vec<DetectedLocalServer>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT provider_id, kind, base_url, reachable
                 FROM native_local_servers
                 ORDER BY reachable DESC, provider_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DetectedLocalServer {
                    provider_id: row.get(0)?,
                    kind: row.get(1)?,
                    base_url: row.get(2)?,
                    reachable: row.get::<_, i64>(3)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Reachable servers only — the set that gets an auto-populated keyless
    /// credential and a `configured` provider row.
    pub fn reachable_servers() -> Vec<DetectedLocalServer> {
        Self::list_servers()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.reachable)
            .collect()
    }
    /// Read the user's tool-capability override for a discovered local model.
    pub fn tool_override(provider_id: &str, model_id: &str) -> Option<bool> {
        let conn = StorageService::connect().ok()?;
        conn.query_row(
            "SELECT supports_tools FROM native_local_model_overrides WHERE provider_id = ?1 AND model_id = ?2",
            params![provider_id, model_id],
            |row| row.get::<_, i64>(0),
        )
        .ok()
        .map(|v| v != 0)
    }

    /// Set (or clear) the tool-capability override for a discovered local model.
    pub fn set_tool_override(provider_id: &str, model_id: &str, supports_tools: bool) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_local_model_overrides (provider_id, model_id, supports_tools, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(provider_id, model_id) DO UPDATE SET
                 supports_tools = excluded.supports_tools,
                 updated_at = excluded.updated_at",
            params![provider_id, model_id, supports_tools as i64, now_seconds()],
        )
        .map_err(|e| format!("Failed to save local model override: {e}"))?;
        Ok(())
    }
}

/// Whether a server kind defaults to tool-calling support. LM Studio and
/// Ollama accept OpenAI-style tool schemas on their chat endpoints; llama.cpp
/// and KoboldCpp are model/build-dependent, so default off (user-overridable).
pub fn kind_supports_tools(kind: &str) -> bool {
    matches!(kind, KIND_LMSTUDIO | KIND_OLLAMA)
}

/// Blocking HTTP probe of one endpoint. Returns true only when the endpoint
/// answers with a body that parses as its expected model-list shape.
fn probe(target: &ProbeTarget) -> bool {
    let url = if target.ollama {
        format!("{}/api/tags", target.root)
    } else {
        format!("{}/v1/models", target.root)
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let Ok(response) = client.get(&url).send() else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(payload) = response.json::<Value>() else {
        return false;
    };
    if target.ollama {
        classify_ollama(&payload)
    } else {
        classify_openai(&payload)
    }
}

/// An Ollama `/api/tags` response has a `models` array.
pub fn classify_ollama(payload: &Value) -> bool {
    payload.get("models").and_then(Value::as_array).is_some()
}

/// An OpenAI `/v1/models` response has a `data` array.
pub fn classify_openai(payload: &Value) -> bool {
    payload.get("data").and_then(Value::as_array).is_some()
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classify_ollama_accepts_models_array() {
        assert!(classify_ollama(&json!({"models": [{"name": "llama3"}]})));
        assert!(classify_ollama(&json!({"models": []})));
        assert!(!classify_ollama(&json!({"data": []})));
        assert!(!classify_ollama(&json!({"error": "nope"})));
    }

    #[test]
    fn classify_openai_accepts_data_array() {
        assert!(classify_openai(&json!({"data": [{"id": "gpt"}]})));
        assert!(classify_openai(&json!({"data": []})));
        assert!(!classify_openai(&json!({"models": []})));
        assert!(!classify_openai(&json!("plain string")));
    }

    #[test]
    fn tool_support_heuristic_matches_design() {
        assert!(kind_supports_tools(KIND_LMSTUDIO));
        assert!(kind_supports_tools(KIND_OLLAMA));
        assert!(!kind_supports_tools(KIND_LLAMACPP));
        assert!(!kind_supports_tools(KIND_KOBOLDCPP));
    }

    #[test]
    fn base_url_is_openai_v1_for_every_kind() {
        let ollama = &PROBE_TARGETS[0];
        assert_eq!(ollama.kind, KIND_OLLAMA);
        assert_eq!(
            LocalLlmService::base_url_for(ollama),
            "http://127.0.0.1:11434/v1"
        );
        let lmstudio = &PROBE_TARGETS[1];
        assert_eq!(lmstudio.kind, KIND_LMSTUDIO);
        assert_eq!(
            LocalLlmService::base_url_for(lmstudio),
            "http://127.0.0.1:1234/v1"
        );
    }
}

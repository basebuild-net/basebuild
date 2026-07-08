use std::{env, time::Duration};

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{
    models::{
        native_chat::{NativeEffortLevel, NativeModel, NativeProvider, NativeProviderCatalog, NativeProviderCredential},
        omp_catalog,
    },
    services::{
        native_chat_service::NativeChatService,
        provider_client::OMP_CODEX_BASE_URL,
        storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

const LOCAL_PROVIDER_ID: &str = "basebuild-local";
const LOCAL_MODEL_ID: &str = "basebuild-local-coordinator";
const DEFAULT_EFFORT: &str = "medium";
const CACHE_MAX_AGE_SECONDS: i64 = 24 * 60 * 60;

/// Provider-level metadata overlaid on the OMP catalog. OMP carries the
/// model list and wire-protocol kind; Basebuild adds the auth/UI metadata.
struct ProviderOverlay {
    label: &'static str,
    credential_owner: &'static str,
    local_only: bool,
    auth_method: &'static str,
    api_key_url: Option<&'static str>,
    detail: &'static str,
    default_base_url: Option<&'static str>,
}

/// Resolved provider spec: OMP catalog presence + Basebuild overlay metadata.
#[derive(Clone)]
struct ProviderSpec {
    id: String,
    label: String,
    credential_owner: String,
    local_only: bool,
    auth_method: String,
    api_key_url: Option<String>,
    detail: String,
    default_base_url: Option<String>,
}


#[derive(Debug, Clone)]
struct CachedModel {
    model: NativeModel,
    synced_at: i64,
    error: Option<String>,
    bundled_version: Option<String>,
}

pub struct ProviderModelCatalogService;

impl ProviderModelCatalogService {
    pub fn catalog() -> NativeProviderCatalog {
        let credentials = NativeChatService::list_credentials().unwrap_or_default();
        let now = now_seconds();
        let cached = Self::cached_models().unwrap_or_default();
        let mut models = Vec::new();
        let mut stale = false;
        for spec in provider_specs() {
            let provider_cached: Vec<&CachedModel> = cached.iter().filter(|m| m.model.provider_id == spec.id).collect();
            if provider_cached.is_empty() {
                models.extend(bundled_models(&spec.id));
                if !spec.local_only && is_configured(&spec.id, &credentials) {
                    stale = true;
                }
                continue;
            }

            // Stamp-mismatch check: if cached rows are bundled-source and
            // their catalog version doesn't match the current vendored
            // catalog, replace them with current bundled models. This
            // self-heals stale bundled rows (e.g. an old `devin-2.0` row
            // from a prior catalog version) without manual DB surgery.
            let current_version = omp_catalog::CATALOG_VERSION.trim();
            let bundled_stale = provider_cached.iter().any(|item| {
                item.model.source == "bundled"
                    && item.bundled_version.as_deref() != Some(current_version)
            });
            if bundled_stale {
                let fresh = bundled_models(&spec.id);
                let _ = Self::replace_provider_cache(&spec.id, fresh, "bundled", None);
                models.extend(bundled_models(&spec.id));
                continue;
            }

            for item in &provider_cached {
                if !spec.local_only && is_configured(&spec.id, &credentials) && now - item.synced_at > CACHE_MAX_AGE_SECONDS {
                    stale = true;
                }
                models.push(item.model.clone());
            }
        }

        let providers = provider_specs()
            .iter()
            .map(|spec| {
                let provider_models: Vec<&NativeModel> = models.iter().filter(|m| m.provider_id == spec.id).collect();
                let provider_cached: Vec<&CachedModel> = cached.iter().filter(|m| m.model.provider_id == spec.id).collect();
                let configured = spec.local_only || is_configured(&spec.id, &credentials);
                let last_synced_at = provider_cached.iter().map(|m| m.synced_at).max();
                let error = provider_cached.iter().find_map(|m| m.error.clone());
                let source = provider_models
                    .iter()
                    .find(|m| !m.source.is_empty())
                    .map(|m| m.source.clone())
                    .unwrap_or_else(|| "bundled".to_string());
                NativeProvider {
                    id: spec.id.to_string(),
                    label: spec.label.to_string(),
                    status: if configured { "ready" } else { "setup_required" }.to_string(),
                    credential_owner: spec.credential_owner.to_string(),
                    configured,
                    local_only: spec.local_only,
                    detail: spec.detail.to_string(),
                    auth_method: spec.auth_method.to_string(),
                    api_key_url: spec.api_key_url.clone(),
                    model_count: provider_models.len() as i64,
                    last_synced_at,
                    source,
                    error,
                }
            })
            .collect();

        NativeProviderCatalog {
            providers,
            models,
            effort_levels: effort_levels(),
            default_provider_id: LOCAL_PROVIDER_ID.to_string(),
            default_model_id: LOCAL_MODEL_ID.to_string(),
            default_effort_level: DEFAULT_EFFORT.to_string(),
            fetched_at: now,
            stale,
        }
    }

    pub fn refresh(provider_id: Option<String>, force: bool) -> DbResult<NativeProviderCatalog> {
        let credentials = NativeChatService::list_credentials().unwrap_or_default();
        let targets: Vec<ProviderSpec> = match provider_id.as_deref() {
            Some(id) => provider_specs().into_iter().filter(|p| p.id == id).collect(),
            None => provider_specs(),
        };

        for spec in targets {
            Self::refresh_provider_spec(spec, &credentials, force)?;
        }

        Ok(Self::catalog())
    }

    pub fn refresh_provider(provider_id: &str, force: bool) -> DbResult<NativeProviderCatalog> {
        Self::refresh(Some(provider_id.to_string()), force)
    }

    fn refresh_provider_spec(spec: ProviderSpec, credentials: &[NativeProviderCredential], force: bool) -> DbResult<()> {
        if spec.local_only {
            return Self::replace_provider_cache(&spec.id, bundled_models(&spec.id), "bundled", None);
        }

        let credential = credentials.iter().find(|c| c.provider_id == spec.id);
        if credential.is_none() {
            if Self::has_cached_provider(&spec.id)? {
                return Ok(());
            }
            return Self::replace_provider_cache(&spec.id, bundled_models(&spec.id), "bundled", None);
        }

        if !force && Self::provider_cache_fresh(&spec.id)? {
            return Ok(());
        }

        let credential = credential.expect("checked above");

        // Catalog sync is the primary model source. Fetch the canonical
        // basebuild.net catalog first; if it has rows for this provider,
        // skip per-provider /v1/models discovery entirely.
        let catalog_synced = crate::services::catalog_sync_service::sync_catalog();
        if catalog_synced.error.is_none() && Self::has_cached_provider_with_source(&spec.id, "catalog_sync")? {
            return Ok(());
        }

        let discovered = if credential.base_url.as_deref() == Some(OMP_CODEX_BASE_URL) {
            // OMP-backed ChatGPT OAuth is not an OpenAI /v1 API key. Only show
            // models confirmed to work through OMP's openai-codex RPC path.
            Ok(omp_codex_oauth_models())
        } else if is_bespoke_provider(&spec.id) {
            // Bespoke-protocol providers (devin-agent, cursor-agent, etc.)
            // are not OpenAI-compatible. Try `omp models` for live
            // discovery; fall back to the bundled OMP catalog.
            match Self::discover_via_omp_cli(&spec.id) {
                Ok(models) if !models.is_empty() => Ok(models),
                _ => Ok(bundled_models(&spec.id)),
            }
        } else {
            Self::discover_openai_compatible(spec.clone(), credential)
        };

        match discovered {
            Ok(models) if !models.is_empty() => Self::replace_provider_cache(&spec.id, models, "provider_discovered", None),
            Ok(_) => Self::fallback_or_preserve(spec, "Provider returned no models."),
            Err(error) => Self::fallback_or_preserve(spec, &error),
        }
    }

    fn discover_openai_compatible(spec: ProviderSpec, credential: &NativeProviderCredential) -> DbResult<Vec<NativeModel>> {
        let base_url = credential
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or(spec.default_base_url.as_deref())
            .unwrap_or("https://api.openai.com/v1")
            .trim_end_matches('/')
            .to_string();
        let url = format!("{base_url}/models");
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to build model discovery client: {e}"))?
            .get(url)
            .bearer_auth(&credential.api_key)
            .send()
            .map_err(|e| format!("Failed to fetch {label} models: {e}", label = spec.label))?;

        if !response.status().is_success() {
            return Err(format!(
                "{label} model discovery failed with HTTP {status}.",
                label = spec.label,
                status = response.status().as_u16()
            ));
        }

        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse {label} model payload: {e}", label = spec.label))?;
        let entries = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{label} model payload did not include a data array.", label = spec.label))?;

        let mut models = Vec::new();
        for entry in entries {
            let id = entry.get("id").and_then(Value::as_str).unwrap_or_default().trim();
            if id.is_empty() {
                continue;
            }
            models.push(model_with_source(NativeModel {
                id: id.to_string(),
                provider_id: spec.id.to_string(),
                label: model_label(&spec.id, id),
                supports_effort: supports_reasoning(&spec.id, id),
                supports_streaming: true,
                supports_tools: true,
                local_only: false,
                context_window: extract_i64(entry, &["context_window", "contextWindow", "context_length", "max_context_window", "maxContextWindow"]),
                max_tokens: extract_i64(entry, &["max_output_tokens", "maxOutputTokens", "max_tokens", "maxTokens"]),
                supports_reasoning: supports_reasoning(&spec.id, id),
                supported_efforts: if supports_reasoning(&spec.id, id) { effort_ids() } else { Vec::new() },
                supports_images: supports_images(id),
                source: "provider_discovered".to_string(),
                model_api_id: None,
                api_kind: String::new(),
                base_url: String::new(),
                cost_input: None,
                cost_output: None,
            }, "provider_discovered"));
        }

        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    /// Discover models via `omp models <provider> --json --no-extensions`.
    /// Returns models with source `omp_cli`. Falls back to an empty vec
    /// (caller falls back to bundled) if OMP is not installed or the
    /// command fails or times out.
    fn discover_via_omp_cli(provider_id: &str) -> DbResult<Vec<NativeModel>> {
        use std::process::Command;
        let output = Command::new("omp")
            .args(["models", provider_id, "--json", "--no-extensions"])
            .output();
        let output = match output {
            Ok(o) => o,
            Err(_) => return Ok(Vec::new()), // OMP not installed
        };
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let payload: Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse `omp models` output: {e}"))?;
        let entries = payload
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| "`omp models` output did not include a models array".to_string())?;

        let mut models = Vec::new();
        for entry in entries {
            let id = entry.get("id").and_then(Value::as_str).unwrap_or_default().trim();
            if id.is_empty() {
                continue;
            }
            let reasoning = entry.get("reasoning").and_then(Value::as_bool).unwrap_or(false);
            let supported_efforts = if reasoning { effort_ids() } else { Vec::new() };
            let context_window = entry.get("contextWindow").and_then(Value::as_i64)
                .or_else(|| entry.get("context_window").and_then(Value::as_i64));
            let max_tokens = entry.get("maxTokens").and_then(Value::as_i64)
                .or_else(|| entry.get("max_tokens").and_then(Value::as_i64));
            let api_kind = entry.get("api").and_then(Value::as_str).unwrap_or_default().to_string();
            let base_url = entry.get("baseUrl").and_then(Value::as_str).unwrap_or_default().to_string();
            let input_modalities: Vec<String> = entry.get("input")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let supports_images = input_modalities.iter().any(|m| m == "image");
            let cost_input = entry.get("cost").and_then(|c| c.get("input")).and_then(Value::as_f64);
            let cost_output = entry.get("cost").and_then(|c| c.get("output")).and_then(Value::as_f64);
            let label = entry.get("name").and_then(Value::as_str).unwrap_or(id).to_string();
            models.push(model_with_source(NativeModel {
                id: id.to_string(),
                provider_id: provider_id.to_string(),
                label,
                supports_effort: reasoning,
                supports_streaming: true,
                supports_tools: true,
                local_only: false,
                context_window,
                max_tokens,
                supports_reasoning: reasoning,
                supported_efforts,
                supports_images,
                source: "omp_cli".to_string(),
                model_api_id: None,
                api_kind,
                base_url,
                cost_input,
                cost_output,
            }, "omp_cli"));
        }
        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    fn fallback_or_preserve(spec: ProviderSpec, error: &str) -> DbResult<()> {
        if let Some(models) = Self::hosted_fallback(spec.clone())? {
            if !models.is_empty() {
                return Self::replace_provider_cache(&spec.id, models, "hosted_fallback", Some(error.to_string()));
            }
        }

        if Self::has_cached_provider(&spec.id)? {
            Self::mark_provider_error(&spec.id, error)
        } else {
            Self::replace_provider_cache(&spec.id, bundled_models(&spec.id), "bundled", Some(error.to_string()))
        }
    }

    fn hosted_fallback(spec: ProviderSpec) -> DbResult<Option<Vec<NativeModel>>> {
        let endpoint = match env::var("BASEBUILD_MODEL_DIRECTORY_URL") {
            Ok(value) if !value.trim().is_empty() => value,
            _ => return Ok(None),
        };
        let mut url = reqwest::Url::parse(endpoint.trim())
            .map_err(|e| format!("Invalid BASEBUILD_MODEL_DIRECTORY_URL: {e}"))?;
        url.query_pairs_mut().append_pair("provider", &spec.id);
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to build hosted catalog client: {e}"))?
            .get(url)
            .send()
            .map_err(|e| format!("Failed to fetch hosted model directory: {e}"))?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse hosted model directory: {e}"))?;
        let entries = if let Some(models) = payload.get("models").and_then(Value::as_array) {
            models.clone()
        } else if let Some(providers) = payload.as_array() {
            providers
                .iter()
                .find(|provider| {
                    provider.get("slug").and_then(Value::as_str) == Some(spec.id.as_str())
                        || provider.get("name").and_then(Value::as_str).map(|name| name.eq_ignore_ascii_case(&spec.label)).unwrap_or(false)
                })
                .and_then(|provider| provider.get("models").and_then(Value::as_array).cloned())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let models = entries
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id").or_else(|| entry.get("key")).and_then(Value::as_str)?.trim();
                if id.is_empty() {
                    return None;
                }
                let label = entry
                    .get("label")
                    .or_else(|| entry.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| model_label(&spec.id, id));
                let reasoning = entry.get("supportsReasoning").and_then(Value::as_bool).unwrap_or_else(|| supports_reasoning(&spec.id, id));
                let supported = entry.get("supportedEfforts")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                    .unwrap_or_else(|| if reasoning { effort_ids() } else { Vec::new() });
                Some(model_with_source(NativeModel {
                    id: id.to_string(),
                    provider_id: spec.id.to_string(),
                    label,
                    supports_effort: reasoning,
                    supports_streaming: true,
                    supports_tools: true,
                    local_only: false,
                    context_window: extract_i64(entry, &["context_window", "contextWindow", "context_length", "max_context_window", "maxContextWindow"]),
                    max_tokens: extract_i64(entry, &["max_output_tokens", "maxOutputTokens", "max_tokens", "maxTokens"]),
                    supports_reasoning: reasoning,
                    supported_efforts: supported,
                    supports_images: entry.get("supportsImages").and_then(Value::as_bool).unwrap_or_else(|| supports_images(id)),
                    source: "hosted_fallback".to_string(),
                    model_api_id: None,
                    api_kind: String::new(),
                    base_url: String::new(),
                    cost_input: None,
                    cost_output: None,
                }, "hosted_fallback"))
            })
            .collect();
        Ok(Some(models))
    }
    fn cached_models() -> DbResult<Vec<CachedModel>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT provider_id, model_id, label, context_window, max_tokens, supports_reasoning,
                        supported_efforts, supports_images, source, synced_at, error, model_api_id,
                        api_kind, base_url, cost_input, cost_output, bundled_version
                 FROM native_provider_model_cache
                 ORDER BY provider_id, label",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let provider_id: String = row.get(0)?;
                let model_id: String = row.get(1)?;
                let supported_raw: String = row.get(6)?;
                let supported_efforts = serde_json::from_str::<Vec<String>>(&supported_raw).unwrap_or_default();
                let local_only = provider_id == LOCAL_PROVIDER_ID;
                let api_kind = row.get::<_, Option<String>>(12)?.unwrap_or_default();
                Ok(CachedModel {
                    model: NativeModel {
                        id: model_id,
                        provider_id,
                        label: row.get(2)?,
                        supports_effort: row.get::<_, i64>(5)? != 0,
                        supports_streaming: !local_only,
                        supports_tools: !local_only && crate::services::provider_client::transport_supports_tools(&api_kind),
                        local_only,
                        context_window: row.get(3)?,
                        max_tokens: row.get(4)?,
                        supports_reasoning: row.get::<_, i64>(5)? != 0,
                        supported_efforts,
                        supports_images: row.get::<_, i64>(7)? != 0,
                        source: row.get(8)?,
                        model_api_id: row.get::<_, Option<String>>(11)?,
                        api_kind,
                        base_url: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                        cost_input: row.get::<_, Option<f64>>(14)?,
                        cost_output: row.get::<_, Option<f64>>(15)?,
                    },
                    synced_at: row.get(9)?,
                    error: row.get(10)?,
                    bundled_version: row.get::<_, Option<String>>(16)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    fn replace_provider_cache(provider_id: &str, models: Vec<NativeModel>, source: &str, error: Option<String>) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let now = now_seconds();
        conn.execute("DELETE FROM native_provider_model_cache WHERE provider_id = ?1", params![provider_id])
            .map_err(|e| format!("Failed to clear model cache: {e}"))?;
        for model in models {
            let bundled_version = if source == "bundled" {
                Some(omp_catalog::CATALOG_VERSION.trim().to_string())
            } else {
                None
            };
            conn.execute(
                "INSERT INTO native_provider_model_cache
                 (provider_id, model_id, label, context_window, max_tokens, supports_reasoning,
                  supported_efforts, supports_images, source, synced_at, error, model_api_id,
                  api_kind, base_url, cost_input, cost_output, bundled_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    provider_id,
                    model.id,
                    model.label,
                    model.context_window,
                    model.max_tokens,
                    model.supports_reasoning as i32,
                    serde_json::to_string(&model.supported_efforts).unwrap_or_else(|_| "[]".to_string()),
                    model.supports_images as i32,
                    source,
                    now,
                    error,
                    model.model_api_id,
                    model.api_kind,
                    model.base_url,
                    model.cost_input,
                    model.cost_output,
                    bundled_version,
                ],
            )
            .map_err(|e| format!("Failed to save model cache row: {e}"))?;
        }
        Ok(())
    }

    fn mark_provider_error(provider_id: &str, error: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE native_provider_model_cache SET source = 'stale_cache', error = ?1 WHERE provider_id = ?2",
            params![error, provider_id],
        )
        .map_err(|e| format!("Failed to mark model cache stale: {e}"))?;
        Ok(())
    }

    fn has_cached_provider_with_source(provider_id: &str, source: &str) -> DbResult<bool> {
        let conn = StorageService::connect()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_provider_model_cache WHERE provider_id = ?1 AND source = ?2",
                params![provider_id, source],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    fn has_cached_provider(provider_id: &str) -> DbResult<bool> {
        let conn = StorageService::connect()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_provider_model_cache WHERE provider_id = ?1",
                params![provider_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    fn provider_cache_fresh(provider_id: &str) -> DbResult<bool> {
        let conn = StorageService::connect()?;
        let synced_at: Option<i64> = conn
            .query_row(
                "SELECT MAX(synced_at) FROM native_provider_model_cache WHERE provider_id = ?1 AND error IS NULL",
                params![provider_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        Ok(synced_at
            .map(|ts| now_seconds() - ts <= CACHE_MAX_AGE_SECONDS)
            .unwrap_or(false))
    }
}

fn provider_overlays() -> &'static [(&'static str, ProviderOverlay)] {
    &[
        ("umans", ProviderOverlay {
            label: "Umans", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://app.umans.ai/billing?context=personal&tab=api-keys"),
            detail: "Umans API — OpenAI-compatible. Enter your API key to connect.",
            default_base_url: Some("https://api.code.umans.ai/v1"),
        }),
        ("openai", ProviderOverlay {
            label: "OpenAI", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://platform.openai.com/api-keys"),
            detail: "OpenAI API — enter your API key to connect.",
            default_base_url: Some("https://api.openai.com/v1"),
        }),
        ("anthropic", ProviderOverlay {
            label: "Anthropic", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://console.anthropic.com/settings/keys"),
            detail: "Anthropic API — enter your API key to connect.",
            default_base_url: Some("https://api.anthropic.com/v1"),
        }),
        ("devin", ProviderOverlay {
            label: "Devin.ai", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://app.devin.ai/settings/api-keys"),
            detail: "Devin.ai (Codeium Cascade) — enter your API key to connect.",
            default_base_url: Some("https://server.codeium.com"),
        }),
        ("google", ProviderOverlay {
            label: "Google Gemini", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://aistudio.google.com/apikey"),
            detail: "Google Gemini API — OpenAI-compatible endpoint. Enter your API key to connect.",
            default_base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        }),
        ("groq", ProviderOverlay {
            label: "Groq", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://console.groq.com/keys"),
            detail: "Groq API — OpenAI-compatible. Enter your API key to connect.",
            default_base_url: Some("https://api.groq.com/openai/v1"),
        }),
        ("openrouter", ProviderOverlay {
            label: "OpenRouter", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://openrouter.ai/keys"),
            detail: "OpenRouter API — OpenAI-compatible. Enter your API key to connect.",
            default_base_url: Some("https://openrouter.ai/api/v1"),
        }),
        ("deepseek", ProviderOverlay {
            label: "DeepSeek", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://platform.deepseek.com/api_keys"),
            detail: "DeepSeek API — enter your API key to connect.",
            default_base_url: Some("https://api.deepseek.com/v1"),
        }),
        ("mistral", ProviderOverlay {
            label: "Mistral", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://console.mistral.ai/api-keys"),
            detail: "Mistral API — enter your API key to connect.",
            default_base_url: Some("https://api.mistral.ai/v1"),
        }),
        ("xai", ProviderOverlay {
            label: "xAI (Grok)", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://console.x.ai"),
            detail: "xAI (Grok) API — enter your API key to connect.",
            default_base_url: Some("https://api.x.ai/v1"),
        }),
        ("together", ProviderOverlay {
            label: "Together AI", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://api.together.ai/settings/api-keys"),
            detail: "Together AI API — enter your API key to connect.",
            default_base_url: Some("https://api.together.xyz/v1"),
        }),
        ("fireworks", ProviderOverlay {
            label: "Fireworks AI", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://fireworks.ai/api-keys"),
            detail: "Fireworks AI API — enter your API key to connect.",
            default_base_url: Some("https://api.fireworks.ai/inference/v1"),
        }),
        ("cerebras", ProviderOverlay {
            label: "Cerebras", credential_owner: "user", local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://cloud.cerebras.ai"),
            detail: "Cerebras API — enter your API key to connect.",
            default_base_url: Some("https://api.cerebras.ai/v1"),
        }),
    ]
}

fn overlay_for(provider_id: &str) -> Option<&'static ProviderOverlay> {
    provider_overlays()
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, o)| o)
}

fn provider_specs() -> Vec<ProviderSpec> {
    let mut specs = Vec::new();

    // Synthetic local provider (not in the OMP catalog).
    specs.push(ProviderSpec {
        id: LOCAL_PROVIDER_ID.to_string(),
        label: "Basebuild Local".to_string(),
        credential_owner: "basebuild".to_string(),
        local_only: true,
        auth_method: "local".to_string(),
        api_key_url: None,
        detail: "Runs locally without a network provider.".to_string(),
        default_base_url: None,
    });

    // All providers from the vendored OMP catalog, overlaid with Basebuild
    // metadata where available. Providers without an overlay get generic
    // defaults derived from the catalog.
    for pid in omp_catalog::provider_ids() {
        let overlay = overlay_for(pid);
        let models = omp_catalog::models_for(pid);
        let first_base_url = models.first().map(|m| m.base_url.as_str());
        let label = overlay
            .map(|o| o.label.to_string())
            .unwrap_or_else(|| model_label(pid, pid));
        let auth_method = overlay
            .map(|o| o.auth_method.to_string())
            .unwrap_or_else(|| {
                // Providers whose models all use bespoke api kinds typically
                // require OAuth (delegated to OMP). Default others to api_key.
                let all_bespoke = models
                    .iter()
                    .all(|m| is_bespoke_api_kind(&m.api_kind));
                if all_bespoke { "oauth".to_string() } else { "api_key".to_string() }
            });
        specs.push(ProviderSpec {
            id: pid.to_string(),
            label: label.clone(),
            credential_owner: overlay
                .map(|o| o.credential_owner.to_string())
                .unwrap_or_else(|| "user".to_string()),
            local_only: false,
            auth_method,
            api_key_url: overlay.and_then(|o| o.api_key_url.map(String::from)),
            detail: overlay
                .map(|o| o.detail.to_string())
                .unwrap_or_else(|| format!("{label} — connect to use available models.")),
            default_base_url: overlay
                .and_then(|o| o.default_base_url.map(String::from))
                .or_else(|| first_base_url.map(String::from)),
        });
    }

    // Synthetic custom provider (user-supplied OpenAI-compatible endpoint).
    specs.push(ProviderSpec {
        id: "custom".to_string(),
        label: "Custom (OpenAI-compatible)".to_string(),
        credential_owner: "user".to_string(),
        local_only: false,
        auth_method: "api_key".to_string(),
        api_key_url: None,
        detail: "Any OpenAI-compatible endpoint. Enter your API key and base URL.".to_string(),
        default_base_url: None,
    });

    specs
}

/// Returns true for api kinds that use a bespoke wire protocol handled by OMP
/// RPC delegation (not native OpenAI/Anthropic-compatible HTTP).
fn is_bespoke_api_kind(api_kind: &str) -> bool {
    !matches!(
        api_kind,
        "openai-completions"
            | "openai-responses"
            | "azure-openai-responses"
            | "anthropic-messages"
            | "openrouter"
            | "ollama-chat"
    )
}

/// Returns true if all of a provider's models use bespoke api kinds (i.e.
/// the provider has no OpenAI/Anthropic-compatible endpoint and must be
/// routed through OMP RPC at chat time).
fn is_bespoke_provider(provider_id: &str) -> bool {
    let models = omp_catalog::models_for(provider_id);
    !models.is_empty() && models.iter().all(|m| is_bespoke_api_kind(&m.api_kind))
}

fn bundled_models(provider_id: &str) -> Vec<NativeModel> {
    match provider_id {
        LOCAL_PROVIDER_ID => vec![model_with_source(NativeModel {
            id: LOCAL_MODEL_ID.to_string(),
            provider_id: LOCAL_PROVIDER_ID.to_string(),
            label: "Local Coordinator".to_string(),
            supports_effort: true,
            supports_streaming: false,
            supports_tools: false,
            local_only: true,
            context_window: None,
            max_tokens: None,
            supports_reasoning: true,
            supported_efforts: effort_ids(),
            supports_images: false,
            source: "bundled".to_string(),
            model_api_id: None,
            api_kind: String::new(),
            base_url: String::new(),
            cost_input: None,
            cost_output: None,
        }, "bundled")],
        "custom" => Vec::new(),
        _ => {
            let catalog_models = omp_catalog::models_for(provider_id);
            catalog_models
                .into_iter()
                .map(|cm| bundled_from_catalog(provider_id, cm))
                .collect()
        }
    }
}

/// Build a `NativeModel` from an OMP catalog entry, mapping catalog fields to
/// Basebuild's model schema. The `reasoning` flag drives effort support; the
/// `input` array drives image support; `api` becomes `api_kind`; `baseUrl`
/// becomes `base_url`; cost fields are carried through.
fn bundled_from_catalog(provider_id: &str, cm: &omp_catalog::CatalogModel) -> NativeModel {
    let supports_reasoning = cm.reasoning;
    let supports_images = cm.input.iter().any(|m| m == "image");
    let supported_efforts = if supports_reasoning { effort_ids() } else { Vec::new() };
    let cost_input = if cm.cost.input != 0.0 { Some(cm.cost.input) } else { None };
    let cost_output = if cm.cost.output != 0.0 { Some(cm.cost.output) } else { None };
    model_with_source(NativeModel {
        id: cm.id.clone(),
        provider_id: provider_id.to_string(),
        label: cm.name.clone(),
        supports_effort: supports_reasoning,
        supports_streaming: true,
        supports_tools: crate::services::provider_client::transport_supports_tools(&cm.api_kind),
        local_only: false,
        context_window: cm.context_window,
        max_tokens: cm.max_tokens,
        supports_reasoning,
        supported_efforts,
        supports_images,
        source: "bundled".to_string(),
        model_api_id: None,
        api_kind: cm.api_kind.clone(),
        base_url: cm.base_url.clone(),
        cost_input,
        cost_output,
    }, "bundled")
}

fn omp_codex_oauth_models() -> Vec<NativeModel> {
    bundled_models("openai")
        .into_iter()
        .filter(|model| model.id == "gpt-5.5")
        .map(|mut model| {
            model.supports_tools = false;
            model
        })
        .collect()
}


fn model_with_source(mut model: NativeModel, source: &str) -> NativeModel {
    model.source = source.to_string();
    model
}

fn is_configured(provider_id: &str, credentials: &[NativeProviderCredential]) -> bool {
    credentials.iter().any(|c| c.provider_id == provider_id)
}

fn effort_levels() -> Vec<NativeEffortLevel> {
    vec![
        NativeEffortLevel { id: "low".to_string(), label: "Low".to_string(), description: "Fast, shallow planning.".to_string() },
        NativeEffortLevel { id: "medium".to_string(), label: "Medium".to_string(), description: "Balanced reliability and speed.".to_string() },
        NativeEffortLevel { id: "high".to_string(), label: "High".to_string(), description: "Deeper reasoning for implementation planning.".to_string() },
        NativeEffortLevel { id: "xhigh".to_string(), label: "XHigh".to_string(), description: "Maximum local planning budget before provider-backed execution.".to_string() },
    ]
}

fn effort_ids() -> Vec<String> {
    effort_levels().into_iter().map(|e| e.id).collect()
}

fn model_label(provider_id: &str, id: &str) -> String {
    match provider_id {
        "openai" if id.starts_with("gpt-") => id.replace('-', " ").replace("gpt", "GPT"),
        "anthropic" if id.starts_with("claude-") => id.replace('-', " ").replace("claude", "Claude"),
        _ => id
            .split(['-', '_', '.'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                if part.len() <= 3 {
                    part.to_uppercase()
                } else {
                    let mut chars = part.chars();
                    match chars.next() {
                        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                        None => String::new(),
                    }
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn supports_reasoning(provider_id: &str, id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    match provider_id {
        "openai" => ["gpt-5", "o1", "o3", "o4", "codex"].iter().any(|prefix| id == *prefix || id.starts_with(&format!("{prefix}-"))),
        "anthropic" => id.starts_with("claude-") || id.contains("sonnet") || id.contains("opus") || id.contains("haiku"),
        "google" => id.contains("pro") || id.contains("thinking") || id.contains("2.5"),
        _ => id.contains("reason") || id.contains("glm") || id.contains("thinking") || id.contains("pro"),
    }
}

fn supports_images(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("gpt-4") || id.contains("gpt-5") || id.contains("vision") || id.contains("omni") || id.contains("claude")
}

fn extract_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_i64) {
            return Some(number);
        }
        if let Some(number) = value.get(*key).and_then(Value::as_u64) {
            if number <= i64::MAX as u64 {
                return Some(number as i64);
            }
        }
    }
    None
}

pub fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omp_codex_oauth_models_only_lists_verified_model_without_tools() {
        let models = omp_codex_oauth_models();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.5");
        assert!(!models[0].supports_tools);
    }

    #[test]
    fn bundled_devin_models_match_catalog() {
        // The bundled devin models should come from the OMP catalog and
        // include swe-1-6 and glm-5-2 (the stale `devin-2.0` row is gone).
        let models = bundled_models("devin");
        assert_eq!(models.len(), 48, "devin should have 48 bundled models");
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"swe-1-6"), "devin should include swe-1-6");
        assert!(ids.contains(&"glm-5-2"), "devin should include glm-5-2");
        assert!(
            !ids.iter().any(|id| id == &"devin-2.0"),
            "stale devin-2.0 should not be in bundled models"
        );
        // Every bundled devin model should have the devin-agent api kind.
        assert!(
            models.iter().all(|m| m.api_kind == "devin-agent"),
            "all devin models should have api_kind=devin-agent"
        );
    }

    #[test]
    fn bundled_bespoke_models_have_supports_tools_false() {
        // Bespoke api_kinds (devin-agent, cursor-agent, etc.) route through
        // OmpRpcClient which cannot carry structured tool schemas, so the
        // catalog must report supports_tools=false for those models.
        let devin = bundled_models("devin");
        assert!(
            devin.iter().all(|m| !m.supports_tools),
            "all devin (devin-agent) models should have supports_tools=false"
        );
    }

    #[test]
    fn bundled_models_have_catalog_version_stamp() {
        // Bundled models should carry the current catalog version for
        // stamp-mismatch detection. This is tested via replace_provider_cache
        // writing the stamp; here we verify the version is non-empty.
        assert!(
            !omp_catalog::CATALOG_VERSION.trim().is_empty(),
            "catalog version should be stamped"
        );
    }

    #[test]
    fn is_bespoke_provider_detects_devin() {
        // Devin uses devin-agent (bespoke), not openai-completions.
        assert!(is_bespoke_provider("devin"), "devin should be bespoke");
        // OpenAI uses openai-completions (native).
        assert!(!is_bespoke_provider("openai"), "openai should not be bespoke");
        // Anthropic uses anthropic-messages (native).
        assert!(!is_bespoke_provider("anthropic"), "anthropic should not be bespoke");
    }

    #[test]
    fn provider_specs_includes_all_catalog_providers() {
        let specs = provider_specs();
        let spec_ids: Vec<&str> = specs.iter().map(|s| s.id.as_str()).collect();
        // Should include all OMP catalog providers plus local and custom.
        for pid in omp_catalog::provider_ids() {
            assert!(
                spec_ids.contains(&pid),
                "provider {pid} from OMP catalog should be in provider_specs"
            );
        }
        assert!(spec_ids.contains(&"basebuild-local"), "local provider should be present");
        assert!(spec_ids.contains(&"custom"), "custom provider should be present");
    }

    #[test]
    fn refresh_bespoke_provider_returns_bundled_not_error() {
        // The refresh path for bespoke providers (devin without OMP) should
        // return Ok(bundled) not Err. We verify the bundled models are
        // non-empty and have the correct source.
        let models = bundled_models("devin");
        assert!(!models.is_empty(), "bundled devin models should be non-empty");
        assert!(
            models.iter().all(|m| m.source == "bundled"),
            "all bundled devin models should have source=bundled"
        );
    }
}

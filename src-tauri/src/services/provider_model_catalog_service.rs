use std::{env, time::Duration};

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{
    models::native_chat::{NativeEffortLevel, NativeModel, NativeProvider, NativeProviderCatalog, NativeProviderCredential},
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

#[derive(Clone, Copy)]
struct ProviderSpec {
    id: &'static str,
    label: &'static str,
    credential_owner: &'static str,
    local_only: bool,
    auth_method: &'static str,
    api_key_url: Option<&'static str>,
    detail: &'static str,
    default_base_url: Option<&'static str>,
}

#[derive(Debug, Clone)]
struct CachedModel {
    model: NativeModel,
    synced_at: i64,
    error: Option<String>,
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
                models.extend(bundled_models(spec.id));
                if !spec.local_only && is_configured(spec.id, &credentials) {
                    stale = true;
                }
                continue;
            }

            for item in &provider_cached {
                if !spec.local_only && is_configured(spec.id, &credentials) && now - item.synced_at > CACHE_MAX_AGE_SECONDS {
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
                let configured = spec.local_only || is_configured(spec.id, &credentials);
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
                    api_key_url: spec.api_key_url.map(|s| s.to_string()),
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
            return Self::replace_provider_cache(spec.id, bundled_models(spec.id), "bundled", None);
        }

        let credential = credentials.iter().find(|c| c.provider_id == spec.id);
        if credential.is_none() {
            if Self::has_cached_provider(spec.id)? {
                return Ok(());
            }
            return Self::replace_provider_cache(spec.id, bundled_models(spec.id), "bundled", None);
        }

        if !force && Self::provider_cache_fresh(spec.id)? {
            return Ok(());
        }

        let credential = credential.expect("checked above");

        // Catalog sync is the primary model source. Fetch the canonical
        // basebuild.net catalog first; if it has rows for this provider,
        // skip per-provider /v1/models discovery entirely.
        let catalog_synced = crate::services::catalog_sync_service::sync_catalog();
        if catalog_synced.error.is_none() && Self::has_cached_provider_with_source(spec.id, "catalog_sync")? {
            return Ok(());
        }

        let discovered = if credential.base_url.as_deref() == Some(OMP_CODEX_BASE_URL) {
            // OMP-backed ChatGPT OAuth is not an OpenAI /v1 API key. Only show
            // models confirmed to work through OMP's openai-codex RPC path.
            Ok(omp_codex_oauth_models())
        } else if spec.id == "anthropic" {
            Err("Anthropic does not expose a stable public model-list endpoint for this flow.".to_string())
        } else {
            Self::discover_openai_compatible(spec, credential)
        };

        match discovered {
            Ok(models) if !models.is_empty() => Self::replace_provider_cache(spec.id, models, "provider_discovered", None),
            Ok(_) => Self::fallback_or_preserve(spec, "Provider returned no models."),
            Err(error) => Self::fallback_or_preserve(spec, &error),
        }
    }

    fn discover_openai_compatible(spec: ProviderSpec, credential: &NativeProviderCredential) -> DbResult<Vec<NativeModel>> {
        let base_url = credential
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or(spec.default_base_url)
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
                label: model_label(spec.id, id),
                supports_effort: supports_reasoning(spec.id, id),
                supports_streaming: true,
                supports_tools: true,
                local_only: false,
                context_window: extract_i64(entry, &["context_window", "contextWindow", "context_length", "max_context_window", "maxContextWindow"]),
                max_tokens: extract_i64(entry, &["max_output_tokens", "maxOutputTokens", "max_tokens", "maxTokens"]),
                supports_reasoning: supports_reasoning(spec.id, id),
                supported_efforts: if supports_reasoning(spec.id, id) { effort_ids() } else { Vec::new() },
                supports_images: supports_images(id),
                source: "provider_discovered".to_string(),
                model_api_id: None,
            }, "provider_discovered"));
        }

        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    fn fallback_or_preserve(spec: ProviderSpec, error: &str) -> DbResult<()> {
        if let Some(models) = Self::hosted_fallback(spec)? {
            if !models.is_empty() {
                return Self::replace_provider_cache(spec.id, models, "hosted_fallback", Some(error.to_string()));
            }
        }

        if Self::has_cached_provider(spec.id)? {
            Self::mark_provider_error(spec.id, error)
        } else {
            Self::replace_provider_cache(spec.id, bundled_models(spec.id), "bundled", Some(error.to_string()))
        }
    }

    fn hosted_fallback(spec: ProviderSpec) -> DbResult<Option<Vec<NativeModel>>> {
        let endpoint = match env::var("BASEBUILD_MODEL_DIRECTORY_URL") {
            Ok(value) if !value.trim().is_empty() => value,
            _ => return Ok(None),
        };
        let mut url = reqwest::Url::parse(endpoint.trim())
            .map_err(|e| format!("Invalid BASEBUILD_MODEL_DIRECTORY_URL: {e}"))?;
        url.query_pairs_mut().append_pair("provider", spec.id);
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
                    provider.get("slug").and_then(Value::as_str) == Some(spec.id)
                        || provider.get("name").and_then(Value::as_str).map(|name| name.eq_ignore_ascii_case(spec.label)).unwrap_or(false)
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
                    .unwrap_or_else(|| model_label(spec.id, id));
                let reasoning = entry.get("supportsReasoning").and_then(Value::as_bool).unwrap_or_else(|| supports_reasoning(spec.id, id));
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
                        supported_efforts, supports_images, source, synced_at, error, model_api_id
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
                Ok(CachedModel {
                    model: NativeModel {
                        id: model_id,
                        provider_id,
                        label: row.get(2)?,
                        supports_effort: row.get::<_, i64>(5)? != 0,
                        supports_streaming: !local_only,
                        supports_tools: !local_only,
                        local_only,
                        context_window: row.get(3)?,
                        max_tokens: row.get(4)?,
                        supports_reasoning: row.get::<_, i64>(5)? != 0,
                        supported_efforts,
                        supports_images: row.get::<_, i64>(7)? != 0,
                        source: row.get(8)?,
                        model_api_id: row.get::<_, Option<String>>(11)?,
                    },
                    synced_at: row.get(9)?,
                    error: row.get(10)?,
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
            conn.execute(
                "INSERT INTO native_provider_model_cache
                 (provider_id, model_id, label, context_window, max_tokens, supports_reasoning, supported_efforts, supports_images, source, synced_at, error, model_api_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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

fn provider_specs() -> Vec<ProviderSpec> {
    vec![
        ProviderSpec {
            id: LOCAL_PROVIDER_ID,
            label: "Basebuild Local",
            credential_owner: "basebuild",
            local_only: true,
            auth_method: "local",
            api_key_url: None,
            detail: "Runs locally without a network provider.",
            default_base_url: None,
        },
        ProviderSpec {
            id: "umans",
            label: "Umans",
            credential_owner: "user",
            local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://app.umans.ai/billing?context=personal&tab=api-keys"),
            detail: "Umans API — OpenAI-compatible. Enter your API key to connect.",
            default_base_url: Some("https://api.code.umans.ai/v1"),
        },
        ProviderSpec {
            id: "openai",
            label: "OpenAI",
            credential_owner: "user",
            local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://platform.openai.com/api-keys"),
            detail: "OpenAI API — enter your API key to connect.",
            default_base_url: Some("https://api.openai.com/v1"),
        },
        ProviderSpec {
            id: "anthropic",
            label: "Anthropic",
            credential_owner: "user",
            local_only: false,
            auth_method: "api_key",
            api_key_url: Some("https://console.anthropic.com/settings/keys"),
            detail: "Anthropic API — enter your API key to connect.",
            default_base_url: Some("https://api.anthropic.com/v1"),
        },
    ]
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
        }, "bundled")],
        "umans" => vec![
            bundled("umans", "umans-coder", "Umans Coder", 262144, 32768, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("umans", "umans-flash", "Umans Flash", 262144, 32768, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("umans", "umans-glm-5.2", "Umans GLM 5.2", 405504, 131071, true, vec!["high", "xhigh"], false),
            bundled("umans", "umans-glm-5.2-nvfp4", "Umans GLM 5.2 NVFP4 (experimental, short test from Jun 29)", 405504, 131071, true, vec!["high", "xhigh"], false),
            bundled("umans", "umans-kimi-k2.7", "Umans Kimi K2.7 Code", 262144, 32768, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("umans", "umans-qwen3.6-35b-a3b", "Umans Qwen3.6 35B A3B", 262144, 32768, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
        ],
        "openai" => vec![
            bundled("openai", "codex-mini-latest", "Codex Mini", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], false),
            bundled("openai", "gpt-4", "GPT-4", 8192, 8192, false, Vec::new(), false),
            bundled("openai", "gpt-4-turbo", "GPT-4 Turbo", 128000, 4096, false, Vec::new(), true),
            bundled("openai", "gpt-4.1", "GPT-4.1", 1047576, 32768, false, Vec::new(), true),
            bundled("openai", "gpt-4.1-mini", "GPT-4.1 mini", 1047576, 32768, false, Vec::new(), true),
            bundled("openai", "gpt-4.1-nano", "GPT-4.1 nano", 1047576, 32768, false, Vec::new(), true),
            bundled("openai", "gpt-4o", "GPT-4o", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-4o-2024-05-13", "GPT-4o (2024-05-13)", 128000, 4096, false, Vec::new(), true),
            bundled("openai", "gpt-4o-2024-08-06", "GPT-4o (2024-08-06)", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-4o-2024-11-20", "GPT-4o (2024-11-20)", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-4o-mini", "GPT-4o mini", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-5", "GPT-5", 400000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5-chat-latest", "GPT-5 Chat Latest", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-5-codex", "GPT-5-Codex", 272000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5-mini", "GPT-5 Mini", 400000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5-nano", "GPT-5 Nano", 400000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5-pro", "GPT-5 Pro", 400000, 272000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5.1", "GPT-5.1", 400000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5.1-chat-latest", "GPT-5.1 Chat", 128000, 16384, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5.1-codex", "GPT-5.1 Codex", 272000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5.1-codex-max", "GPT-5.1 Codex Max", 272000, 128000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("openai", "gpt-5.1-codex-mini", "GPT-5.1 Codex mini", 272000, 128000, true, vec!["medium", "high"], true),
            bundled("openai", "gpt-5.2", "GPT-5.2", 400000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.2-chat-latest", "GPT-5.2 Chat", 128000, 16384, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.2-codex", "GPT-5.2 Codex", 272000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.2-pro", "GPT-5.2 Pro", 400000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.3-chat-latest", "GPT-5.3 Chat", 128000, 16384, false, Vec::new(), true),
            bundled("openai", "gpt-5.3-codex", "GPT-5.3 Codex", 272000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", 128000, 32000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.4", "GPT-5.4", 1050000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.4-mini", "GPT-5.4 mini", 400000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.4-nano", "GPT-5.4 nano", 400000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.4-pro", "GPT-5.4 Pro", 1050000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.5", "GPT-5.5", 1050000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "gpt-5.5-pro", "GPT-5.5 Pro", 1050000, 128000, true, vec!["low", "medium", "high", "xhigh"], true),
            bundled("openai", "o1", "o1", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o1-pro", "o1-pro", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o3", "o3", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o3-deep-research", "o3-deep-research", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o3-mini", "o3-mini", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], false),
            bundled("openai", "o3-pro", "o3-pro", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o4-mini", "o4-mini", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("openai", "o4-mini-deep-research", "o4-mini-deep-research", 200000, 100000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
        ],
        "anthropic" => vec![
            bundled("anthropic", "claude-3-5-sonnet-20240620", "Claude Sonnet 3.5", 200000, 8192, false, Vec::new(), true),
            bundled("anthropic", "claude-3-5-sonnet-20241022", "Claude Sonnet 3.5 v2", 200000, 8192, false, Vec::new(), true),
            bundled("anthropic", "claude-3-7-sonnet-20250219", "Claude Sonnet 3.7", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-3-haiku-20240307", "Claude Haiku 3", 200000, 4096, false, Vec::new(), true),
            bundled("anthropic", "claude-3-opus-20240229", "Claude Opus 3", 200000, 4096, false, Vec::new(), true),
            bundled("anthropic", "claude-3-sonnet-20240229", "Claude Sonnet 3", 200000, 4096, false, Vec::new(), true),
            bundled("anthropic", "claude-fable-5", "Claude Fable 5", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-mythos-5", "Claude Mythos 5", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-0", "Claude Opus 4", 200000, 32000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-1", "Claude Opus 4.1", 200000, 32000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-1-20250805", "Claude Opus 4.1", 200000, 32000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-20250514", "Claude Opus 4", 200000, 32000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-5", "Claude Opus 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-5-20251101", "Claude Opus 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-6", "Claude Opus 4.6", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-7", "Claude Opus 4.7", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-opus-4-8", "Claude Opus 4.8", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-sonnet-4-0", "Claude Sonnet 4", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-sonnet-4-20250514", "Claude Sonnet 4", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", 200000, 64000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
            bundled("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", 1000000, 64000, true, vec!["minimal", "low", "medium", "high"], true),
            bundled("anthropic", "claude-sonnet-5", "Claude Sonnet 5", 1000000, 128000, true, vec!["minimal", "low", "medium", "high", "xhigh"], true),
        ],
        _ => Vec::new(),
    }
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

fn bundled(
    provider_id: &str,
    id: &str,
    label: &str,
    context_window: i64,
    max_tokens: i64,
    supports_reasoning: bool,
    supported_efforts: Vec<&str>,
    supports_images: bool,
) -> NativeModel {
    model_with_source(NativeModel {
        id: id.to_string(),
        provider_id: provider_id.to_string(),
        label: label.to_string(),
        supports_effort: supports_reasoning,
        supports_streaming: true,
        supports_tools: true,
        local_only: false,
        context_window: Some(context_window),
        max_tokens: Some(max_tokens),
        supports_reasoning,
        supported_efforts: supported_efforts.into_iter().map(String::from).collect(),
        supports_images,
        source: "bundled".to_string(),
        model_api_id: None,
    }, "bundled")
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
        _ => id.contains("reason") || id.contains("glm") || id.contains("thinking"),
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
}

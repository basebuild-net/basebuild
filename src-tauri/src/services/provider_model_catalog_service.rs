use std::{
    collections::HashMap,
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, RwLock,
    },
    time::Duration,
};

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{
    models::{
        model_catalog,
        native_chat::{
            NativeEffortLevel, NativeModel, NativeProvider, NativeProviderCatalog,
            NativeProviderCredential,
        },
    },
    services::{
        native_chat_service::NativeChatService,
        provider_client::{NATIVE_CODEX_BASE_URL, OMP_CODEX_BASE_URL},
        storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

const LOCAL_PROVIDER_ID: &str = "basebuild-local";
const LOCAL_MODEL_ID: &str = "basebuild-local-coordinator";
/// The single catch-all provider aggregating every detected local LLM model.
const LOCAL_MODELS_PROVIDER_ID: &str = "local-models";
const DEFAULT_EFFORT: &str = "medium";
const CACHE_MAX_AGE_SECONDS: i64 = 24 * 60 * 60;
static CATALOG_CACHE: LazyLock<RwLock<Option<NativeProviderCatalog>>> =
    LazyLock::new(|| RwLock::new(None));
/// Set once the first local-server scan has run this process, so the chat
/// bootstrap probes loopback at most once instead of on every open.
static LOCAL_SCAN_DONE: AtomicBool = AtomicBool::new(false);

/// Provider-level metadata overlaid on the model catalog. The catalog carries
/// the model list and wire-protocol kind; Basebuild adds the auth/UI metadata.
struct ProviderOverlay {
    label: &'static str,
    credential_owner: &'static str,
    local_only: bool,
    auth_method: &'static str,
    api_key_url: Option<&'static str>,
    detail: &'static str,
    default_base_url: Option<&'static str>,
}

/// Resolved provider spec: catalog presence + Basebuild overlay metadata.
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
    /// Detected local-server kind (`lmstudio`/`ollama`/…) when this spec is a
    /// local LLM provider; None for catalog/synthetic providers.
    local_kind: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedModel {
    model: NativeModel,
    synced_at: i64,
    error: Option<String>,
    bundled_version: Option<String>,
}

pub struct ProviderModelCatalogService;
/// Classify a stored credential by its base-url sentinel: Basebuild-native
/// OAuth, OMP-owned OAuth, or a plain API key.
fn credential_auth_source(base_url: Option<&str>) -> &'static str {
    match base_url {
        Some(NATIVE_CODEX_BASE_URL) => "oauth",
        Some(url) if url.starts_with("omp://") => "omp",
        _ => "api",
    }
}

impl ProviderModelCatalogService {
    pub fn catalog() -> NativeProviderCatalog {
        if let Ok(cache) = CATALOG_CACHE.read() {
            if let Some(catalog) = cache.as_ref() {
                return catalog.clone();
            }
        }

        let mut credential_sources: HashMap<String, String> = HashMap::new();
        for credential in NativeChatService::list_credentials().unwrap_or_default() {
            credential_sources
                .entry(credential.provider_id)
                .or_insert_with(|| {
                    credential_auth_source(credential.base_url.as_deref()).to_string()
                });
        }
        let now = now_seconds();
        let cached = Self::cached_models().unwrap_or_default();
        let specs = provider_specs();
        let mut models = Vec::new();
        let mut stale = false;
        for spec in &specs {
            let provider_cached: Vec<&CachedModel> = cached
                .iter()
                .filter(|m| m.model.provider_id == spec.id)
                .collect();
            if provider_cached.is_empty() {
                models.extend(bundled_models(&spec.id));
                if !spec.local_only && credential_sources.contains_key(&spec.id) {
                    stale = true;
                }
                continue;
            }

            // Stamp-mismatch check: if cached rows are bundled-source and
            // their catalog version doesn't match the current bundled
            // catalog, replace them with current bundled models. This
            // self-heals stale bundled rows without manual DB surgery.
            let current_version = model_catalog::CATALOG_VERSION.trim();
            let bundled_stale = provider_cached.iter().any(|item| {
                item.model.source == "bundled"
                    && item.bundled_version.as_deref() != Some(current_version)
            });
            if bundled_stale {
                let fresh = bundled_models(&spec.id);
                let _ = Self::replace_provider_cache(&spec.id, fresh.clone(), "bundled", None);
                models.extend(fresh);
                continue;
            }

            for item in &provider_cached {
                if !spec.local_only
                    && credential_sources.contains_key(&spec.id)
                    && now - item.synced_at > CACHE_MAX_AGE_SECONDS
                {
                    stale = true;
                }
                models.push(item.model.clone());
            }
        }

        // Local models: tool capability follows the per-model server kind
        // (parsed from the `<kind>:<name>` id) and any user override, not the
        // generic transport table (which marks every openai-completions model
        // tool-capable).
        for model in models
            .iter_mut()
            .filter(|m| m.provider_id == LOCAL_MODELS_PROVIDER_ID)
        {
            let kind = model.id.split(':').next().unwrap_or_default();
            let default_tools = crate::services::local_llm_service::kind_supports_tools(kind);
            model.supports_tools =
                crate::services::local_llm_service::LocalLlmService::tool_override(
                    LOCAL_MODELS_PROVIDER_ID,
                    &model.id,
                )
                .unwrap_or(default_tools);
        }

        // Account aggregation for catalog surfaces: stored accounts grouped by
        // provider plus the OMP virtual account where OMP is logged in and the
        // provider isn't blocked.
        let account_records =
            crate::services::provider_account_service::ProviderAccountService::list_records(None)
                .unwrap_or_default();
        let omp_provider_ids: Vec<String> = NativeChatService::omp_provider_ids()
            .into_iter()
            .filter(|id| {
                !crate::services::provider_account_service::ProviderAccountService::is_provider_blocked(id)
                    .unwrap_or(false)
            })
            .collect();

        let providers = specs
            .iter()
            .map(|spec| {
                let provider_models: Vec<&NativeModel> =
                    models.iter().filter(|m| m.provider_id == spec.id).collect();
                let provider_cached: Vec<&CachedModel> = cached
                    .iter()
                    .filter(|m| m.model.provider_id == spec.id)
                    .collect();
                let configured = spec.local_only || credential_sources.contains_key(&spec.id);
                let all_bespoke = !spec.local_only
                    && !provider_models.is_empty()
                    && provider_models
                        .iter()
                        .all(|m| is_bespoke_api_kind(&m.api_kind));
                let has_base_url = provider_models.iter().any(|m| !m.base_url.is_empty());
                let transport_unavailable = all_bespoke && !has_base_url && configured;
                let last_synced_at = provider_cached.iter().map(|m| m.synced_at).max();
                let error = provider_cached.iter().find_map(|m| m.error.clone());
                let source = provider_models
                    .iter()
                    .find(|m| !m.source.is_empty())
                    .map(|m| m.source.clone())
                    .unwrap_or_else(|| "bundled".to_string());
                NativeProvider {
                    id: spec.id.clone(),
                    label: spec.label.clone(),
                    status: if spec.local_kind.is_some() && !configured {
                        "disconnected".to_string()
                    } else if !configured {
                        "setup_required".to_string()
                    } else if transport_unavailable {
                        "transport_unavailable".to_string()
                    } else {
                        "ready".to_string()
                    },
                    credential_owner: spec.credential_owner.clone(),
                    configured,
                    connected_via: credential_sources.get(&spec.id).cloned(),
                    local_only: spec.local_only,
                    detail: spec.detail.clone(),
                    auth_method: spec.auth_method.clone(),
                    api_key_url: spec.api_key_url.clone(),
                    default_base_url: spec.default_base_url.clone(),
                    model_count: provider_models.len() as i64,
                    account_count: {
                        let stored = account_records
                            .iter()
                            .filter(|record| record.provider_id == spec.id)
                            .count() as i64;
                        stored + i64::from(omp_provider_ids.contains(&spec.id))
                    },
                    oauth_count: account_records
                        .iter()
                        .filter(|record| {
                            record.provider_id == spec.id
                                && record.auth_method
                                    == crate::services::provider_account_service::AUTH_OAUTH
                        })
                        .count() as i64,
                    api_key_count: account_records
                        .iter()
                        .filter(|record| {
                            record.provider_id == spec.id
                                && record.auth_method
                                    == crate::services::provider_account_service::AUTH_API
                        })
                        .count() as i64,
                    aggregate_health: {
                        let provider_accounts: Vec<_> = account_records
                            .iter()
                            .filter(|record| record.provider_id == spec.id)
                            .collect();
                        if provider_accounts.is_empty() {
                            "healthy".to_string()
                        } else {
                            let usable = provider_accounts
                                .iter()
                                .filter(|record| {
                                    record.health == "healthy"
                                        || (record.health == "rate_limited"
                                            && record
                                                .cooldown_until
                                                .is_none_or(|until| until <= now))
                                })
                                .count();
                            if usable == provider_accounts.len() {
                                "healthy".to_string()
                            } else if usable > 0 {
                                "degraded".to_string()
                            } else {
                                "broken".to_string()
                            }
                        }
                    },
                    last_synced_at,
                    source,
                    error,
                }
            })
            .collect();

        let catalog = NativeProviderCatalog {
            providers,
            models,
            effort_levels: effort_levels(),
            default_provider_id: LOCAL_PROVIDER_ID.to_string(),
            default_model_id: LOCAL_MODEL_ID.to_string(),
            default_effort_level: DEFAULT_EFFORT.to_string(),
            fetched_at: now,
            stale,
        };
        if let Ok(mut cache) = CATALOG_CACHE.write() {
            *cache = Some(catalog.clone());
        }
        catalog
    }

    pub fn refresh(provider_id: Option<String>, force: bool) -> DbResult<NativeProviderCatalog> {
        // A full refresh re-probes local servers first so freshly-started (or
        // stopped) LM Studio/Ollama servers fold in before specs are built.
        if provider_id.is_none() {
            let _ = Self::scan_local_servers();
        }
        let credentials = NativeChatService::list_credentials().unwrap_or_default();
        let targets: Vec<ProviderSpec> = match provider_id.as_deref() {
            Some(id) => provider_specs()
                .into_iter()
                .filter(|p| p.id == id)
                .collect(),
            // Local specs are already discovered by the scan prelude above.
            None => provider_specs()
                .into_iter()
                .filter(|p| p.local_kind.is_none())
                .collect(),
        };

        // The canonical basebuild.net catalog fetch is shared by every
        // provider: fetch it at most once per refresh instead of once per
        // provider. A forced full refresh previously paid the 20s-timeout
        // network round-trip for each of ~20 providers, freezing callers.
        let mut catalog_synced = None;
        for spec in targets {
            Self::refresh_provider_spec(spec, &credentials, force, &mut catalog_synced)?;
        }

        Self::invalidate();
        Ok(Self::catalog())
    }

    pub fn refresh_provider(provider_id: &str, force: bool) -> DbResult<NativeProviderCatalog> {
        Self::refresh(Some(provider_id.to_string()), force)
    }

    pub fn invalidate() {
        if let Ok(mut cache) = CATALOG_CACHE.write() {
            *cache = None;
        }
    }

    /// Probe loopback for local LLM servers, reconcile their keyless accounts,
    /// invalidate the catalog cache, and return the known-server set. Used by
    /// the full refresh and the explicit rescan command.
    pub fn scan_local_servers(
    ) -> DbResult<Vec<crate::services::local_llm_service::DetectedLocalServer>> {
        let servers = crate::services::local_llm_service::LocalLlmService::scan()?;
        NativeChatService::sync_local_accounts(&servers)?;
        // Aggregate every reachable server's models under the single
        // `local-models` provider. Each model keeps its own base URL (so chat
        // routes to the right port) and a kind-prefixed id (so two servers
        // can expose the same model name without colliding).
        let mut aggregated: Vec<NativeModel> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for server in servers.iter().filter(|s| s.reachable) {
            let spec = ProviderSpec {
                id: LOCAL_MODELS_PROVIDER_ID.to_string(),
                label: local_server_label(&server.kind),
                credential_owner: "basebuild".to_string(),
                local_only: false,
                auth_method: "local".to_string(),
                api_key_url: None,
                detail: String::new(),
                default_base_url: Some(server.base_url.clone()),
                local_kind: Some(server.kind.clone()),
            };
            match Self::discover_local_models(&spec, &server.kind) {
                Ok(models) => {
                    let server_label = local_server_label(&server.kind);
                    for mut model in models {
                        // Raw name goes on the wire; the catalog id is namespaced.
                        let raw = model.id.clone();
                        model.model_api_id = Some(raw.clone());
                        model.id = format!("{}:{}", server.kind, raw);
                        model.label = format!("{server_label} · {raw}");
                        model.base_url = server.base_url.clone();
                        // Non-empty api_kind so resolve_model_routing returns the
                        // per-model base URL and chat routes to OpenAiCompatibleClient
                        // (never the OMP RPC bridge).
                        model.api_kind = "openai-completions".to_string();
                        aggregated.push(model);
                    }
                }
                Err(error) => errors.push(error),
            }
        }
        aggregated.sort_by(|a, b| a.label.cmp(&b.label));
        let error = if aggregated.is_empty() && !errors.is_empty() {
            Some(errors.join("; "))
        } else {
            None
        };
        let _ = Self::replace_provider_cache(
            LOCAL_MODELS_PROVIDER_ID,
            aggregated,
            "local_discovered",
            error,
        );
        LOCAL_SCAN_DONE.store(true, Ordering::SeqCst);
        Self::invalidate();
        Ok(servers)
    }

    /// Run the local-server scan exactly once per process (on the first chat
    /// bootstrap). A cold machine with no local server probes only once, not on
    /// every catalog open.
    pub fn ensure_local_servers() {
        if LOCAL_SCAN_DONE.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = Self::scan_local_servers();
    }

    fn refresh_provider_spec(
        spec: ProviderSpec,
        credentials: &[NativeProviderCredential],
        force: bool,
        catalog_synced: &mut Option<crate::services::catalog_sync_service::CatalogSyncResult>,
    ) -> DbResult<()> {
        if spec.local_only {
            return Self::replace_provider_cache(
                &spec.id,
                bundled_models(&spec.id),
                "bundled",
                None,
            );
        }

        // The catch-all local provider (re)discovers by rescanning every
        // loopback endpoint; discovery + account sync live in scan_local_servers.
        if spec.local_kind.is_some() {
            let _ = Self::scan_local_servers();
            return Ok(());
        }

        let credential = credentials.iter().find(|c| c.provider_id == spec.id);

        // Fast path: a fresh cache needs no work and — crucially — no network.
        // The catalog sync below only runs once at least one provider is stale.
        if !force {
            match credential {
                None if Self::has_cached_provider(&spec.id)? => return Ok(()),
                Some(_) if Self::provider_cache_fresh(&spec.id)? => return Ok(()),
                _ => {}
            }
        }

        // Run the basebuild.net catalog sync once per refresh (memoized). It
        // upserts canonical `catalog_sync` rows for every provider before any
        // per-provider merge runs, so each provider's catalog rows are intact
        // when its own merge reads them below.
        let _ =
            catalog_synced.get_or_insert_with(crate::services::catalog_sync_service::sync_catalog);

        // Static references, always available: the basebuild.net catalog and
        // the shipped bundled catalog. They seed the cross-reference so a model
        // present in the catalog but absent from the live source still lists.
        let mut sources: Vec<(&str, Vec<NativeModel>)> = Vec::new();
        let catalog_models = Self::catalog_cached_models(&spec.id)?;
        if !catalog_models.is_empty() {
            sources.push(("catalog_sync", catalog_models));
        }
        sources.push(("bundled", bundled_models(&spec.id)));

        let Some(credential) = credential else {
            // No credential: only static sources to cross-reference.
            let merged = merge_model_sources(sources);
            return Self::replace_provider_cache(&spec.id, merged, "bundled", None);
        };

        let credential_base_url = credential.base_url.as_deref();

        // Codex OAuth / OMP-codex have no live `/v1/models` endpoint; the
        // catalog's `openai-codex` provider (already in `sources` as bundled/
        // catalog_sync) is the model set. Insert the tool-corrected variant
        // FIRST so it wins the canonical record over the raw catalog rows,
        // while those still contribute their detection labels.
        if credential_base_url == Some(NATIVE_CODEX_BASE_URL) {
            sources.insert(0, ("bundled", native_codex_oauth_models()));
            let merged = merge_model_sources(sources);
            return Self::replace_provider_cache(&spec.id, merged, "bundled", None);
        }
        if credential_base_url == Some(OMP_CODEX_BASE_URL) {
            sources.insert(0, ("bundled", omp_codex_oauth_models()));
            let merged = merge_model_sources(sources);
            return Self::replace_provider_cache(&spec.id, merged, "bundled", None);
        }

        // Live detection: the endpoint the credential routes to. OMP-backed and
        // bespoke providers use `omp models`; everything else is OpenAI-
        // compatible `/v1/models`. Its models are cross-referenced against the
        // static sources and tagged so the UI can flag live-confirmed models.
        let (live_label, live): (&str, DbResult<Vec<NativeModel>>) = if credential_base_url
            .is_some_and(|value| value.starts_with("omp://"))
            || is_bespoke_provider(&spec.id)
        {
            ("omp_cli", Self::discover_via_omp_cli(&spec.id))
        } else {
            (
                "provider_discovered",
                Self::discover_openai_compatible(spec.clone(), credential),
            )
        };

        match live {
            Ok(models) if !models.is_empty() => {
                sources.push((live_label, models));
                let merged = merge_model_sources(sources);
                Self::replace_provider_cache(&spec.id, merged, "provider_discovered", None)
            }
            Ok(_) => {
                let merged = merge_model_sources(sources);
                if merged.is_empty() {
                    Self::fallback_or_preserve(spec, "Provider returned no models.")
                } else {
                    Self::replace_provider_cache(&spec.id, merged, "bundled", None)
                }
            }
            Err(error) => {
                let merged = merge_model_sources(sources);
                if merged.is_empty() {
                    Self::fallback_or_preserve(spec, &error)
                } else {
                    Self::replace_provider_cache(&spec.id, merged, "bundled", Some(error))
                }
            }
        }
    }

    /// Discover models from a detected local server. Ollama uses its native
    /// `/api/tags`; everything else uses the shared OpenAI-compatible
    /// `/v1/models` path. Results are tagged `local_discovered`.
    fn discover_local_models(spec: &ProviderSpec, kind: &str) -> DbResult<Vec<NativeModel>> {
        use crate::services::local_llm_service::{KIND_LMSTUDIO, KIND_OLLAMA};
        let mut models = if kind == KIND_OLLAMA {
            Self::discover_ollama_models(spec)?
        } else if kind == KIND_LMSTUDIO {
            // LM Studio's native REST API reports load state + capabilities;
            // fall back to plain /v1/models on older builds.
            match Self::discover_lmstudio_models(spec) {
                Ok(models) if !models.is_empty() => models,
                _ => {
                    let credential = Self::local_credential(spec);
                    Self::discover_openai_compatible(spec.clone(), &credential)?
                }
            }
        } else {
            let credential = Self::local_credential(spec);
            Self::discover_openai_compatible(spec.clone(), &credential)?
        };
        for model in models.iter_mut() {
            model.source = "local_discovered".to_string();
            model.detected_by = vec!["local_discovered".to_string()];
        }
        Ok(models)
    }

    fn local_credential(spec: &ProviderSpec) -> NativeProviderCredential {
        NativeProviderCredential {
            provider_id: spec.id.clone(),
            label: spec.label.clone(),
            api_key: "local".to_string(),
            base_url: spec.default_base_url.clone(),
            updated_at: 0,
        }
    }

    /// Discover LM Studio models via its native `/api/v0/models`, which reports
    /// `state` (loaded vs not-loaded), `type` (skip embeddings), tool
    /// `capabilities`, and context length. `base_url` here is `…/v1`; the REST
    /// API lives at the root, so trim `/v1`.
    fn discover_lmstudio_models(spec: &ProviderSpec) -> DbResult<Vec<NativeModel>> {
        let base_url = spec
            .default_base_url
            .as_deref()
            .unwrap_or("http://127.0.0.1:1234/v1");
        let root = base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{root}/api/v0/models");
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to build LM Studio discovery client: {e}"))?
            .get(url)
            .send()
            .map_err(|e| format!("Failed to fetch LM Studio models: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "LM Studio model discovery failed with HTTP {status}.",
                status = response.status().as_u16()
            ));
        }
        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse LM Studio model payload: {e}"))?;
        let entries = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| "LM Studio model payload did not include a data array.".to_string())?;
        let mut models = Vec::new();
        for entry in entries {
            let id = entry.get("id").and_then(Value::as_str).unwrap_or_default().trim();
            if id.is_empty() {
                continue;
            }
            // Embeddings models can't chat — list only generative ones.
            if entry.get("type").and_then(Value::as_str) == Some("embeddings") {
                continue;
            }
            let running = entry.get("state").and_then(Value::as_str) == Some("loaded");
            let supports_tools = entry
                .get("capabilities")
                .and_then(Value::as_array)
                .is_some_and(|caps| caps.iter().any(|c| c.as_str() == Some("tool_use")));
            let context_window = entry
                .get("max_context_length")
                .and_then(Value::as_i64)
                .or_else(|| entry.get("loaded_context_length").and_then(Value::as_i64));
            models.push(model_with_source(
                NativeModel {
                    id: id.to_string(),
                    provider_id: spec.id.clone(),
                    label: id.to_string(),
                    supports_effort: false,
                    supports_streaming: true,
                    supports_tools,
                    local_only: false,
                    context_window,
                    max_tokens: None,
                    supports_reasoning: false,
                    supported_efforts: Vec::new(),
                    supports_images: false,
                    supports_audio_input: false,
                    supports_audio_output: false,
                    voice: None,
                    source: "local_discovered".to_string(),
                    model_api_id: None,
                    api_kind: String::new(),
                    base_url: String::new(),
                    cost_input: None,
                    cost_output: None,
                    detected_by: Vec::new(),
                    running,
                },
                "local_discovered",
            ));
        }
        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    /// Discover Ollama models from `/api/tags` (root, no `/v1`). Chat still
    /// routes to the `/v1` OpenAI-compatible surface via the stored base URL.
    fn discover_ollama_models(spec: &ProviderSpec) -> DbResult<Vec<NativeModel>> {
        let base_url = spec
            .default_base_url
            .as_deref()
            .unwrap_or("http://127.0.0.1:11434/v1");
        let root = base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{root}/api/tags");
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to build Ollama discovery client: {e}"))?
            .get(url)
            .send()
            .map_err(|e| format!("Failed to fetch Ollama models: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Ollama model discovery failed with HTTP {status}.",
                status = response.status().as_u16()
            ));
        }
        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse Ollama model payload: {e}"))?;
        let entries = payload
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| "Ollama model payload did not include a models array.".to_string())?;
        // /api/ps lists models currently loaded in memory (running).
        let running_set: std::collections::HashSet<String> =
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(4))
                .build()
                .ok()
                .and_then(|c| c.get(format!("{root}/api/ps")).send().ok())
                .and_then(|r| r.json::<Value>().ok())
                .and_then(|v| {
                    v.get("models").and_then(Value::as_array).map(|arr| {
                        arr.iter()
                            .filter_map(|m| m.get("name").and_then(Value::as_str))
                            .map(str::to_string)
                            .collect()
                    })
                })
                .unwrap_or_default();
        let mut models = Vec::new();
        for entry in entries {
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if name.is_empty() {
                continue;
            }
            models.push(model_with_source(
                NativeModel {
                    id: name.to_string(),
                    provider_id: spec.id.clone(),
                    label: name.to_string(),
                    supports_effort: false,
                    supports_streaming: true,
                    supports_tools: true,
                    local_only: false,
                    context_window: None,
                    max_tokens: None,
                    supports_reasoning: false,
                    supported_efforts: Vec::new(),
                    supports_images: false,
                    supports_audio_input: false,
                    supports_audio_output: false,
                    voice: None,
                    source: "local_discovered".to_string(),
                    model_api_id: None,
                    api_kind: String::new(),
                    base_url: String::new(),
                    cost_input: None,
                    cost_output: None,
                    detected_by: Vec::new(),
                    running: running_set.contains(name),
                },
                "local_discovered",
            ));
        }
        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    fn discover_openai_compatible(
        spec: ProviderSpec,
        credential: &NativeProviderCredential,
    ) -> DbResult<Vec<NativeModel>> {
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

        let payload: Value = response.json().map_err(|e| {
            format!(
                "Failed to parse {label} model payload: {e}",
                label = spec.label
            )
        })?;
        let entries = payload
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                format!(
                    "{label} model payload did not include a data array.",
                    label = spec.label
                )
            })?;

        let mut models = Vec::new();
        for entry in entries {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if id.is_empty() {
                continue;
            }
            models.push(model_with_source(
                NativeModel {
                    id: id.to_string(),
                    provider_id: spec.id.to_string(),
                    label: model_label(&spec.id, id),
                    supports_effort: supports_reasoning(&spec.id, id),
                    supports_streaming: true,
                    supports_tools: true,
                    local_only: false,
                    context_window: extract_i64(
                        entry,
                        &[
                            "context_window",
                            "contextWindow",
                            "context_length",
                            "max_context_window",
                            "maxContextWindow",
                        ],
                    ),
                    max_tokens: extract_i64(
                        entry,
                        &[
                            "max_output_tokens",
                            "maxOutputTokens",
                            "max_tokens",
                            "maxTokens",
                        ],
                    ),
                    supports_reasoning: supports_reasoning(&spec.id, id),
                    supported_efforts: if supports_reasoning(&spec.id, id) {
                        effort_ids()
                    } else {
                        Vec::new()
                    },
                    supports_images: supports_images(id),
                    supports_audio_input: false,
                    supports_audio_output: false,
                    voice: None,
                    source: "provider_discovered".to_string(),
                    model_api_id: None,
                    api_kind: String::new(),
                    base_url: String::new(),
                    cost_input: None,
                    cost_output: None,
                    detected_by: Vec::new(),
                    running: false,
                },
                "provider_discovered",
            ));
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
        let output = crate::services::process_helpers::hidden_command("omp")
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
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if id.is_empty() {
                continue;
            }
            let reasoning = entry
                .get("reasoning")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let supported_efforts = if reasoning { effort_ids() } else { Vec::new() };
            let context_window = entry
                .get("contextWindow")
                .and_then(Value::as_i64)
                .or_else(|| entry.get("context_window").and_then(Value::as_i64));
            let max_tokens = entry
                .get("maxTokens")
                .and_then(Value::as_i64)
                .or_else(|| entry.get("max_tokens").and_then(Value::as_i64));
            let api_kind = entry
                .get("api")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let base_url = entry
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let modalities = |key: &str| -> Vec<String> {
                entry
                    .get(key)
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let input_modalities = modalities("input");
            let output_modalities = modalities("output");
            let supports_images = input_modalities.iter().any(|m| m == "image");
            // The modality arrays are the only audio signal this payload
            // carries. No `voice` block is synthesised from them: knowing a
            // model takes audio in says nothing about whether it holds a
            // duplex session open, and an id that reads like a realtime model
            // is not evidence that it is one.
            let supports_audio_input = input_modalities.iter().any(|m| m == "audio");
            let supports_audio_output = output_modalities.iter().any(|m| m == "audio");
            let cost_input = entry
                .get("cost")
                .and_then(|c| c.get("input"))
                .and_then(Value::as_f64);
            let cost_output = entry
                .get("cost")
                .and_then(|c| c.get("output"))
                .and_then(Value::as_f64);
            let label = entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string();
            models.push(model_with_source(
                NativeModel {
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
                    supports_audio_input,
                    supports_audio_output,
                    voice: None,
                    source: "omp_cli".to_string(),
                    model_api_id: None,
                    api_kind,
                    base_url,
                    cost_input,
                    cost_output,
                    detected_by: Vec::new(),
                    running: false,
                },
                "omp_cli",
            ));
        }
        models.sort_by(|a, b| a.label.cmp(&b.label));
        models.dedup_by(|a, b| a.id == b.id && a.provider_id == b.provider_id);
        Ok(models)
    }

    fn fallback_or_preserve(spec: ProviderSpec, error: &str) -> DbResult<()> {
        if let Some(models) = Self::hosted_fallback(spec.clone())? {
            if !models.is_empty() {
                return Self::replace_provider_cache(
                    &spec.id,
                    models,
                    "hosted_fallback",
                    Some(error.to_string()),
                );
            }
        }

        if Self::has_cached_provider(&spec.id)? {
            Self::mark_provider_error(&spec.id, error)
        } else {
            Self::replace_provider_cache(
                &spec.id,
                bundled_models(&spec.id),
                "bundled",
                Some(error.to_string()),
            )
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
                        || provider
                            .get("name")
                            .and_then(Value::as_str)
                            .map(|name| name.eq_ignore_ascii_case(&spec.label))
                            .unwrap_or(false)
                })
                .and_then(|provider| provider.get("models").and_then(Value::as_array).cloned())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let models = entries
            .iter()
            .filter_map(|entry| {
                let id = entry
                    .get("id")
                    .or_else(|| entry.get("key"))
                    .and_then(Value::as_str)?
                    .trim();
                if id.is_empty() {
                    return None;
                }
                let label = entry
                    .get("label")
                    .or_else(|| entry.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| model_label(&spec.id, id));
                let reasoning = entry
                    .get("supportsReasoning")
                    .and_then(Value::as_bool)
                    .unwrap_or_else(|| supports_reasoning(&spec.id, id));
                let supported = entry
                    .get("supportedEfforts")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_else(|| if reasoning { effort_ids() } else { Vec::new() });
                Some(model_with_source(
                    NativeModel {
                        id: id.to_string(),
                        provider_id: spec.id.to_string(),
                        label,
                        supports_effort: reasoning,
                        supports_streaming: true,
                        supports_tools: true,
                        local_only: false,
                        context_window: extract_i64(
                            entry,
                            &[
                                "context_window",
                                "contextWindow",
                                "context_length",
                                "max_context_window",
                                "maxContextWindow",
                            ],
                        ),
                        max_tokens: extract_i64(
                            entry,
                            &[
                                "max_output_tokens",
                                "maxOutputTokens",
                                "max_tokens",
                                "maxTokens",
                            ],
                        ),
                        supports_reasoning: reasoning,
                        supported_efforts: supported,
                        supports_images: entry
                            .get("supportsImages")
                            .and_then(Value::as_bool)
                            .unwrap_or_else(|| supports_images(id)),
                        // Read only what the directory states. Unlike
                        // `supportsImages` above there is deliberately no id
                        // fallback: an unstated audio capability is false,
                        // not guessed.
                        supports_audio_input: entry
                            .get("supportsAudioInput")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        supports_audio_output: entry
                            .get("supportsAudioOutput")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        voice: None,
                        source: "hosted_fallback".to_string(),
                        model_api_id: None,
                        api_kind: String::new(),
                        base_url: String::new(),
                        cost_input: None,
                        cost_output: None,
                        detected_by: Vec::new(),
                        running: false,
                    },
                    "hosted_fallback",
                ))
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
                        api_kind, base_url, cost_input, cost_output, bundled_version, detected_by, running,
                        supports_audio_input, supports_audio_output, voice_json
                 FROM native_provider_model_cache
                 ORDER BY provider_id, label",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let provider_id: String = row.get(0)?;
                let model_id: String = row.get(1)?;
                let supported_raw: String = row.get(6)?;
                let supported_efforts =
                    serde_json::from_str::<Vec<String>>(&supported_raw).unwrap_or_default();
                let local_only = provider_id == LOCAL_PROVIDER_ID;
                let api_kind = row.get::<_, Option<String>>(12)?.unwrap_or_default();
                let detected_by = serde_json::from_str::<Vec<String>>(&row.get::<_, String>(17)?)
                    .unwrap_or_default();
                // A malformed blob degrades this row to "no voice" rather
                // than failing the whole catalog read and blanking the
                // model picker.
                let voice = row.get::<_, Option<String>>(21)?.and_then(|raw| {
                    serde_json::from_str::<model_catalog::CatalogVoice>(&raw).ok()
                });
                Ok(CachedModel {
                    model: NativeModel {
                        id: model_id,
                        provider_id,
                        label: row.get(2)?,
                        supports_effort: row.get::<_, i64>(5)? != 0,
                        supports_streaming: !local_only,
                        supports_tools: !local_only && {
                            let base_url: String =
                                row.get::<_, Option<String>>(13)?.unwrap_or_default();
                            crate::services::provider_client::transport_supports_tools_with_base(
                                &api_kind, &base_url,
                            )
                        },
                        local_only,
                        context_window: row.get(3)?,
                        max_tokens: row.get(4)?,
                        supports_reasoning: row.get::<_, i64>(5)? != 0,
                        supported_efforts,
                        supports_images: row.get::<_, i64>(7)? != 0,
                        supports_audio_input: row.get::<_, i64>(19)? != 0,
                        supports_audio_output: row.get::<_, i64>(20)? != 0,
                        voice,
                        source: row.get(8)?,
                        model_api_id: row.get::<_, Option<String>>(11)?,
                        api_kind,
                        base_url: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                        cost_input: row.get::<_, Option<f64>>(14)?,
                        cost_output: row.get::<_, Option<f64>>(15)?,
                        detected_by,
                        running: row.get::<_, i64>(18)? != 0,
                    },
                    synced_at: row.get(9)?,
                    error: row.get(10)?,
                    bundled_version: row.get::<_, Option<String>>(16)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn replace_provider_cache(
        provider_id: &str,
        models: Vec<NativeModel>,
        source: &str,
        error: Option<String>,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let now = now_seconds();
        conn.execute(
            "DELETE FROM native_provider_model_cache WHERE provider_id = ?1",
            params![provider_id],
        )
        .map_err(|e| format!("Failed to clear model cache: {e}"))?;
        for model in models {
            let row_source = if model.source.is_empty() {
                source
            } else {
                model.source.as_str()
            };
            let bundled_version = if row_source == "bundled" {
                Some(model_catalog::CATALOG_VERSION.trim().to_string())
            } else {
                None
            };
            let detected_by = if model.detected_by.is_empty() {
                vec![row_source.to_string()]
            } else {
                model.detected_by.clone()
            };
            let detected_by_json =
                serde_json::to_string(&detected_by).unwrap_or_else(|_| "[]".to_string());
            // NULL when the model has no voice block. A serialization failure
            // is treated the same way rather than aborting the cache write.
            let voice_json = model
                .voice
                .as_ref()
                .and_then(|voice| serde_json::to_string(voice).ok());
            conn.execute(
                "INSERT INTO native_provider_model_cache
                 (provider_id, model_id, label, context_window, max_tokens, supports_reasoning,
                  supported_efforts, supports_images, source, synced_at, error, model_api_id,
                  api_kind, base_url, cost_input, cost_output, bundled_version, detected_by, running,
                  supports_audio_input, supports_audio_output, voice_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19,
                         ?20, ?21, ?22)",
                params![
                    provider_id,
                    model.id,
                    model.label,
                    model.context_window,
                    model.max_tokens,
                    model.supports_reasoning as i32,
                    serde_json::to_string(&model.supported_efforts).unwrap_or_else(|_| "[]".to_string()),
                    model.supports_images as i32,
                    row_source,
                    now,
                    error,
                    model.model_api_id,
                    model.api_kind,
                    model.base_url,
                    model.cost_input,
                    model.cost_output,
                    bundled_version,
                    detected_by_json,
                    model.running as i32,
                    model.supports_audio_input as i32,
                    model.supports_audio_output as i32,
                    voice_json,
                ],
            )
            .map_err(|e| format!("Failed to save model cache row: {e}"))?;
        }
        Ok(())
    }

    /// The basebuild.net `catalog_sync` rows currently cached for a provider,
    /// rebuilt into `NativeModel`s so the refresh merge can cross-reference
    /// them. Reads the shared cache (populated by `sync_catalog` earlier in the
    /// same refresh) and keeps only canonical catalog rows.
    fn catalog_cached_models(provider_id: &str) -> DbResult<Vec<NativeModel>> {
        Ok(Self::cached_models()?
            .into_iter()
            .filter(|c| c.model.provider_id == provider_id && c.model.source == "catalog_sync")
            .map(|c| c.model)
            .collect())
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
        (
            "umans",
            ProviderOverlay {
                label: "Umans",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://app.umans.ai/billing?context=personal&tab=api-keys"),
                detail: "Umans API — OpenAI-compatible. Enter your API key to connect.",
                default_base_url: Some("https://api.code.umans.ai/v1"),
            },
        ),
        (
            "openai-codex",
            ProviderOverlay {
                label: "OpenAI Codex",
                credential_owner: "user",
                local_only: false,
                auth_method: "oauth",
                api_key_url: None,
                detail: "Sign in with a ChatGPT subscription through Basebuild's native OpenAI OAuth flow.",
                default_base_url: None,
            },
        ),
        (
            "openai",
            ProviderOverlay {
                label: "OpenAI API",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://platform.openai.com/api-keys"),
                detail: "OpenAI API key for usage-billed access. ChatGPT subscriptions connect through OpenAI Codex.",
                default_base_url: Some("https://api.openai.com/v1"),
            },
        ),
        (
            "anthropic",
            ProviderOverlay {
                label: "Anthropic",
                credential_owner: "user",
                local_only: false,
                auth_method: "oauth",
                api_key_url: Some("https://console.anthropic.com/settings/keys"),
                detail: "Sign in with a Claude subscription through Oh My Pi, or connect with an API key.",
                default_base_url: Some("https://api.anthropic.com/v1"),
            },
        ),
        (
            "devin",
            ProviderOverlay {
                label: "Devin.ai",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://app.devin.ai/settings/api-keys"),
                detail: "Devin.ai (Codeium Cascade) — enter your API key to connect.",
                default_base_url: Some("https://server.codeium.com"),
            },
        ),
        (
            "google",
            ProviderOverlay {
                label: "Google Gemini",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://aistudio.google.com/apikey"),
                detail:
                    "Google Gemini API — OpenAI-compatible endpoint. Enter your API key to connect.",
                default_base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai"),
            },
        ),
        (
            "groq",
            ProviderOverlay {
                label: "Groq",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://console.groq.com/keys"),
                detail: "Groq API — OpenAI-compatible. Enter your API key to connect.",
                default_base_url: Some("https://api.groq.com/openai/v1"),
            },
        ),
        (
            "openrouter",
            ProviderOverlay {
                label: "OpenRouter",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://openrouter.ai/keys"),
                detail: "OpenRouter API — OpenAI-compatible. Enter your API key to connect.",
                default_base_url: Some("https://openrouter.ai/api/v1"),
            },
        ),
        (
            "deepseek",
            ProviderOverlay {
                label: "DeepSeek",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://platform.deepseek.com/api_keys"),
                detail: "DeepSeek API — enter your API key to connect.",
                default_base_url: Some("https://api.deepseek.com/v1"),
            },
        ),
        (
            "mistral",
            ProviderOverlay {
                label: "Mistral",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://console.mistral.ai/api-keys"),
                detail: "Mistral API — enter your API key to connect.",
                default_base_url: Some("https://api.mistral.ai/v1"),
            },
        ),
        (
            "xai",
            ProviderOverlay {
                label: "xAI (Grok)",
                credential_owner: "user",
                local_only: false,
                auth_method: "oauth",
                api_key_url: Some("https://console.x.ai"),
                detail: "Sign in with your xAI account through Oh My Pi, or connect with an API key.",
                default_base_url: Some("https://api.x.ai/v1"),
            },
        ),
        (
            "together",
            ProviderOverlay {
                label: "Together AI",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://api.together.ai/settings/api-keys"),
                detail: "Together AI API — enter your API key to connect.",
                default_base_url: Some("https://api.together.xyz/v1"),
            },
        ),
        (
            "fireworks",
            ProviderOverlay {
                label: "Fireworks AI",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://fireworks.ai/api-keys"),
                detail: "Fireworks AI API — enter your API key to connect.",
                default_base_url: Some("https://api.fireworks.ai/inference/v1"),
            },
        ),
        (
            "cerebras",
            ProviderOverlay {
                label: "Cerebras",
                credential_owner: "user",
                local_only: false,
                auth_method: "api_key",
                api_key_url: Some("https://cloud.cerebras.ai"),
                detail: "Cerebras API — enter your API key to connect.",
                default_base_url: Some("https://api.cerebras.ai/v1"),
            },
        ),
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

    // Synthetic local provider (not in the model catalog).
    specs.push(ProviderSpec {
        id: LOCAL_PROVIDER_ID.to_string(),
        label: "None".to_string(),
        credential_owner: "basebuild".to_string(),
        local_only: true,
        auth_method: "local".to_string(),
        api_key_url: None,
        detail: "No provider connected — select a provider to chat.".to_string(),
        default_base_url: None,
        local_kind: None,
    });

    // All providers from the bundled model catalog, overlaid with Basebuild
    // metadata where available. Providers without an overlay get generic
    // defaults derived from the catalog.
    for pid in model_catalog::provider_ids() {
        let overlay = overlay_for(pid);
        let models = model_catalog::models_for(pid);
        let first_base_url = models.first().map(|m| m.base_url.as_str());
        let label = overlay
            .map(|o| o.label.to_string())
            .unwrap_or_else(|| model_label(pid, pid));
        let auth_method = overlay
            .map(|o| o.auth_method.to_string())
            .unwrap_or_else(|| {
                // Providers whose models all use bespoke api kinds typically
                // require OAuth (delegated to OMP). Default others to api_key.
                let all_bespoke = models.iter().all(|m| is_bespoke_api_kind(&m.api_kind));
                if all_bespoke {
                    "oauth".to_string()
                } else {
                    "api_key".to_string()
                }
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
            local_kind: None,
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
        local_kind: None,
    });

    // Single catch-all "Local Models" provider — always present, even when no
    // local server is running. Detection aggregates every discovered local
    // model (LM Studio, Ollama, llama.cpp, KoboldCpp) under this one provider.
    let any_reachable = crate::services::local_llm_service::LocalLlmService::reachable_servers()
        .is_empty()
        .eq(&false);
    specs.push(ProviderSpec {
        id: LOCAL_MODELS_PROVIDER_ID.to_string(),
        label: "Local Models".to_string(),
        credential_owner: "basebuild".to_string(),
        local_only: false,
        auth_method: "local".to_string(),
        api_key_url: None,
        detail: if any_reachable {
            "Local LLM servers detected — models below run on your machine.".to_string()
        } else {
            "No local servers detected. Start LM Studio, Ollama, llama.cpp, or KoboldCpp and rescan.".to_string()
        },
        default_base_url: None,
        local_kind: Some("aggregate".to_string()),
    });

    specs
}

/// Human label for a detected local server kind.
fn local_server_label(kind: &str) -> String {
    use crate::services::local_llm_service::{
        KIND_KOBOLDCPP, KIND_LLAMACPP, KIND_LMSTUDIO, KIND_OLLAMA,
    };
    match kind {
        KIND_LMSTUDIO => "LM Studio",
        KIND_OLLAMA => "Ollama",
        KIND_LLAMACPP => "llama.cpp",
        KIND_KOBOLDCPP => "KoboldCpp",
        _ => "Local LLM",
    }
    .to_string()
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
    let models = model_catalog::models_for(provider_id);
    !models.is_empty() && models.iter().all(|m| is_bespoke_api_kind(&m.api_kind))
}

fn bundled_models(provider_id: &str) -> Vec<NativeModel> {
    match provider_id {
        LOCAL_PROVIDER_ID => vec![model_with_source(
            NativeModel {
                id: LOCAL_MODEL_ID.to_string(),
                provider_id: LOCAL_PROVIDER_ID.to_string(),
                label: "None".to_string(),
                supports_effort: true,
                supports_streaming: false,
                supports_tools: false,
                local_only: true,
                context_window: None,
                max_tokens: None,
                supports_reasoning: true,
                supported_efforts: effort_ids(),
                supports_images: false,
                supports_audio_input: false,
                supports_audio_output: false,
                voice: None,
                source: "bundled".to_string(),
                model_api_id: None,
                api_kind: String::new(),
                base_url: String::new(),
                cost_input: None,
                cost_output: None,
                detected_by: Vec::new(),
                running: false,
            },
            "bundled",
        )],
        "custom" => Vec::new(),
        _ => {
            let catalog_models = model_catalog::models_for(provider_id);
            catalog_models
                .into_iter()
                .map(|cm| bundled_from_catalog(provider_id, cm))
                .collect()
        }
    }
}

/// Build a `NativeModel` from a catalog entry, mapping catalog fields to
/// Basebuild's model schema. The `reasoning` flag drives effort support; the
/// `input` and `output` arrays drive image and audio support; the `voice`
/// block carries through verbatim; `api` becomes `api_kind`; `baseUrl`
/// becomes `base_url`; cost fields are carried through.
fn bundled_from_catalog(provider_id: &str, cm: &model_catalog::CatalogModel) -> NativeModel {
    let supports_reasoning = cm.reasoning;
    let supports_images = cm.input.iter().any(|m| m == "image");
    let supports_audio_input = cm.accepts_audio();
    let supports_audio_output = cm.emits_audio();
    let supported_efforts = if supports_reasoning {
        effort_ids()
    } else {
        Vec::new()
    };
    let cost_input = if cm.cost.input != 0.0 {
        Some(cm.cost.input)
    } else {
        None
    };
    let cost_output = if cm.cost.output != 0.0 {
        Some(cm.cost.output)
    } else {
        None
    };
    model_with_source(
        NativeModel {
            id: cm.id.clone(),
            provider_id: provider_id.to_string(),
            label: cm.name.clone(),
            supports_tools: crate::services::provider_client::transport_supports_tools_with_base(
                &cm.api_kind,
                &cm.base_url,
            ),
            supports_effort: supports_reasoning,
            supports_streaming: true,
            local_only: false,
            context_window: cm.context_window,
            max_tokens: cm.max_tokens,
            supports_reasoning,
            supported_efforts,
            supports_images,
            supports_audio_input,
            supports_audio_output,
            voice: cm.voice.clone(),
            source: "bundled".to_string(),
            model_api_id: None,
            api_kind: cm.api_kind.clone(),
            base_url: cm.base_url.clone(),
            cost_input,
            cost_output,
            detected_by: Vec::new(),
            running: false,
        },
        "bundled",
    )
}

/// The native (ChatGPT-subscription) `openai-codex` provider's models. The
/// catalog's `openai-codex` provider is the authoritative set — the real
/// Codex-backend model ids (`gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.6-luna`, …)
/// with the `openai-codex-responses` wire kind — so we reuse it rather than
/// re-labelling the OpenAI API catalog (which carries the wrong endpoint and
/// lists models the subscription backend never serves).
///
/// One override: the generic transport table marks `openai-codex-responses`
/// tool-incapable, but the native `OpenAiCodexClient` does carry tool schemas,
/// so force `supports_tools` on for this OAuth path.
fn native_codex_oauth_models() -> Vec<NativeModel> {
    bundled_models("openai-codex")
        .into_iter()
        .map(|mut model| {
            model.supports_tools = true;
            model
        })
        .collect()
}

/// Same authoritative `openai-codex` catalog set as
/// [`native_codex_oauth_models`], but routed through OMP's RPC bridge, which
/// currently exposes authenticated text generation only — tool calling stays
/// disabled (the catalog already marks `openai-codex-responses` tool-incapable).
fn omp_codex_oauth_models() -> Vec<NativeModel> {
    bundled_models("openai-codex")
        .into_iter()
        .map(|mut model| {
            model.supports_tools = false;
            model
        })
        .collect()
}

fn model_with_source(mut model: NativeModel, source: &str) -> NativeModel {
    model.source = source.to_string();
    if model.detected_by.is_empty() {
        model.detected_by = vec![source.to_string()];
    }
    model
}

/// Merge model lists from several catalog sources into one deduplicated list.
/// The first source that carries a given model id provides the canonical
/// record — so richer static metadata (api_kind, base_url, cost, model_api_id)
/// wins over a bare live listing — while every source that lists the id adds
/// its label to `detected_by`. Input order therefore sets both record
/// precedence and the `source` field; the caller passes static sources
/// (catalog_sync, bundled) before live ones (provider_discovered, omp_cli).
fn merge_model_sources(sources: Vec<(&str, Vec<NativeModel>)>) -> Vec<NativeModel> {
    let mut order: Vec<String> = Vec::new();
    let mut merged: std::collections::HashMap<String, NativeModel> =
        std::collections::HashMap::new();
    for (label, models) in sources {
        for mut model in models {
            if let Some(existing) = merged.get_mut(&model.id) {
                if !existing.detected_by.iter().any(|s| s == label) {
                    existing.detected_by.push(label.to_string());
                }
            } else {
                let key = model.id.clone();
                model.source = label.to_string();
                model.detected_by = vec![label.to_string()];
                order.push(key.clone());
                merged.insert(key, model);
            }
        }
    }
    let mut out: Vec<NativeModel> = order
        .into_iter()
        .filter_map(|key| merged.remove(&key))
        .collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

fn effort_levels() -> Vec<NativeEffortLevel> {
    vec![
        NativeEffortLevel {
            id: "low".to_string(),
            label: "Low".to_string(),
            description: "Fast, shallow planning.".to_string(),
        },
        NativeEffortLevel {
            id: "medium".to_string(),
            label: "Medium".to_string(),
            description: "Balanced reliability and speed.".to_string(),
        },
        NativeEffortLevel {
            id: "high".to_string(),
            label: "High".to_string(),
            description: "Deeper reasoning for implementation planning.".to_string(),
        },
        NativeEffortLevel {
            id: "xhigh".to_string(),
            label: "XHigh".to_string(),
            description: "Maximum local planning budget before provider-backed execution."
                .to_string(),
        },
    ]
}

fn effort_ids() -> Vec<String> {
    effort_levels().into_iter().map(|e| e.id).collect()
}

fn model_label(provider_id: &str, id: &str) -> String {
    match provider_id {
        "openai" if id.starts_with("gpt-") => id.replace('-', " ").replace("gpt", "GPT"),
        "anthropic" if id.starts_with("claude-") => {
            id.replace('-', " ").replace("claude", "Claude")
        }
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
        "openai" => ["gpt-5", "o1", "o3", "o4", "codex"]
            .iter()
            .any(|prefix| id == *prefix || id.starts_with(&format!("{prefix}-"))),
        "anthropic" => {
            id.starts_with("claude-")
                || id.contains("sonnet")
                || id.contains("opus")
                || id.contains("haiku")
        }
        "google" => id.contains("pro") || id.contains("thinking") || id.contains("2.5"),
        _ => {
            id.contains("reason")
                || id.contains("glm")
                || id.contains("thinking")
                || id.contains("pro")
        }
    }
}

fn supports_images(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id.contains("gpt-4")
        || id.contains("gpt-5")
        || id.contains("vision")
        || id.contains("omni")
        || id.contains("claude")
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
    fn omp_codex_oauth_models_from_catalog_without_tools() {
        let models = omp_codex_oauth_models();
        let catalog = bundled_models("openai-codex");
        assert_eq!(models.len(), catalog.len());
        assert!(models.len() > 1);
        assert!(models.iter().all(|m| m.provider_id == "openai-codex"));
        assert!(models.iter().all(|m| !m.supports_tools));
        // Real Codex-backend catalog ids (the openai-codex provider's set),
        // not the OpenAI API catalog. Ids overlap between the two providers,
        // so the api_kind check below is the real discriminator.
        assert!(models.iter().any(|m| m.id == "gpt-5.6-luna"));
        assert!(models
            .iter()
            .all(|m| m.api_kind == "openai-codex-responses"));
    }

    #[test]
    fn native_codex_oauth_models_from_catalog_force_tool_support() {
        let models = native_codex_oauth_models();
        let catalog = bundled_models("openai-codex");
        assert_eq!(models.len(), catalog.len());
        assert!(models.len() > 1);
        assert!(models.iter().all(|m| m.provider_id == "openai-codex"));
        assert!(models.iter().any(|m| m.id == "gpt-5.6-luna"));
        // The native OpenAiCodexClient carries tool schemas, so every model is
        // tool-capable even though the catalog wire kind is marked otherwise.
        assert!(models.iter().all(|m| m.supports_tools));
        // Uses the authoritative openai-codex catalog, not the OpenAI API set.
        assert!(models
            .iter()
            .all(|m| m.api_kind == "openai-codex-responses"));
    }

    #[test]
    fn merge_model_sources_unions_detection_and_keeps_first_record() {
        let mk = |id: &str, label: &str, api_kind: &str| NativeModel {
            id: id.to_string(),
            provider_id: "p".to_string(),
            label: label.to_string(),
            supports_effort: false,
            supports_streaming: true,
            supports_tools: true,
            local_only: false,
            context_window: None,
            max_tokens: None,
            supports_reasoning: false,
            supported_efforts: Vec::new(),
            supports_images: false,
            supports_audio_input: false,
            supports_audio_output: false,
            voice: None,
            source: String::new(),
            model_api_id: None,
            api_kind: api_kind.to_string(),
            base_url: String::new(),
            cost_input: None,
            cost_output: None,
            detected_by: Vec::new(),
            running: false,
        };
        let merged = merge_model_sources(vec![
            (
                "catalog_sync",
                vec![mk("a", "Alpha", "openai-responses"), mk("b", "Beta", "")],
            ),
            (
                "bundled",
                vec![mk("a", "Alpha", "bundled-kind"), mk("c", "Cee", "")],
            ),
            (
                "provider_discovered",
                vec![mk("a", "Alpha", "live-kind"), mk("c", "Cee", "")],
            ),
        ]);

        // Deduped by id: a, b, c.
        assert_eq!(merged.len(), 3);
        let a = merged.iter().find(|m| m.id == "a").unwrap();
        // First source (catalog_sync) provides the canonical record + source,
        // so richer static metadata wins over the bare live listing.
        assert_eq!(a.source, "catalog_sync");
        assert_eq!(a.api_kind, "openai-responses");
        // Detection unions every source that listed the id, in encounter order.
        assert_eq!(
            a.detected_by,
            vec!["catalog_sync", "bundled", "provider_discovered"]
        );
        let b = merged.iter().find(|m| m.id == "b").unwrap();
        assert_eq!(b.detected_by, vec!["catalog_sync"]);
        let c = merged.iter().find(|m| m.id == "c").unwrap();
        assert_eq!(c.source, "bundled");
        assert_eq!(c.detected_by, vec!["bundled", "provider_discovered"]);
        // Output is sorted by label.
        let labels: Vec<&str> = merged.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(labels, vec!["Alpha", "Beta", "Cee"]);
    }

    #[test]
    fn credential_auth_source_classifies_base_url_sentinels() {
        assert_eq!(credential_auth_source(Some(NATIVE_CODEX_BASE_URL)), "oauth");
        assert_eq!(credential_auth_source(Some("omp://anthropic")), "omp");
        assert_eq!(credential_auth_source(Some(OMP_CODEX_BASE_URL)), "omp");
        assert_eq!(
            credential_auth_source(Some("https://api.example.com/v1")),
            "api"
        );
        assert_eq!(credential_auth_source(None), "api");
    }

    #[test]
    fn bundled_devin_models_match_catalog() {
        // The bundled devin models should come from the model catalog and
        // include swe-1-6 and glm-5-2 (the stale `devin-2.0` row is gone).
        // The bundled catalog can refresh from basebuild.net, so assert a
        // floor, never an exact count.
        let models = bundled_models("devin");
        assert!(models.len() >= 48, "devin should have >= 48 bundled models");
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
    fn bundled_bespoke_models_with_base_url_have_supports_tools() {
        // Bespoke api_kinds (devin-agent, cursor-agent, etc.) route through
        // OmpRpcClient when they have no base_url — but when the catalog
        // provides a direct base_url (e.g. Devin's server.codeium.com),
        // they route through OpenAiCompatibleClient which supports tools.
        let devin = bundled_models("devin");
        assert!(
            devin.iter().all(|m| m.supports_tools),
            "all devin (devin-agent) models with base_url should have supports_tools=true"
        );
    }

    #[test]
    fn bundled_models_have_catalog_version_stamp() {
        // Bundled models should carry the current catalog version for
        // stamp-mismatch detection. This is tested via replace_provider_cache
        // writing the stamp; here we verify the version is non-empty.
        assert!(
            !model_catalog::CATALOG_VERSION.trim().is_empty(),
            "catalog version should be stamped"
        );
    }

    #[test]
    fn is_bespoke_provider_detects_devin() {
        // Devin uses devin-agent (bespoke), not openai-completions.
        assert!(is_bespoke_provider("devin"), "devin should be bespoke");
        // OpenAI uses openai-completions (native).
        assert!(
            !is_bespoke_provider("openai"),
            "openai should not be bespoke"
        );
        // Anthropic uses anthropic-messages (native).
        assert!(
            !is_bespoke_provider("anthropic"),
            "anthropic should not be bespoke"
        );
    }

    #[test]
    fn provider_specs_includes_all_catalog_providers() {
        let specs = provider_specs();
        let spec_ids: Vec<&str> = specs.iter().map(|s| s.id.as_str()).collect();
        // Should include all catalog providers plus local and custom.
        for pid in model_catalog::provider_ids() {
            assert!(
                spec_ids.contains(&pid),
                "provider {pid} from catalog should be in provider_specs"
            );
        }
        assert!(
            spec_ids.contains(&"basebuild-local"),
            "local provider should be present"
        );
        assert!(
            spec_ids.contains(&"custom"),
            "custom provider should be present"
        );
    }

    #[test]
    fn refresh_bespoke_provider_returns_bundled_not_error() {
        // The refresh path for bespoke providers (devin without OMP) should
        // return Ok(bundled) not Err. We verify the bundled models are
        // non-empty and have the correct source.
        let models = bundled_models("devin");
        assert!(
            !models.is_empty(),
            "bundled devin models should be non-empty"
        );
        assert!(
            models.iter().all(|m| m.source == "bundled"),
            "all bundled devin models should have source=bundled"
        );
    }

    #[test]
    fn transport_unavailable_for_bespoke_no_base_url() {
        // Devin models all have api_kind=devin-agent (bespoke) and come with
        // a base_url from the catalog, so they should NOT be transport_unavailable.
        let devin = bundled_models("devin");
        assert!(!devin.is_empty(), "devin should have bundled models");
        let all_bespoke = devin.iter().all(|m| is_bespoke_api_kind(&m.api_kind));
        let has_base_url = devin.iter().any(|m| !m.base_url.is_empty());
        assert!(all_bespoke, "devin should be all bespoke");
        assert!(
            has_base_url,
            "devin models should have base_url from catalog"
        );
        assert!(
            !(all_bespoke && !has_base_url),
            "devin with base_url should not be transport_unavailable"
        );
    }

    #[test]
    fn transport_unavailable_logic_bespoke_without_base_url() {
        // Simulate a bespoke model with no base_url → transport_unavailable.
        let models = vec![NativeModel {
            id: "test-bespoke".to_string(),
            provider_id: "test-provider".to_string(),
            label: "Test Bespoke".to_string(),
            supports_tools: false,
            supports_effort: false,
            supports_streaming: true,
            local_only: false,
            context_window: None,
            max_tokens: None,
            supports_reasoning: false,
            supported_efforts: vec![],
            supports_images: false,
            supports_audio_input: false,
            supports_audio_output: false,
            voice: None,
            source: "bundled".to_string(),
            model_api_id: None,
            api_kind: "devin-agent".to_string(),
            base_url: String::new(),
            cost_input: None,
            cost_output: None,
            detected_by: Vec::new(),
            running: false,
        }];
        let all_bespoke = models.iter().all(|m| is_bespoke_api_kind(&m.api_kind));
        let has_base_url = models.iter().any(|m| !m.base_url.is_empty());
        assert!(all_bespoke, "bespoke model should be detected as bespoke");
        assert!(
            !has_base_url,
            "model without base_url should have no base_url"
        );
        assert!(
            all_bespoke && !has_base_url,
            "bespoke without base_url should be transport_unavailable"
        );
    }

    #[test]
    fn transport_unavailable_flips_when_base_url_added() {
        // Same bespoke model but with a base_url → transport available.
        let models = vec![NativeModel {
            id: "test-bespoke-base".to_string(),
            provider_id: "test-provider".to_string(),
            label: "Test Bespoke With Base".to_string(),
            supports_tools: true,
            supports_effort: false,
            supports_streaming: true,
            local_only: false,
            context_window: None,
            max_tokens: None,
            supports_reasoning: false,
            supported_efforts: vec![],
            supports_images: false,
            supports_audio_input: false,
            supports_audio_output: false,
            voice: None,
            source: "bundled".to_string(),
            model_api_id: None,
            api_kind: "devin-agent".to_string(),
            base_url: "https://custom.api.com/v1".to_string(),
            cost_input: None,
            cost_output: None,
            detected_by: Vec::new(),
            running: false,
        }];
        let all_bespoke = models.iter().all(|m| is_bespoke_api_kind(&m.api_kind));
        let has_base_url = models.iter().any(|m| !m.base_url.is_empty());
        assert!(all_bespoke, "still bespoke api_kind");
        assert!(has_base_url, "now has base_url");
        assert!(
            !(all_bespoke && !has_base_url),
            "bespoke with base_url should NOT be transport_unavailable"
        );
    }

    #[test]
    fn native_provider_not_transport_unavailable() {
        // Native api_kinds are not bespoke → never transport_unavailable.
        assert!(
            !is_bespoke_api_kind("openai-completions"),
            "openai-completions is not bespoke"
        );
        assert!(
            !is_bespoke_api_kind("anthropic-messages"),
            "anthropic-messages is not bespoke"
        );
        assert!(
            is_bespoke_api_kind(""),
            "empty api_kind is bespoke (not in native list)"
        );
        // Bespoke kinds.
        assert!(is_bespoke_api_kind("devin-agent"), "devin-agent is bespoke");
        assert!(
            is_bespoke_api_kind("cursor-agent"),
            "cursor-agent is bespoke"
        );
    }

    #[test]
    fn cached_catalog_is_startup_safe_and_reused() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        ProviderModelCatalogService::invalidate();

        let started = std::time::Instant::now();
        let first = ProviderModelCatalogService::catalog();
        let first_elapsed = started.elapsed();
        assert!(!first.providers.is_empty());
        assert!(!first.models.is_empty());
        assert!(
            first_elapsed < Duration::from_secs(5),
            "cached startup catalog took {first_elapsed:?}"
        );

        let started = std::time::Instant::now();
        let second = ProviderModelCatalogService::catalog();
        let second_elapsed = started.elapsed();
        assert_eq!(second.fetched_at, first.fetched_at);
        assert_eq!(second.models.len(), first.models.len());
        assert!(
            second_elapsed < Duration::from_secs(1),
            "in-process catalog reuse took {second_elapsed:?}"
        );
    }

    /// Minimal cacheable `NativeModel` for the voice round-trip tests: no
    /// capabilities, no voice, just enough identity to survive a write and a
    /// read. Individual tests override only the fields under test.
    fn voice_test_model(id: &str) -> NativeModel {
        NativeModel {
            id: id.to_string(),
            provider_id: "voice-test".to_string(),
            label: id.to_string(),
            supports_effort: false,
            supports_streaming: true,
            supports_tools: false,
            local_only: false,
            context_window: None,
            max_tokens: None,
            supports_reasoning: false,
            supported_efforts: Vec::new(),
            supports_images: false,
            supports_audio_input: false,
            supports_audio_output: false,
            voice: None,
            source: "bundled".to_string(),
            model_api_id: None,
            api_kind: "openai-responses".to_string(),
            base_url: String::new(),
            cost_input: None,
            cost_output: None,
            detected_by: Vec::new(),
            running: false,
        }
    }

    #[test]
    fn cache_round_trip_preserves_full_voice_detail() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);

        let model = NativeModel {
            supports_audio_input: true,
            supports_audio_output: true,
            voice: Some(model_catalog::CatalogVoice {
                level: model_catalog::VoiceLevel::Realtime,
                billing: Some(model_catalog::VoiceBilling::ApiKey),
                transports: vec!["webrtc".to_string(), "websocket".to_string()],
                turn_detection: vec!["server_vad".to_string()],
                barge_in: true,
                voices: vec!["marin".to_string(), "cedar".to_string()],
                sample_rate_in: Some(24_000),
                sample_rate_out: Some(24_000),
            }),
            ..voice_test_model("gpt-realtime-2.1")
        };
        ProviderModelCatalogService::replace_provider_cache(
            "voice-test",
            vec![model],
            "bundled",
            None,
        )
        .unwrap();

        let cached = ProviderModelCatalogService::cached_models().unwrap();
        let read = cached
            .iter()
            .find(|item| item.model.id == "gpt-realtime-2.1")
            .expect("realtime row round-trips through the cache");
        assert!(read.model.supports_audio_input);
        assert!(read.model.supports_audio_output);

        // The enum variants are the point: a route that survives as a bare
        // boolean cannot tell a duplex session from an audio attachment, and
        // cannot tell a metered API key from a subscription.
        let voice = read.model.voice.as_ref().expect("voice detail survives");
        assert_eq!(voice.level, model_catalog::VoiceLevel::Realtime);
        assert_eq!(voice.billing, Some(model_catalog::VoiceBilling::ApiKey));
        assert_eq!(voice.transports, vec!["webrtc", "websocket"]);
        assert_eq!(voice.turn_detection, vec!["server_vad"]);
        assert!(voice.barge_in);
        assert_eq!(voice.voices, vec!["marin", "cedar"]);
        assert_eq!(voice.sample_rate_in, Some(24_000));
        assert_eq!(voice.sample_rate_out, Some(24_000));
    }

    #[test]
    fn corrupt_voice_json_degrades_to_no_voice_without_failing_the_read() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);

        ProviderModelCatalogService::replace_provider_cache(
            "voice-test",
            vec![
                NativeModel {
                    supports_audio_input: true,
                    ..voice_test_model("corrupt-voice")
                },
                voice_test_model("healthy-neighbour"),
            ],
            "bundled",
            None,
        )
        .unwrap();
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "UPDATE native_provider_model_cache SET voice_json = ?1
             WHERE provider_id = 'voice-test' AND model_id = 'corrupt-voice'",
            params!["{\"level\": not-json"],
        )
        .unwrap();

        let cached = ProviderModelCatalogService::cached_models().unwrap();
        let corrupt = cached
            .iter()
            .find(|item| item.model.id == "corrupt-voice")
            .expect("corrupt row still reads back");
        assert!(
            corrupt.model.voice.is_none(),
            "a malformed voice blob degrades to no-voice"
        );
        // The rest of the row, and every other row, is untouched by the bad
        // blob: one bad cache entry must not blank the model picker.
        assert!(corrupt.model.supports_audio_input);
        assert_eq!(corrupt.model.label, "corrupt-voice");
        assert!(cached
            .iter()
            .any(|item| item.model.id == "healthy-neighbour"));
    }

    #[test]
    fn model_without_voice_round_trips_as_silent() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);

        ProviderModelCatalogService::replace_provider_cache(
            "voice-test",
            vec![voice_test_model("text-only")],
            "bundled",
            None,
        )
        .unwrap();

        let cached = ProviderModelCatalogService::cached_models().unwrap();
        let read = cached
            .iter()
            .find(|item| item.model.id == "text-only")
            .expect("text-only row round-trips through the cache");
        assert!(!read.model.supports_audio_input);
        assert!(!read.model.supports_audio_output);
        assert!(read.model.voice.is_none());
    }
}

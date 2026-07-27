use parking_lot::{Mutex, RwLock};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::{env, sync::Arc};
use tauri::{AppHandle, Emitter};

use crate::{
    events::NATIVE_CHAT_CHUNK,
    models::{
        model_catalog,
        native_chat::{
            ChatModelDefault, NativeChatBootstrap, NativeChatHistoryEntry, NativeChatMessage,
            NativeChatSendRequest, NativeChatSendResult, NativeChatSession, NativeChatStartRequest,
            NativeChatSteerResult, NativeGenerateIdeasRequest, NativeGenerateIdeasResult,
            NativeGeneratedIdea, NativeProviderCatalog, NativeProviderCredential,
            NativeProviderCredentialInput, NativeRequestMetric, NativeRequestMetricsSummary,
            NativeSetupRequired, NativeToolApprovalRequest, NativeToolApprovalResult,
            NativeToolEvent, ResolvedChatModelDefault,
        },
        permission::PermissionDecision,
        plan::Plan,
    },
    services::{
        agent_loop_service::{ToolEventRecord, TurnSegment},
        provider_client::{resolve_client_for_model, ChatMsg, ProviderRequest},
        session_service::SessionService,
        settings_service::SettingsService,
        storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

const NATIVE_PROFILE_ID: &str = "basebuild-native";
const LOCAL_PROVIDER_ID: &str = "basebuild-local";

#[derive(Debug, Default)]
pub struct NativeChatService;

impl NativeChatService {
    pub fn provider_catalog() -> NativeProviderCatalog {
        crate::services::provider_model_catalog_service::ProviderModelCatalogService::catalog()
    }

    /// Check whether a model supports tool calling.
    fn model_supports_tools(provider_id: &str, model_id: &str) -> bool {
        let catalog = Self::provider_catalog();
        catalog
            .models
            .iter()
            .any(|m| m.provider_id == provider_id && m.id == model_id && m.supports_tools)
    }
    // ─── Chat Model Defaults ───

    /// Get the persisted chat model default for a project, or None if no
    /// per-project default has been set.
    pub fn get_project_model_default(project_path: &str) -> DbResult<Option<ChatModelDefault>> {
        let conn = StorageService::connect()?;
        let row = conn
            .query_row(
                "SELECT provider_id, model_id, effort_level FROM chat_model_defaults WHERE project_path = ?1",
                params![project_path],
                |r| {
                    Ok(ChatModelDefault {
                        provider_id: r.get(0)?,
                        model_id: r.get(1)?,
                        effort_level: r.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }

    /// Persist (or update) the chat model default for a project. Called when
    /// the user manually selects a model in the composer.
    pub fn set_project_model_default(
        project_path: &str,
        default: &ChatModelDefault,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO chat_model_defaults (project_path, provider_id, model_id, effort_level, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(project_path) DO UPDATE SET
               provider_id = excluded.provider_id, model_id = excluded.model_id,
               effort_level = excluded.effort_level, updated_at = excluded.updated_at",
            params![
                project_path,
                default.provider_id,
                default.model_id,
                default.effort_level,
                now_seconds(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Get the global chat model default stored in `app_defaults` under
    /// `chat.defaultModel`. Returns None if unset.
    pub fn get_global_model_default() -> DbResult<Option<ChatModelDefault>> {
        let conn = StorageService::connect()?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_defaults WHERE key = 'chat.defaultModel'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        match value {
            Some(v) => {
                let d: ChatModelDefault = serde_json::from_str(&v).map_err(|e| e.to_string())?;
                Ok(Some(d))
            }
            None => Ok(None),
        }
    }

    /// Persist the global chat model default.
    pub fn set_global_model_default(default: &ChatModelDefault) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let value = serde_json::to_string(default).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_defaults (key, value) VALUES ('chat.defaultModel', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Resolve the chat model default for a project, falling back through:
    /// project default → global default → first connected provider's default
    /// model. Returns a notice when the stored default was unavailable.
    pub fn resolve_model_default(project_path: &str) -> DbResult<ResolvedChatModelDefault> {
        let catalog = Self::provider_catalog();
        Self::resolve_model_default_from_catalog(project_path, &catalog)
    }

    /// Resolve cache-first startup metadata from one catalog snapshot. This
    /// avoids reading OMP credentials and cached models once for the catalog
    /// and again for the effective project default.
    pub fn bootstrap(project_path: &str) -> DbResult<NativeChatBootstrap> {
        // Probe loopback for local LLM servers once per process so a running
        // LM Studio/Ollama surfaces on first chat open without an explicit
        // refresh.
        crate::services::provider_model_catalog_service::ProviderModelCatalogService::ensure_local_servers();
        let catalog = Self::provider_catalog();
        let resolved = Self::resolve_model_default_from_catalog(project_path, &catalog)?;
        Ok(NativeChatBootstrap { catalog, resolved })
    }

    fn resolve_model_default_from_catalog(
        project_path: &str,
        catalog: &NativeProviderCatalog,
    ) -> DbResult<ResolvedChatModelDefault> {
        // 1. Per-project default.
        if let Some(project_default) = Self::get_project_model_default(project_path)? {
            if let Some(resolved) = Self::try_resolve(catalog, &project_default, "project") {
                return Ok(resolved);
            }
            // Stored project default is unavailable — fall through with a notice.
            let fallback = Self::first_connected_default(catalog);
            let notice = format!(
                "Project default provider '{}' or model '{}' is unavailable; using {}.",
                project_default.provider_id, project_default.model_id, fallback.provider_id
            );
            return Ok(ResolvedChatModelDefault {
                provider_id: fallback.provider_id,
                model_id: fallback.model_id,
                effort_level: fallback.effort_level,
                source: "fallback".to_string(),
                notice: Some(notice),
            });
        }

        // 2. Global default.
        if let Some(global_default) = Self::get_global_model_default()? {
            if let Some(resolved) = Self::try_resolve(catalog, &global_default, "global") {
                return Ok(resolved);
            }
        }

        // 3. First connected provider's default model.
        let fallback = Self::first_connected_default(catalog);
        Ok(ResolvedChatModelDefault {
            provider_id: fallback.provider_id,
            model_id: fallback.model_id,
            effort_level: fallback.effort_level,
            source: "fallback".to_string(),
            notice: None,
        })
    }

    /// Check whether a stored default's provider is connected and model is in
    /// the catalog. Returns `Some(resolved)` if available, `None` if not.
    /// Clamps the effort level to the model's supported efforts.
    fn try_resolve(
        catalog: &NativeProviderCatalog,
        default: &ChatModelDefault,
        source: &str,
    ) -> Option<ResolvedChatModelDefault> {
        let provider = catalog
            .providers
            .iter()
            .find(|p| p.id == default.provider_id)?;
        if !provider.configured {
            return None;
        }
        let model = catalog
            .models
            .iter()
            .find(|m| m.id == default.model_id && m.provider_id == default.provider_id)?;
        // Clamp effort to a supported level. If the stored effort is
        // unsupported, pick the nearest supported level (preferring the
        // model's first supported effort as the default).
        let clamped_effort = if model.supported_efforts.is_empty() {
            default.effort_level.clone()
        } else if model
            .supported_efforts
            .iter()
            .any(|e| e == &default.effort_level)
        {
            default.effort_level.clone()
        } else {
            // Stored effort is unsupported — clamp to the first supported.
            model.supported_efforts[0].clone()
        };
        Some(ResolvedChatModelDefault {
            provider_id: default.provider_id.clone(),
            model_id: default.model_id.clone(),
            effort_level: clamped_effort,
            source: source.to_string(),
            notice: None,
        })
    }

    /// Pick the first connected provider's default model as a last resort.
    /// Prefers a real (non-local) connected provider — the local coordinator
    /// is always "configured" but produces canned offline responses, so it
    /// should only be the fallback when no real provider is connected.
    /// Uses the provider's first available model rather than the catalog's
    /// default_model_id (which is always the local coordinator).
    fn first_connected_default(catalog: &NativeProviderCatalog) -> ChatModelDefault {
        let provider = catalog
            .providers
            .iter()
            .find(|p| p.configured && !p.local_only)
            .or_else(|| catalog.providers.iter().find(|p| p.configured))
            .cloned()
            .unwrap_or_else(|| catalog.providers[0].clone());
        // Find the first model belonging to the chosen provider. Falls back
        // to the catalog default (local coordinator) if none found.
        let model_id = catalog
            .models
            .iter()
            .find(|m| m.provider_id == provider.id)
            .map(|m| m.id.clone())
            .unwrap_or_else(|| catalog.default_model_id.clone());
        ChatModelDefault {
            provider_id: provider.id,
            model_id,
            effort_level: catalog.default_effort_level.clone(),
        }
    }
    pub fn save_credential(
        input: NativeProviderCredentialInput,
    ) -> DbResult<NativeProviderCredential> {
        use crate::services::provider_account_service::{
            api_key_identity, masked_key_label, ProviderAccountService, AUTH_API, AUTH_OAUTH,
        };
        ProviderAccountService::ensure_migrated();
        let auth_method = if input.base_url.as_deref()
            == Some(crate::services::provider_client::NATIVE_CODEX_BASE_URL)
        {
            AUTH_OAUTH
        } else {
            AUTH_API
        };
        // Identity dedupes re-logins to the same upstream account: OAuth uses
        // the ChatGPT account id claim, API keys hash the key bytes.
        let (identity_key, account_label) = if auth_method == AUTH_OAUTH {
            let identity = crate::services::provider_client::codex_account_identity(&input.api_key)
                .unwrap_or_else(|| format!("legacy:{}", input.provider_id));
            (identity, input.label.clone())
        } else {
            (
                api_key_identity(&input.api_key),
                masked_key_label(&input.api_key),
            )
        };
        let (record, _updated) = ProviderAccountService::upsert_account(
            &input.provider_id,
            &account_label,
            auth_method,
            &input.api_key,
            input.base_url.as_deref(),
            &identity_key,
        )?;
        let conn = StorageService::connect()?;
        // Keep the legacy single-row table mirroring the newest account
        // (compat/rollback window for pre-multi-account builds).
        ProviderAccountService::sync_legacy_row(&conn, &input.provider_id)?;
        // Remove any block so OMP-imported credentials can flow again after reconnect.
        conn.execute(
            "DELETE FROM native_blocked_providers WHERE provider_id = ?1",
            params![&input.provider_id],
        )
        .map_err(|e| e.to_string())?;
        let _ = crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(&input.provider_id, true);
        Ok(NativeProviderCredential {
            provider_id: record.provider_id,
            label: input.label,
            api_key: record.api_key,
            base_url: record.base_url,
            updated_at: record.updated_at,
        })
    }

    pub(crate) fn unblock_provider(provider_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM native_blocked_providers WHERE provider_id = ?1",
            params![provider_id],
        )
        .map_err(|error| format!("Failed to reconnect provider: {error}"))?;
        Ok(())
    }

    pub fn list_credentials() -> DbResult<Vec<NativeProviderCredential>> {
        use crate::services::provider_account_service::ProviderAccountService;
        ProviderAccountService::ensure_migrated();
        let conn = StorageService::connect()?;

        // Load the set of providers the user has explicitly disconnected.
        // This blocks OMP-imported credentials from re-appearing after disconnect.
        let blocked: Vec<String> = conn
            .prepare("SELECT provider_id FROM native_blocked_providers")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        // One credential per provider: the newest stored account. Accounts are
        // explicit user state, so the blocked list does not apply to them.
        let mut creds: Vec<NativeProviderCredential> = Vec::new();
        for record in ProviderAccountService::list_records(None)? {
            match creds
                .iter_mut()
                .find(|c| c.provider_id == record.provider_id)
            {
                Some(existing) if existing.updated_at >= record.updated_at => {}
                Some(existing) => {
                    existing.label = record.label;
                    existing.api_key = record.api_key;
                    existing.base_url = record.base_url;
                    existing.updated_at = record.updated_at;
                }
                None => creds.push(NativeProviderCredential {
                    provider_id: record.provider_id,
                    label: record.label,
                    api_key: record.api_key,
                    base_url: record.base_url,
                    updated_at: record.updated_at,
                }),
            }
        }

        // Dual-read safety net: a legacy row for a provider without account
        // rows (partial migration) still works, honoring pre-upgrade blocks.
        let mut stmt = conn
            .prepare("SELECT provider_id, label, api_key, base_url, updated_at FROM native_provider_credentials ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let legacy = stmt
            .query_map([], |row| {
                Ok(NativeProviderCredential {
                    provider_id: row.get(0)?,
                    label: row.get(1)?,
                    api_key: row.get(2)?,
                    base_url: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok());
        for row in legacy {
            if blocked.contains(&row.provider_id)
                || creds.iter().any(|c| c.provider_id == row.provider_id)
            {
                continue;
            }
            creds.push(row);
        }

        // Merge credentials from the active OMP (Oh My Pi) profile so providers
        // authenticated there are usable without re-entering a secret here.
        // A Basebuild-saved credential remains the explicit override.
        let mut omp_seen = Vec::new();
        for omp in Self::omp_credentials() {
            if blocked.contains(&omp.provider_id) || omp_seen.contains(&omp.provider_id) {
                continue;
            }
            omp_seen.push(omp.provider_id.clone());
            if !creds.iter().any(|c| c.provider_id == omp.provider_id) {
                creds.push(omp);
            }
        }
        Ok(creds)
    }

    /// Reconcile the single `local-models` account with the latest scan. When at
    /// least one local server is reachable, a keyless account (`api_key =
    /// "local"`, no base URL — chat routes per-model) exists so the send path's
    /// account lookup succeeds; when every server is gone the account is
    /// removed. Cached models stay intact — the catalog shows them regardless.
    /// Also cleans up legacy per-server `local-*` accounts from earlier builds.
    pub fn sync_local_accounts(
        servers: &[crate::services::local_llm_service::DetectedLocalServer],
    ) -> DbResult<()> {
        use crate::services::provider_account_service::{ProviderAccountService, AUTH_API};
        ProviderAccountService::ensure_migrated();
        let any_reachable = servers.iter().any(|s| s.reachable);
        if any_reachable {
            ProviderAccountService::upsert_account(
                "local-models",
                "Local Models",
                AUTH_API,
                "local",
                None,
                "local",
            )?;
        }
        // Remove the account when nothing is reachable, plus any legacy
        // per-server local accounts (`local-lmstudio`, …) from older builds.
        for record in ProviderAccountService::list_records(None)? {
            let is_local = record.provider_id.starts_with("local-");
            let keep = record.provider_id == "local-models" && any_reachable;
            if is_local && !keep {
                ProviderAccountService::remove_account(&record.id)?;
            }
        }
        Ok(())
    }

    /// Return provider ids with request-usable credentials. OMP OAuth rows are
    /// resolved through the same active-profile/token path used by chat sends,
    /// so the catalog cannot claim a provider is ready when requests cannot
    /// obtain a credential.
    pub fn configured_provider_ids() -> DbResult<std::collections::HashSet<String>> {
        Ok(Self::list_credentials()?
            .into_iter()
            .map(|credential| credential.provider_id)
            .collect())
    }

    /// Read credentials from the OMP agent database (`<agent_dir>/agent.db` →
    /// `auth_credentials`). The agent dir is the active OMP profile's, resolved
    /// via `omp config path` (handles per-profile DBs); falls back to
    /// `~/.omp/agent` when omp isn't on PATH. Opened read-only so we never
    /// contend with OMP's own writes.
    ///
    /// `api_key` rows are read directly from the db (fast, no expiry). `oauth`
    /// rows are resolved via `omp token <provider>` which refreshes expired
    /// tokens internally; results are cached for 5 min to avoid per-send CLI
    /// spawns. OMP provider ids map directly to Basebuild catalog ids.
    fn omp_credentials() -> Vec<NativeProviderCredential> {
        Self::omp_credentials_from(&omp_agent_dir().join("agent.db"), false)
    }

    /// Provider ids with an active OMP credential (one pass over the OMP db).
    pub(crate) fn omp_provider_ids() -> Vec<String> {
        Self::omp_credentials()
            .into_iter()
            .map(|credential| credential.provider_id)
            .collect()
    }

    /// The active OMP credential for one provider, if any. Used by the
    /// account service to surface OMP logins as virtual accounts.
    pub(crate) fn omp_credential_for(provider_id: &str) -> Option<NativeProviderCredential> {
        Self::omp_credentials()
            .into_iter()
            .find(|credential| credential.provider_id == provider_id)
    }

    /// Invalidate OMP profile and OAuth caches before an explicit auth refresh.
    /// This makes an external `omp login` visible without restarting Basebuild.
    pub(crate) fn refresh_omp_credential_cache() {
        *OMP_AGENT_DIR.write() = None;
        if let Ok(mut cache) = OAUTH_TOKEN_CACHE.lock() {
            cache.clear();
        }
    }

    /// Return the active OMP key for a provider as a transport fallback.
    /// Resolves the live OAuth token lazily (only for the requested provider),
    /// so routine enumeration never spawns `omp token`.
    pub(crate) fn omp_api_key(provider_id: &str) -> Option<String> {
        let credential = Self::omp_credentials()
            .into_iter()
            .find(|credential| credential.provider_id == provider_id)?;
        match credential.base_url.as_deref() {
            // OAuth OMP credential: the enumeration placeholder is not a real
            // token; fetch it live now (cached 5 min in omp_oauth_token).
            Some(url) if url.starts_with("omp://") => omp_oauth_token(&credential.label),
            _ => Some(credential.api_key),
        }
    }

    fn omp_credentials_from(
        db_path: &std::path::Path,
        resolve_tokens: bool,
    ) -> Vec<NativeProviderCredential> {
        if !db_path.exists() {
            return Vec::new();
        }
        let conn = match Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let mut stmt = match conn
            .prepare("SELECT provider, credential_type, data, updated_at FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY updated_at DESC, id DESC")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], |row| {
            let provider: String = row.get(0)?;
            let cred_type: String = row.get(1)?;
            let data: String = row.get(2)?;
            let updated_at: i64 = row.get(3)?;
            Ok((provider, cred_type, data, updated_at))
        });
        let Ok(rows) = rows else { return Vec::new() };
        let mut creds = Vec::new();
        for credential in
            rows.filter_map(|r| r.ok())
                .filter_map(|(omp_id, cred_type, data, updated_at)| {
                    let basebuild_id = omp_to_basebuild_provider(&omp_id)?;
                    let key = match cred_type.as_str() {
                        "api_key" => serde_json::from_str::<Value>(&data).ok().and_then(|v| {
                            v.get("key").and_then(|k| k.as_str()).map(String::from)
                        })?,
                        "oauth" => {
                            // Enumeration (resolve_tokens=false) must never spawn
                            // `omp token`: it is only needed at send time, and
                            // OAuth OMP providers route through OmpRpcClient which
                            // self-authenticates. Use a placeholder so the account
                            // still lists; omp_api_key resolves the real token.
                            if resolve_tokens {
                                omp_oauth_token(&omp_id)?
                            } else {
                                format!("omp-oauth:{omp_id}")
                            }
                        }
                        _ => return None,
                    };
                    if key.is_empty() {
                        return None;
                    }
                    let base_url = (cred_type == "oauth").then(|| format!("omp://{omp_id}"));
                    Some(NativeProviderCredential {
                        provider_id: basebuild_id,
                        label: omp_id,
                        api_key: key,
                        base_url,
                        updated_at,
                    })
                })
        {
            if !creds
                .iter()
                .any(|c: &NativeProviderCredential| c.provider_id == credential.provider_id)
            {
                creds.push(credential);
            }
        }
        creds
    }

    /// Log out ALL accounts on a provider: deletes every stored account row,
    /// clears every Codex OAuth token slot, removes the legacy compat row,
    /// and blocks OMP re-import until the next explicit login.
    pub fn delete_credential(provider_id: &str) -> DbResult<()> {
        crate::services::provider_account_service::ProviderAccountService::ensure_migrated();
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM native_provider_accounts WHERE provider_id = ?1",
            params![provider_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM native_provider_credentials WHERE provider_id = ?1",
            params![provider_id],
        )
        .map_err(|e| e.to_string())?;
        // Per-account OAuth token slots plus the legacy single-slot key.
        // Exact key OR ':'-scoped prefix so a provider id that happens to be
        // a prefix of another (e.g. 'openai' vs 'openai-codex') never sweeps
        // the sibling's slots.
        conn.execute(
            "DELETE FROM app_defaults WHERE key = ?1 OR key LIKE ?2",
            params![
                format!("provider_oauth:{provider_id}"),
                format!("provider_oauth:{provider_id}:%")
            ],
        )
        .map_err(|e| e.to_string())?;
        crate::services::provider_login_service::ProviderLoginService::clear_native_token(
            provider_id,
        )?;
        // Block the provider so OMP-imported credentials don't reappear.
        conn.execute(
            "INSERT OR IGNORE INTO native_blocked_providers (provider_id, blocked_at) VALUES (?1, ?2)",
            params![provider_id, now_seconds()],
        )
        .map_err(|e| e.to_string())?;
        let _ = crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(provider_id, true);
        Ok(())
    }

    pub fn start_session(request: NativeChatStartRequest) -> DbResult<NativeChatSession> {
        if request.project_path.trim().is_empty() {
            return Err("Project path is required.".to_string());
        }

        let resolved = Self::resolve_model_default(&request.project_path)?;
        let provider_id = request.provider_id.unwrap_or(resolved.provider_id);
        let model_id = request.model_id.unwrap_or(resolved.model_id);
        let effort_level = request.effort_level.unwrap_or(resolved.effort_level);
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        let now = now_seconds();
        let session = NativeChatSession {
            id: gen_id("nchat"),
            project_path: request.project_path,
            title: request.title.unwrap_or_else(|| "New Chat".to_string()),
            profile_id: NATIVE_PROFILE_ID.to_string(),
            provider_id,
            model_id,
            effort_level,
            status: "ready".to_string(),
            run_state: "idle".to_string(),
            created_at: now,
            updated_at: now,
        };

        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                session.id,
                session.project_path,
                session.title,
                session.profile_id,
                session.provider_id,
                session.model_id,
                session.effort_level,
                session.status,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to create native chat session: {e}"))?;

        Ok(session)
    }

    /// Provision a fresh native chat session for a plan run. The session is
    /// titled `<reference_id> — <plan title>`, bound to the given model
    /// (falling back to project/global defaults), and primed with an opening
    /// context message assembled from the plan, its linked OpenSpec change,
    /// and the project schematic. Called by `plan_runner_service` when
    /// dispatching a run.
    pub fn create_session_for_plan(
        plan: &Plan,
        provider_id: &str,
        model_id: &str,
        effort_level: Option<&str>,
    ) -> DbResult<NativeChatSession> {
        // Resolve the project path from the plan's session.
        let session = SessionService::get(&plan.session_id)
            .map_err(|e| format!("Failed to load plan's session: {e}"))?
            .ok_or_else(|| "Plan's session not found".to_string())?;
        let project_path = session.project_path.clone();

        // Resolve model defaults: explicit > project > global.
        let resolved = Self::resolve_model_default(&project_path)?;
        let provider_id = if provider_id.is_empty() {
            resolved.provider_id
        } else {
            provider_id.to_string()
        };
        let model_id = if model_id.is_empty() {
            resolved.model_id
        } else {
            model_id.to_string()
        };
        let effort_level = effort_level
            .map(str::to_string)
            .unwrap_or(resolved.effort_level);
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        let title = format!("{} — {}", plan.reference_id, plan.title);
        let now = now_seconds();
        let chat_session = NativeChatSession {
            id: gen_id("nchat"),
            project_path: project_path.clone(),
            title,
            profile_id: NATIVE_PROFILE_ID.to_string(),
            provider_id,
            model_id,
            effort_level,
            status: "ready".to_string(),
            run_state: "idle".to_string(),
            created_at: now,
            updated_at: now,
        };

        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                chat_session.id,
                chat_session.project_path,
                chat_session.title,
                chat_session.profile_id,
                chat_session.provider_id,
                chat_session.model_id,
                chat_session.effort_level,
                chat_session.status,
                chat_session.created_at,
                chat_session.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to create plan chat session: {e}"))?;

        // Prime the session with an opening context message built from the
        // plan + linked OpenSpec change + project schematic. This is a system
        // message so the model treats it as context, not a user turn.
        let opening = Self::build_plan_opening_context(plan, &project_path);
        if !opening.is_empty() {
            Self::insert_message(
                &chat_session.id,
                "system",
                &opening,
                None,
                Some(&chat_session.provider_id),
                Some(&chat_session.model_id),
                Some(&chat_session.effort_level),
            )?;
        }

        Ok(chat_session)
    }

    /// Assemble the opening context for a plan run session: plan title/goal,
    /// linked OpenSpec change path, and project schematic summary.

    pub fn build_plan_opening_context(plan: &Plan, project_path: &str) -> String {
        let mut parts: Vec<String> = Vec::new();
        parts.push(format!("# Plan: {}\n{}", plan.title, plan.description));
        if let Some(goal) = &plan.goal {
            if !goal.trim().is_empty() {
                parts.push(format!("**Goal:** {goal}"));
            }
        }
        if let Some(change_name) = &plan.change_name {
            let change_path = format!("{project_path}/openspec/changes/{change_name}");
            parts.push(format!(
                "You are applying the OpenSpec change at {change_path}/.\n\
                 Read proposal.md, design.md if present, specs/**/spec.md, and tasks.md.\n\
                 Work tasks.md top-to-bottom. Mark each checkbox immediately after completing it.\n\
                 Do not create a second implementation plan. Update docs/DESIGN/mvp only where tasks.md says so.\n\
                 Run the relevant verification commands before reporting completion."
            ));
        }
        // Append project schematic if it exists.
        let project = std::path::Path::new(project_path);
        if crate::services::schematic_service::exists(project) {
            if let Ok(schematic) = crate::services::schematic_service::read(project) {
                if !schematic.trim().is_empty() {
                    parts.push(format!("**Project schematic:**\n{schematic}"));
                }
            }
        }
        parts.join("\n\n")
    }
    /// Provision a native chat session for a background `generate_openspec`
    /// pipeline run so the user can open the agent and watch each artifact
    /// stream in. The session is created in the `running` state and primed
    /// with a system message explaining what is being generated.
    pub fn create_session_for_openspec_generation(plan: &Plan) -> DbResult<NativeChatSession> {
        let session = SessionService::get(&plan.session_id)
            .map_err(|e| format!("Failed to load plan's session: {e}"))?
            .ok_or_else(|| "Plan's session not found".to_string())?;
        let project_path = session.project_path;

        let resolved = Self::resolve_model_default(&project_path)?;
        Self::validate_provider_model(&resolved.provider_id, &resolved.model_id, true)?;

        let title = format!("OpenSpec — {}", plan.title);
        let now = now_seconds();
        let chat_session = NativeChatSession {
            id: gen_id("nchat"),
            project_path: project_path.clone(),
            title,
            profile_id: NATIVE_PROFILE_ID.to_string(),
            provider_id: resolved.provider_id,
            model_id: resolved.model_id,
            effort_level: resolved.effort_level,
            status: "ready".to_string(),
            run_state: "running".to_string(),
            created_at: now,
            updated_at: now,
        };

        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id, model_id, effort_level, status, run_state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                chat_session.id,
                chat_session.project_path,
                chat_session.title,
                chat_session.profile_id,
                chat_session.provider_id,
                chat_session.model_id,
                chat_session.effort_level,
                chat_session.status,
                chat_session.run_state,
                chat_session.created_at,
                chat_session.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to create OpenSpec chat session: {e}"))?;

        let goal = plan
            .goal
            .as_ref()
            .filter(|g| !g.trim().is_empty())
            .map(|g| format!("**Goal:** {g}\n\n"))
            .unwrap_or_default();
        let opening = format!(
            "# Plan: {}\n{}\n\n{goal}Basebuild is generating OpenSpec artifacts for this plan \
             (proposal, spec, design, tasks, then an implementation assessment). Each artifact \
             streams below as it is generated.",
            plan.title, plan.description,
        );
        Self::insert_message(
            &chat_session.id,
            "system",
            &opening,
            None,
            Some(&chat_session.provider_id),
            Some(&chat_session.model_id),
            Some(&chat_session.effort_level),
        )?;

        Ok(chat_session)
    }

    /// Set a session's `run_state` (`running`, `idle`, …). Used by background
    /// pipeline stages bound to a chat session so the chat panel shows a live
    /// thinking indicator when opened mid-run and settles when the run ends.
    pub fn set_session_run_state(session_id: &str, run_state: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE native_chat_sessions SET run_state = ?2, updated_at = ?3 WHERE id = ?1",
            params![session_id, run_state, now_seconds()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn get_session(session_id: &str) -> DbResult<Option<NativeChatSession>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, project_path, title, profile_id, provider_id, model_id, effort_level, status, run_state, created_at, updated_at
             FROM native_chat_sessions WHERE id = ?1",
            params![session_id],
            map_session,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Rename a native chat session. Called when the user renames a chat tab
    /// so the title survives project switches and restarts.
    pub fn rename_session(session_id: &str, title: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let now = now_seconds();
        conn.execute(
            "UPDATE native_chat_sessions SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![session_id, title, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Persist the provider/model/effort selection on an existing session.
    /// Called when the user changes the selection in the composer so the
    /// choice survives restart. Validates the provider/model pair first.
    pub fn update_session_model(
        session_id: &str,
        provider_id: &str,
        model_id: &str,
        effort_level: &str,
    ) -> DbResult<NativeChatSession> {
        Self::validate_provider_model(provider_id, model_id, true)?;
        let conn = StorageService::connect()?;
        let now = now_seconds();
        conn.execute(
            "UPDATE native_chat_sessions
             SET provider_id = ?2, model_id = ?3, effort_level = ?4, updated_at = ?5
             WHERE id = ?1",
            params![session_id, provider_id, model_id, effort_level, now],
        )
        .map_err(|e| e.to_string())?;
        if conn.changes() == 0 {
            return Err("Session not found.".to_string());
        }
        Self::get_session(session_id)?.ok_or_else(|| "Session not found after update.".to_string())
    }

    pub fn list_sessions(project_path: &str) -> DbResult<Vec<NativeChatSession>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, title, profile_id, provider_id, model_id, effort_level, status, run_state, created_at, updated_at
                 FROM native_chat_sessions WHERE project_path = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], map_session)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn chat_history(limit: Option<i64>) -> DbResult<Vec<NativeChatHistoryEntry>> {
        let conn = StorageService::connect()?;
        let base_sql = "SELECT s.id, s.project_path, s.title, s.profile_id, s.provider_id, s.model_id, s.effort_level, s.status, s.run_state, s.created_at, s.updated_at, COUNT(m.id) as message_count
                        FROM native_chat_sessions s
                        LEFT JOIN native_chat_messages m ON m.session_id = s.id
                        GROUP BY s.id
                        ORDER BY s.updated_at DESC";
        if let Some(l) = limit {
            let mut stmt = conn
                .prepare(&format!("{} LIMIT ?1", base_sql))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![l], map_history_entry)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        } else {
            let mut stmt = conn.prepare(base_sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], map_history_entry)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        }
    }

    pub fn list_messages(session_id: &str) -> DbResult<Vec<NativeChatMessage>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, reasoning, sort_order, provider_id, model_id, effort_level, created_at
                 FROM native_chat_messages WHERE session_id = ?1 ORDER BY sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], map_message)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Delete all persisted messages and tool events for a session.
    /// Preserves the session record itself (provider/model/effort selection).
    /// Returns the count of deleted messages.
    pub fn clear_session_messages(session_id: &str) -> DbResult<usize> {
        let conn = StorageService::connect()?;
        let deleted = conn
            .execute(
                "DELETE FROM native_chat_messages WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(|e| format!("Failed to clear chat messages: {e}"))?;
        conn.execute(
            "DELETE FROM native_tool_events WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|e| format!("Failed to clear tool events: {e}"))?;
        Ok(deleted)
    }

    /// Persist a sent user message to the global input history (last 100).
    /// Deduplicates by content so re-sending the same text doesn't fill the
    /// buffer with repeats. Trims to the most recent 100 entries.
    pub fn add_input_history(content: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let now = now_seconds();
        // Delete any existing entry with the same content, then re-insert
        // so the re-sent message moves to the newest position.
        conn.execute(
            "DELETE FROM native_chat_input_history WHERE content = ?1",
            params![content],
        )
        .map_err(|e| format!("Failed to trim input history: {e}"))?;
        conn.execute(
            "INSERT INTO native_chat_input_history (content, created_at) VALUES (?1, ?2)",
            params![content, now],
        )
        .map_err(|e| format!("Failed to save input history: {e}"))?;
        // Trim to last 100 (keep the newest 100 by id).
        conn.execute(
            "DELETE FROM native_chat_input_history
             WHERE id NOT IN (
                 SELECT id FROM native_chat_input_history
                 ORDER BY id DESC LIMIT 100
             )",
            [],
        )
        .map_err(|e| format!("Failed to trim input history: {e}"))?;
        Ok(())
    }

    /// Return the global input history, most-recent-first (last 100 sent).
    pub fn list_input_history() -> DbResult<Vec<String>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare("SELECT content FROM native_chat_input_history ORDER BY id DESC LIMIT 100")
            .map_err(|e| format!("Failed to query input history: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read input history: {e}"))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read input history row: {e}"))?);
        }
        Ok(result)
    }

    pub fn send_message(
        app: &AppHandle,
        request: NativeChatSendRequest,
    ) -> DbResult<NativeChatSendResult> {
        let content = request.content.trim();
        if content.is_empty() {
            return Err("Message content is required.".to_string());
        }

        let session = Self::get_session(&request.session_id)?
            .ok_or_else(|| format!("Native chat session '{}' not found", request.session_id))?;
        let provider_id = request
            .provider_id
            .unwrap_or_else(|| session.provider_id.clone());
        let model_id = request.model_id.unwrap_or_else(|| session.model_id.clone());
        let effort_level = request
            .effort_level
            .unwrap_or_else(|| session.effort_level.clone());
        // Allow unconfigured providers: we return a typed SetupRequired result
        // rather than hard-failing, so the draft is never lost.
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        // Persist the user message immediately so the draft survives any outcome.
        let user_message = Self::insert_message(
            &request.session_id,
            "user",
            content,
            None,
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        Self::touch_session(&request.session_id)?;
        // Auto-title the session from the first user message (no-ops if already titled).
        let _ = Self::auto_title_native(&request.session_id, content);

        let catalog = Self::provider_catalog();
        let provider_label = catalog
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .map(|p| p.label.clone())
            .unwrap_or_else(|| provider_id.clone());

        use crate::services::provider_account_service as pacct;
        let is_local = provider_id == LOCAL_PROVIDER_ID;
        // Ordered healthy account candidates for this request: strategy
        // rotation over healthy stored accounts, OMP virtual account as
        // fallback, errored accounts last. Auth-expired and in-cooldown
        // accounts are excluded.
        let mut candidates = if is_local {
            Vec::new()
        } else {
            pacct::ProviderAccountService::candidates(&provider_id, Some(&request.session_id))?
        };
        // Refresh per-account OAuth tokens before use (Codex only; no-op otherwise).
        for candidate in candidates.iter_mut() {
            let _ = crate::services::provider_login_service::ProviderLoginService::refresh_account_token(candidate);
        }

        // Non-local provider with no usable account → typed setup prompt.
        // Distinguishes "never connected" from "every account is unhealthy".
        if !is_local && candidates.is_empty() {
            let has_accounts =
                !pacct::ProviderAccountService::list_records(Some(&provider_id))?.is_empty();
            let message = if has_accounts {
                pacct::ProviderAccountService::exhaustion_message(&provider_id, &provider_label)
            } else {
                format!("Connect {provider_label} to send this message. Your draft was kept.")
            };
            return Ok(NativeChatSendResult {
                user_message,
                assistant_message: None,
                metrics: None,
                tool_events: vec![],
                setup_required: Some(NativeSetupRequired {
                    provider_id: provider_id.clone(),
                    provider_label: provider_label.clone(),
                    message,
                }),
                offline: false,
            });
        }
        let credential = candidates.first().cloned();

        // Build conversation context: prior turns are already persisted, and the
        // new user message was just inserted, so list_messages includes it.
        // Assistant rows are persisted one per loop iteration, so merge
        // consecutive assistant rows into a single message — providers must
        // never see back-to-back assistant messages.
        let history = Self::list_messages(&request.session_id)?;
        let messages = Self::history_to_provider_messages(&history);
        let system = Self::system_prompt(&session.project_path, None);

        // Resolve the provider-specific model API id (e.g. "umans-glm-5.2")
        // from the cache; fall back to the canonical model_id when null.
        let resolved_model_id =
            Self::resolve_model_api_id(&provider_id, &model_id).unwrap_or_else(|| model_id.clone());

        // Look up the model's api_kind and base_url for routing.
        let (api_kind, model_base_url) = Self::resolve_model_routing(&provider_id, &model_id);

        let req = ProviderRequest {
            model_id: resolved_model_id.clone(),
            effort_level: effort_level.clone(),
            system: Some(system.clone()),
            messages: messages.clone(),
            api_key: credential.as_ref().map(|c| c.api_key.clone()),
            base_url: credential.as_ref().and_then(|c| c.base_url.clone()),
            tools: Vec::new(),
        };
        // OMP-backed OAuth and bespoke protocols use the OMP RPC transport.
        // They intentionally run without Basebuild tools because OMP owns that
        // protocol boundary, but authenticated text chat remains functional.
        let requires_omp = Self::route_requires_omp(
            &api_kind,
            req.base_url.as_deref(),
            &model_base_url,
            is_local,
        );
        let started_at = now_millis();

        // Native transports use the agent loop when the selected model supports
        // tools. OMP RPC routes use the plain streaming path below.
        let supports_tools =
            !requires_omp && !is_local && Self::model_supports_tools(&provider_id, &model_id);

        // Capture schematic mtime before the turn to detect agent-driven writes.
        let schematic_path =
            std::path::Path::new(&session.project_path).join(".basebuild/project-schematic.md");
        let schematic_mtime_before = std::fs::metadata(&schematic_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        if supports_tools {
            // Run the agentic loop with pre-stream failover: an auth or
            // rate-limit failure before any streamed output moves to the next
            // native-transport account (at most one attempt per account).
            // Mid-stream failures never silently retry.
            let native_candidates: Vec<pacct::ProviderAccountRecord> = candidates
                .iter()
                .filter(|record| record.auth_method != pacct::AUTH_OMP)
                .cloned()
                .collect();
            let mut attempt = 0usize;
            let (run_result, used_account_id) = loop {
                let account = native_candidates.get(attempt);
                let run_result = crate::services::agent_loop_service::run_agent_turn(
                    &request.session_id,
                    &session.project_path,
                    &provider_id,
                    &model_id,
                    &effort_level,
                    account.map(|c| c.api_key.clone()),
                    account.and_then(|c| c.base_url.clone()),
                    system.clone(),
                    messages.clone(),
                    app.clone(),
                    true,
                    None,
                );
                let account_id = account.map(|c| c.id.clone());
                let Some(account) = account else {
                    break (run_result, account_id);
                };
                match pre_stream_failure(&run_result) {
                    Some(error_text) => {
                        pacct::ProviderAccountService::record_outcome(
                            &account.id,
                            pacct::classify_provider_error(&error_text),
                        );
                        if attempt + 1 < native_candidates.len() {
                            // Remove the failed attempt's draft rows so the
                            // retried turn starts from a clean transcript.
                            for segment in &run_result.segments {
                                if let Some(message_id) = &segment.message_id {
                                    let _ = Self::delete_message(message_id);
                                }
                            }
                            eprintln!(
                                "[provider-accounts] failover provider={provider_id} from={} attempt={attempt}: {error_text}",
                                account.id
                            );
                            attempt += 1;
                            continue;
                        }
                        break (run_result, account_id);
                    }
                    None => {
                        pacct::ProviderAccountService::record_outcome(
                            &account.id,
                            pacct::AccountOutcome::Success,
                        );
                        break (run_result, account_id);
                    }
                }
            };

            let completed_at = now_millis();
            let duration_ms = completed_at.saturating_sub(started_at).max(1);
            // Persist one assistant message per loop iteration and bind each
            // iteration's tool events to the message that preceded them, so the
            // transcript interleaves text and tool calls chronologically.
            let (assistant_message, tool_events) = Self::persist_turn_segments(
                &request.session_id,
                &user_message.id,
                &run_result.segments,
                &run_result.tool_events,
                &provider_id,
                &model_id,
                &effort_level,
            )?;
            // Post-turn: if the agent wrote to the schematic file via write_file,
            // emit a SchematicUpdated event so the schematic tab refreshes.
            let schematic_mtime_after = std::fs::metadata(&schematic_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            if let (Some(before), Some(after)) = (schematic_mtime_before, schematic_mtime_after) {
                if after > before {
                    let _ = crate::services::planning_events::emit(
                        &app,
                        crate::models::planning_event::PlanningEventKind::SchematicUpdated,
                        &session.project_path,
                        &session.project_path,
                        Some(request.session_id.clone()),
                        "Schematic updated by agent",
                        Some(
                            "The agent wrote to the project schematic during this turn."
                                .to_string(),
                        ),
                    );
                }
            }

            let subscription = Self::resolve_subscription(&provider_id);
            let metric = NativeRequestMetric {
                id: gen_id("nreq"),
                session_id: request.session_id.clone(),
                provider_id: provider_id.clone(),
                model_id: model_id.clone(),
                effort_level: effort_level.clone(),
                started_at,
                completed_at: Some(completed_at),
                duration_ms: Some(duration_ms),
                ttft_ms: None,
                ttlt_ms: Some(duration_ms),
                input_tokens: 0,
                output_tokens: estimate_tokens(&run_result.content),
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                tokens_per_second: None,
                cost_total: Some(0.0),
                outcome: if run_result.cancelled {
                    "cancelled"
                } else {
                    "success"
                }
                .to_string(),
                error_class: None,
                subscription_tier: subscription.0.clone(),
                subscription_source: subscription.1.clone(),
                plan_name: subscription.2.clone(),
                created_at: now_seconds(),
                account_id: used_account_id.clone(),
            };
            Self::insert_metric(&metric)?;
            Self::touch_session(&request.session_id)?;

            return Ok(NativeChatSendResult {
                user_message,
                assistant_message,
                metrics: Some(metric),
                tool_events,
                setup_required: None,
                offline: false,
            });
        }

        let assistant_draft = Self::insert_message(
            &request.session_id,
            "assistant",
            "",
            None,
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        let live_progress = Arc::new(Mutex::new((String::new(), String::new())));
        let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_running(
            &request.session_id,
        );

        // The provider client is resolved per attempt inside the failover
        // loop below — accounts on one provider may route differently
        // (native OAuth vs API key vs OMP RPC).
        let session_id_for_emit = request.session_id.clone();
        let app_for_emit = app.clone();
        let draft_id_for_emit = assistant_draft.id.clone();
        let progress_for_emit = live_progress.clone();
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({ "sessionId": session_id_for_emit, "delta": delta, "channel": channel }),
            );
            if channel != "content" && channel != "reasoning" {
                return;
            }
            let mut progress = progress_for_emit.lock();
            if channel == "reasoning" {
                progress.1.push_str(delta);
            } else {
                progress.0.push_str(delta);
            }
            let reasoning = (!progress.1.is_empty()).then_some(progress.1.as_str());
            let _ = Self::update_message_progress(&draft_id_for_emit, &progress.0, reasoning);
        };

        // Signal the UI that the model is thinking before the first token.
        emit("thinking", "status");

        let mut attempt = 0usize;
        let mut used_account_id: Option<String> = None;
        let response = loop {
            let account = candidates.get(attempt);
            used_account_id = account.map(|c| c.id.clone());
            let attempt_req = ProviderRequest {
                model_id: resolved_model_id.clone(),
                effort_level: effort_level.clone(),
                system: req.system.clone(),
                messages: req.messages.clone(),
                api_key: account.map(|c| c.api_key.clone()),
                base_url: account.and_then(|c| c.base_url.clone()),
                tools: Vec::new(),
            };
            let client = resolve_client_for_model(
                &provider_id,
                &api_kind,
                attempt_req.base_url.as_deref(),
                &model_base_url,
            );
            match client.generate(&attempt_req, &emit) {
                Ok(response) => {
                    if let Some(account) = account {
                        pacct::ProviderAccountService::record_outcome(
                            &account.id,
                            pacct::AccountOutcome::Success,
                        );
                    }
                    break response;
                }
                Err(e) => {
                    if let Some(account) = account {
                        pacct::ProviderAccountService::record_outcome(
                            &account.id,
                            pacct::classify_provider_error(&e),
                        );
                    }
                    // Pre-stream failures (no content, no reasoning yet) fail
                    // over to the next candidate; anything mid-stream surfaces
                    // the error with the existing retry affordance.
                    let pre_stream = {
                        let progress = live_progress.lock();
                        progress.0.trim().is_empty() && progress.1.trim().is_empty()
                    };
                    if pre_stream && account.is_some() && attempt + 1 < candidates.len() {
                        eprintln!(
                            "[provider-accounts] failover provider={provider_id} attempt={attempt}: {e}"
                        );
                        attempt += 1;
                        continue;
                    }
                    let progress = live_progress.lock();
                    let error = format!("Error: {e}");
                    let content = if progress.0.trim().is_empty() {
                        error
                    } else {
                        format!("{}\n\n{error}", progress.0)
                    };
                    let reasoning = (!progress.1.trim().is_empty()).then_some(progress.1.as_str());
                    let _ = Self::update_message_progress(&assistant_draft.id, &content, reasoning);
                    let completed_at = now_millis();
                    let subscription = Self::resolve_subscription(&provider_id);
                    let metric = NativeRequestMetric {
                        id: gen_id("nreq"),
                        session_id: request.session_id.clone(),
                        provider_id: provider_id.clone(),
                        model_id: model_id.clone(),
                        effort_level: effort_level.clone(),
                        started_at,
                        completed_at: Some(completed_at),
                        duration_ms: Some(completed_at.saturating_sub(started_at).max(1)),
                        ttft_ms: None,
                        ttlt_ms: None,
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_read_tokens: 0,
                        cache_write_tokens: 0,
                        tokens_per_second: None,
                        cost_total: Some(0.0),
                        outcome: "error".to_string(),
                        error_class: Some(pacct::provider_error_class(&e).to_string()),
                        subscription_tier: subscription.0.clone(),
                        subscription_source: subscription.1.clone(),
                        plan_name: subscription.2.clone(),
                        created_at: now_seconds(),
                        account_id: used_account_id.clone(),
                    };
                    let _ = Self::insert_metric(&metric);
                    let _ =
                        crate::services::plan_lifecycle_service::PlanLifecycleService::chat_terminal(
                            app,
                            &request.session_id,
                            crate::services::plan_lifecycle_service::ChatTerminalState::Failed,
                        );
                    return Err(e);
                }
            }
        };

        let assistant_message = Self::update_message_progress(
            &assistant_draft.id,
            &response.content,
            response.reasoning.as_deref(),
        )?;

        let duration_ms = response.duration_ms.max(1);
        let output_tokens = response
            .output_tokens
            .unwrap_or_else(|| estimate_tokens(&response.content));
        let input_tokens = response
            .input_tokens
            .unwrap_or_else(|| estimate_tokens(content));
        let tokens_per_second =
            Some((output_tokens as f64) / ((duration_ms as f64) / 1000.0).max(0.001));

        let subscription = Self::resolve_subscription(&provider_id);
        let metric = NativeRequestMetric {
            id: gen_id("nreq"),
            session_id: request.session_id.clone(),
            provider_id: provider_id.clone(),
            model_id: model_id.clone(),
            effort_level: effort_level.clone(),
            started_at,
            completed_at: Some(started_at + duration_ms),
            duration_ms: Some(duration_ms),
            ttft_ms: response.ttft_ms,
            ttlt_ms: Some(duration_ms),
            input_tokens,
            output_tokens,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            tokens_per_second,
            cost_total: Some(0.0),
            outcome: "success".to_string(),
            error_class: None,
            subscription_tier: subscription.0.clone(),
            subscription_source: subscription.1.clone(),
            plan_name: subscription.2.clone(),
            created_at: now_seconds(),
            account_id: used_account_id.clone(),
        };
        Self::insert_metric(&metric)?;

        let summary = if is_local {
            "No provider connected — select a provider to chat."
        } else {
            "Provider-backed turn: streamed assistant output with real timing/token metrics."
        };
        let event = Self::insert_tool_event(
            &request.session_id,
            Some(&assistant_message.id),
            "request_metrics",
            "recorded",
            summary,
            None,
            None,
            None,
            None,
        )?;

        Self::touch_session(&request.session_id)?;
        let _ = crate::services::plan_lifecycle_service::PlanLifecycleService::chat_terminal(
            app,
            &request.session_id,
            crate::services::plan_lifecycle_service::ChatTerminalState::Idle,
        );

        Ok(NativeChatSendResult {
            user_message,
            assistant_message: Some(assistant_message),
            metrics: Some(metric),
            tool_events: vec![event],
            setup_required: None,
            offline: is_local,
        })
    }

    /// Deliver a user message into an in-flight agent loop. The message is
    /// persisted as a normal user row so the transcript and future turns see
    /// it in order, then handed to the running loop, which injects it before
    /// its next provider request. Returns `delivered: false` when no run is
    /// active, so the caller can fall back to a normal send without losing
    /// the draft.
    pub fn steer(session_id: &str, content: &str) -> DbResult<NativeChatSteerResult> {
        let content = content.trim();
        if content.is_empty() {
            return Err("Steering message is required.".to_string());
        }
        let session = Self::get_session(session_id)?
            .ok_or_else(|| format!("Native chat session '{session_id}' not found"))?;

        if !crate::services::agent_loop_service::is_running(session_id) {
            return Ok(NativeChatSteerResult {
                delivered: false,
                message: None,
            });
        }

        // Persist before handing over so the row exists by the time the loop
        // can act on the steer, keeping the transcript ordered.
        let message = Self::insert_message(
            session_id,
            "user",
            content,
            None,
            Some(&session.provider_id),
            Some(&session.model_id),
            Some(&session.effort_level),
        )?;
        if !crate::services::agent_loop_service::push_steer(session_id, content) {
            // The run ended in the gap. Roll the row back so the caller's
            // fallback send does not duplicate the text.
            let _ = Self::delete_steer_message(&message.id);
            return Ok(NativeChatSteerResult {
                delivered: false,
                message: None,
            });
        }
        // The message is already in the running loop: a failed bookkeeping
        // update must not report the steer as undelivered.
        let _ = Self::touch_session(session_id);
        Ok(NativeChatSteerResult {
            delivered: true,
            message: Some(message),
        })
    }

    /// Generate structured ideas from the conversation + project schematic using
    /// a configured provider. The offline local coordinator does not fabricate
    /// ideas: if the active provider is local or unconfigured, a setup prompt is
    /// returned instead.
    pub fn generate_ideas(
        app: &AppHandle,
        request: NativeGenerateIdeasRequest,
    ) -> DbResult<NativeGenerateIdeasResult> {
        let chat_session = Self::get_session(&request.session_id)?
            .ok_or_else(|| format!("Native chat session '{}' not found", request.session_id))?;
        let planning_session_exists =
            crate::services::session_service::SessionService::list_sessions(
                &chat_session.project_path,
            )?
            .into_iter()
            .any(|session| session.id == request.planning_session_id);
        if !planning_session_exists {
            return Err("The active planning session does not belong to this project.".to_string());
        }

        let idea_count = request.idea_count.clamp(5, 8);
        let direction = request.direction.as_deref().map(str::trim).unwrap_or("");
        if direction.chars().count() > 4_000 {
            return Err("Idea Studio direction must be 4,000 characters or fewer.".to_string());
        }
        if request.category_ids.len() > 16 {
            return Err("Idea Studio accepts at most 16 focus areas per round.".to_string());
        }

        let available_categories =
            crate::services::session_service::SessionService::list_categories(
                &request.planning_session_id,
            )?;
        let mut selected_categories = Vec::with_capacity(request.category_ids.len());
        for category_id in &request.category_ids {
            let category = available_categories
                .iter()
                .find(|category| category.id == *category_id)
                .ok_or_else(|| {
                    format!("Idea category '{category_id}' does not belong to this session.")
                })?;
            if !selected_categories
                .iter()
                .any(|selected: &crate::models::idea::IdeaCategory| selected.id == category.id)
            {
                selected_categories.push(category.clone());
            }
        }

        let scope_label = if selected_categories.is_empty() {
            "project-wide".to_string()
        } else {
            selected_categories
                .iter()
                .map(|category| category.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let invocation_summary = if direction.is_empty() {
            format!("Auto-generate {idea_count} {scope_label} ideas.")
        } else {
            format!("{direction}\n\n{idea_count} ideas · {scope_label}")
        };
        let default_display_message = format!(
            "<command name=\"/skill:basebuild-planning\">\n{invocation_summary}\n</command>"
        );
        let display_message = request
            .display_message
            .as_deref()
            .map(str::trim)
            .filter(|message| !message.is_empty())
            .unwrap_or(&default_display_message);
        if display_message.chars().count() > 5_000 {
            return Err("Idea Studio message must be 5,000 characters or fewer.".to_string());
        }

        let provider_id = request
            .provider_id
            .clone()
            .unwrap_or_else(|| chat_session.provider_id.clone());
        let model_id = request
            .model_id
            .clone()
            .unwrap_or_else(|| chat_session.model_id.clone());
        let effort_level = request
            .effort_level
            .clone()
            .unwrap_or_else(|| chat_session.effort_level.clone());
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        // Persist the compact invocation before provider work begins. The
        // frontend mirrors this optimistically, so the instruction always
        // appears before thinking/progress state.
        let user_message = Self::insert_message(
            &request.session_id,
            "user",
            display_message,
            None,
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        Self::touch_session(&request.session_id)?;

        let catalog = Self::provider_catalog();
        let provider_label = catalog
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .map(|provider| provider.label.clone())
            .unwrap_or_else(|| provider_id.clone());
        // Pick the healthiest account for the run (same selection as chat
        // sends); per-account token refresh happens inside candidates().
        let mut idea_candidates =
            crate::services::provider_account_service::ProviderAccountService::candidates(
                &provider_id,
                Some(&request.session_id),
            )?;
        for candidate in idea_candidates.iter_mut() {
            let _ = crate::services::provider_login_service::ProviderLoginService::refresh_account_token(candidate);
        }
        let credential = idea_candidates.into_iter().next();

        let blocked_result = |message: String| NativeGenerateIdeasResult {
            ideas: vec![],
            setup_required: Some(NativeSetupRequired {
                provider_id: provider_id.clone(),
                provider_label: provider_label.clone(),
                message,
            }),
            grounding: None,
            user_message: Some(user_message.clone()),
            assistant_message: None,
        };

        let Some(credential) = credential else {
            return Ok(blocked_result(
                "Choose a connected provider to run the native Idea Studio skill.".to_string(),
            ));
        };

        let resolved_model_id =
            Self::resolve_model_api_id(&provider_id, &model_id).unwrap_or_else(|| model_id.clone());
        let (api_kind, model_base_url) = Self::resolve_model_routing(&provider_id, &model_id);
        if Self::route_requires_omp(
            &api_kind,
            credential.base_url.as_deref(),
            &model_base_url,
            false,
        ) {
            return Ok(blocked_result(
                "Idea Studio needs a native model with direct tool access. Choose a native-supported model instead of an OMP-only transport.".to_string(),
            ));
        }
        if !Self::model_supports_tools(&provider_id, &model_id) {
            return Ok(blocked_result(
                "Idea Studio needs a model that supports native file and idea tools.".to_string(),
            ));
        }

        let category_arguments = if selected_categories.is_empty() {
            "- Project-wide. Inspect the repository and schematic before choosing focus areas."
                .to_string()
        } else {
            selected_categories
                .iter()
                .map(|category| {
                    format!(
                        "- {} [{}]: {}",
                        category.name, category.id, category.description
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        let direction_argument = if direction.is_empty() {
            "No user direction. Find the strongest grounded opportunities.".to_string()
        } else {
            direction.to_string()
        };
        let existing_ideas = crate::services::session_service::SessionService::list_ideas(
            &request.planning_session_id,
        )?;
        let existing_plans = crate::services::plan_service::PlanService::list_for_project(
            &chat_session.project_path,
        )?;
        let existing_work = existing_planning_work_context(&existing_ideas, &existing_plans);
        let skill = crate::services::skill_registry_service::SkillRegistryService::read_content(
            "basebuild-planning",
        )
        .unwrap_or_else(|| {
            "Inspect the repository, then capture concrete grounded ideas with propose_ideas. Do not return the idea list as prose.".to_string()
        });
        let invocation = format!(
            "Native skill invocation: basebuild-planning\n\
             Arguments:\n\
             - idea_count: {idea_count}\n\
             - planning_session_id: {}\n\
             - focus_areas:\n{category_arguments}\n\
             - direction: {direction_argument}\n\
             - existing ideas and plans (do not duplicate):\n{existing_work}\n\n\
             Invocation rules:\n\
             - Start by using native read/list/search tools on the project. Never say you will read files without making the tool calls in that same turn.\n\
             - Capture exactly {idea_count} distinct ideas through propose_ideas. Use the matching category id when a focus area is selected.\n\
             - Exclude existing work unless the scope is materially different, then explain the distinction in assessment.rationale.\n\
             - Give every idea a plain, verb-first title of 2-5 words and one concise outcome sentence; keep file names in grounding.\n\
             - Every idea requires assessment schemaVersion 1, an honest minHours/maxHours range, 1-5 difficulty/impact/risk/confidence, rationale, concrete grounding, required capabilities, constraints, missing evidence, and alternatives.\n\
             - Low evidence requires low confidence and explicit missingEvidence. Compare trade-offs and prefer bounded, goal-aligned impact over inflated scope.\n\
             - Do not print the generated idea catalog as a wall of prose; the native tool renders it in Idea Studio.\n\
             - After capture, reply with one short completion sentence.",
            request.planning_session_id
        );
        let system = format!(
            "{}\n\n<skill name=\"basebuild-planning\" runtime=\"native\">\n{}\n</skill>\n\n{}",
            Self::system_prompt(&chat_session.project_path, request.schematic.as_deref()),
            skill,
            invocation
        );

        // Keep normal conversational context, but remove legacy turns that
        // exposed the entire planning skill as a user message.
        let history = Self::list_messages(&request.session_id)?;
        let visible_history = history
            .into_iter()
            .filter(|message| {
                !(message.role == "user"
                    && message
                        .content
                        .trim_start()
                        .starts_with("---\nname: basebuild-planning"))
            })
            .collect::<Vec<_>>();
        let messages = Self::history_to_provider_messages(&visible_history);
        let existing_idea_ids = existing_ideas
            .iter()
            .map(|idea| idea.id.clone())
            .collect::<std::collections::HashSet<_>>();

        let run_result = crate::services::agent_loop_service::run_agent_turn(
            &request.session_id,
            &chat_session.project_path,
            &provider_id,
            &model_id,
            &effort_level,
            Some(credential.api_key),
            credential.base_url,
            system,
            messages,
            app.clone(),
            true,
            Some(&request.planning_session_id),
        );
        let (assistant_message, _) = Self::persist_turn_segments(
            &request.session_id,
            &user_message.id,
            &run_result.segments,
            &run_result.tool_events,
            &provider_id,
            &model_id,
            &effort_level,
        )?;
        Self::touch_session(&request.session_id)?;

        let ideas = crate::services::session_service::SessionService::list_ideas(
            &request.planning_session_id,
        )?
        .into_iter()
        .filter(|idea| !existing_idea_ids.contains(&idea.id))
        .map(|idea| NativeGeneratedIdea {
            title: idea.title,
            description: idea.description,
            grounding: idea.grounding,
            anchor: idea.anchor,
            assessment: idea.assessment,
        })
        .collect::<Vec<_>>();

        if ideas.is_empty() && !run_result.cancelled {
            return Err(
                "The model finished without capturing any ideas. Try a different native tool-capable model."
                    .to_string(),
            );
        }

        let grounding =
            crate::services::planning_prompt_service::PlanningPromptService::grounding_metadata(
                &request.planning_session_id,
                &chat_session.project_path,
            );
        Ok(NativeGenerateIdeasResult {
            ideas,
            setup_required: None,
            grounding: Some(grounding),
            user_message: Some(user_message),
            assistant_message,
        })
    }

    /// Record a pipeline_runs row for a generate-ideas/generate-plans stage.
    pub fn record_pipeline_run(
        run_id: &str,
        session_id: &str,
        project_path: &str,
        kind: &str,
        status: &str,
        ts: i64,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO pipeline_runs (id, session_id, project_path, kind, input_summary, status, output_refs, started_at, completed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, '', ?5, '[]', ?6, CASE WHEN ?5 IN ('succeeded','failed','cancelled') THEN ?6 ELSE NULL END, ?6)
             ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at",
            rusqlite::params![run_id, session_id, project_path, kind, status, ts],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_metrics(limit: u32) -> DbResult<Vec<NativeRequestMetric>> {
        let limit = i64::from(limit.clamp(1, 500));
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                        subscription_tier, subscription_source, plan_name, account_id
                 FROM native_request_metrics ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], map_metric)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn latest_metric_for_session(session_id: &str) -> DbResult<Option<NativeRequestMetric>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                    subscription_tier, subscription_source, plan_name, account_id
             FROM native_request_metrics
             WHERE session_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![session_id],
            map_metric,
        )
        .optional()
        .map_err(|error| error.to_string())
    }

    /// How many metrics were recorded strictly after `since_created_at`.
    ///
    /// Indexed COUNT rather than `metrics_since(..).len()`: the status panel
    /// reads this to say "3 requests queued" instead of the misleading "no
    /// new usage", and must not deserialize the whole ledger to do it.
    pub fn metrics_count_since(since_created_at: i64) -> DbResult<i64> {
        StorageService::connect()?
            .query_row(
                "SELECT COUNT(*) FROM native_request_metrics WHERE created_at > ?1",
                params![since_created_at],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    /// Metrics created strictly after `since_created_at` (epoch seconds),
    /// oldest-first, for the incremental app→basebuild.net message sync.
    pub fn metrics_since(since_created_at: i64, limit: u32) -> DbResult<Vec<NativeRequestMetric>> {
        let limit = i64::from(limit.clamp(1, 5000));
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                        subscription_tier, subscription_source, plan_name, account_id
                 FROM native_request_metrics WHERE created_at > ?1 ORDER BY created_at ASC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since_created_at, limit], map_metric)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn metrics_summary() -> DbResult<NativeRequestMetricsSummary> {
        let conn = StorageService::connect()?;
        let mut summary = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                        AVG(tokens_per_second), AVG(ttft_ms), AVG(ttlt_ms)
                 FROM native_request_metrics",
                [],
                |row| {
                    Ok(NativeRequestMetricsSummary {
                        total_requests: row.get(0)?,
                        total_input_tokens: row.get(1)?,
                        total_output_tokens: row.get(2)?,
                        avg_tokens_per_second: row.get(3)?,
                        avg_ttft_ms: row.get(4)?,
                        avg_ttlt_ms: row.get(5)?,
                        last_provider_id: None,
                        last_model_id: None,
                        last_effort_level: None,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        if let Some((provider, model, effort)) = conn
            .query_row(
                "SELECT provider_id, model_id, effort_level FROM native_request_metrics ORDER BY created_at DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            summary.last_provider_id = Some(provider);
            summary.last_model_id = Some(model);
            summary.last_effort_level = Some(effort);
        }

        Ok(summary)
    }

    pub fn request_tool_approval(
        request: NativeToolApprovalRequest,
    ) -> DbResult<NativeToolApprovalResult> {
        let rules = SettingsService::get_permission_rules()?;
        let decision = match request.action.as_str() {
            "command" => rules.allow_command_execution,
            "file_write" => rules.allow_file_modification,
            "external_context" => rules.allow_external_context,
            "provider" => PermissionDecision::Ask,
            _ => PermissionDecision::Ask,
        };

        let (decision_text, requires_prompt, reason) = match decision {
            PermissionDecision::Allow => ("allow", false, "Allowed by existing permission rule."),
            PermissionDecision::Deny => ("deny", false, "Denied by existing permission rule."),
            PermissionDecision::Ask => (
                "ask",
                true,
                "User approval is required before this native harness action can run.",
            ),
        };

        SettingsService::record_audit(
            &format!("native_{}", request.action),
            request.scope.as_deref(),
            decision_text,
            request.source_workflow.as_deref(),
        )?;

        Ok(NativeToolApprovalResult {
            decision: decision_text.to_string(),
            requires_prompt,
            reason: reason.to_string(),
        })
    }

    /// Look up the provider-specific model API id (e.g. "umans-glm-5.2") from
    /// the cache for a (provider_id, canonical model_id) pair. Returns None
    /// when the row has no model_api_id (legacy bundled/discovered rows) or
    /// the row doesn't exist — callers fall back to the canonical model_id.
    pub fn resolve_model_api_id(provider_id: &str, model_id: &str) -> Option<String> {
        let conn = StorageService::connect().ok()?;
        conn.query_row(
            "SELECT model_api_id FROM native_provider_model_cache
             WHERE provider_id = ?1 AND model_id = ?2 AND model_api_id IS NOT NULL",
            params![provider_id, model_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    /// Look up a model's `api_kind` and `base_url` from the cache for
    /// provider routing. Falls back to the bundled model catalog if the
    /// model is not in the cache or has no `api_kind` set.
    pub fn resolve_model_routing(provider_id: &str, model_id: &str) -> (String, String) {
        // Try the DB cache first.
        if let Ok(conn) = StorageService::connect() {
            if let Ok(row) = conn.query_row(
                "SELECT api_kind, base_url FROM native_provider_model_cache
                 WHERE provider_id = ?1 AND model_id = ?2",
                params![provider_id, model_id],
                |row| {
                    let api_kind: String = row.get(0).unwrap_or_default();
                    let base_url: String = row.get(1).unwrap_or_default();
                    Ok((api_kind, base_url))
                },
            ) {
                if !row.0.is_empty() {
                    return row;
                }
            }
        }
        // Fall back to the bundled model catalog.
        if let Some(cm) = model_catalog::models_for(provider_id)
            .iter()
            .find(|m| m.id == model_id)
        {
            return (cm.api_kind.clone(), cm.base_url.clone());
        }
        (String::new(), String::new())
    }

    /// True when this route requires OMP RPC. OAuth credentials owned by OMP
    /// use an `omp://<provider>` sentinel. Bespoke protocol kinds require OMP
    /// only when neither the credential nor model catalog supplies an endpoint.
    pub fn route_requires_omp(
        api_kind: &str,
        credential_base_url: Option<&str>,
        model_base_url: &str,
        is_local: bool,
    ) -> bool {
        if credential_base_url.is_some_and(|value| value.starts_with("omp://")) {
            return true;
        }
        let has_direct_endpoint = credential_base_url.is_some_and(|value| !value.trim().is_empty())
            || !model_base_url.trim().is_empty();
        !crate::services::provider_client::transport_supports_tools(api_kind)
            && !is_local
            && !has_direct_endpoint
    }

    fn validate_provider_model(
        provider_id: &str,
        model_id: &str,
        allow_unconfigured: bool,
    ) -> DbResult<()> {
        let catalog = Self::provider_catalog();
        let provider = catalog
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .ok_or_else(|| format!("Unknown native provider '{provider_id}'"))?;
        let model_exists = catalog
            .models
            .iter()
            .any(|model| model.id == model_id && model.provider_id == provider_id);
        if !model_exists {
            return Err(format!(
                "Model '{model_id}' is not available for provider '{provider_id}'"
            ));
        }
        if !allow_unconfigured && !provider.configured {
            return Err(format!(
                "Provider '{}' is not configured. Configure credentials or choose Basebuild Local.",
                provider.label
            ));
        }
        Ok(())
    }

    /// Convert persisted history into provider messages. Assistant rows are
    /// persisted one per loop iteration, so consecutive assistant rows are
    /// merged into a single message (joined with blank lines) — providers must
    /// never see back-to-back assistant messages.
    fn history_to_provider_messages(history: &[NativeChatMessage]) -> Vec<ChatMsg> {
        let mut messages: Vec<ChatMsg> = Vec::new();
        for m in history
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
        {
            if m.role == "assistant" {
                if let Some(last) = messages.last_mut().filter(|l| l.role == "assistant") {
                    if !last.content.is_empty() && !m.content.is_empty() {
                        last.content.push_str("\n\n");
                    }
                    last.content.push_str(&m.content);
                    continue;
                }
            }
            messages.push(ChatMsg {
                role: m.role.clone(),
                content: m.content.clone(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
            });
        }
        messages
    }

    /// Persist a completed agent turn: one assistant message per loop
    /// iteration that produced text or reasoning, with each iteration's tool
    /// events bound to the message that preceded them. Tool events from an
    /// iteration with no persisted segment bind to the most recently inserted
    /// message of the turn, falling back to the user message when no assistant
    /// row exists yet — turn tool events are never left unbound. Rows with
    /// empty content and no reasoning are never inserted. Returns the last
    /// inserted assistant message (None when no segment had text) and the
    /// persisted tool events.
    fn persist_turn_segments(
        session_id: &str,
        user_message_id: &str,
        segments: &[TurnSegment],
        event_records: &[ToolEventRecord],
        provider_id: &str,
        model_id: &str,
        effort_level: &str,
    ) -> DbResult<(Option<NativeChatMessage>, Vec<NativeToolEvent>)> {
        let mut assistant_message: Option<NativeChatMessage> = None;
        let mut tool_events = Vec::new();
        let mut bind_message_id = user_message_id.to_string();
        let mut pending_events = event_records.iter().peekable();

        let persist_event = |te: &ToolEventRecord, message_id: &str| -> DbResult<NativeToolEvent> {
            Self::upsert_tool_event(
                &te.tool_call_id,
                session_id,
                Some(message_id),
                &te.tool_name,
                &te.status,
                &te.summary,
                te.arguments.as_deref(),
                te.diff.as_deref(),
                Some(&te.decision),
                te.rule_source.as_deref(),
            )
        };

        for segment in segments {
            // Events from earlier iterations ran before this segment's text
            // was produced: bind them to the most recent message.
            while pending_events
                .peek()
                .map(|te| te.iteration < segment.iteration)
                .unwrap_or(false)
            {
                let te = pending_events.next().expect("peeked event");
                tool_events.push(persist_event(te, &bind_message_id)?);
            }
            let has_reasoning = segment
                .reasoning
                .as_deref()
                .map(|r| !r.trim().is_empty())
                .unwrap_or(false);
            if segment.content.trim().is_empty() && !has_reasoning {
                continue;
            }
            let message = if let Some(message_id) = segment.message_id.as_deref() {
                Self::update_message_progress(
                    message_id,
                    &segment.content,
                    segment.reasoning.as_deref(),
                )?
            } else {
                Self::insert_message(
                    session_id,
                    "assistant",
                    &segment.content,
                    segment.reasoning.as_deref(),
                    Some(provider_id),
                    Some(model_id),
                    Some(effort_level),
                )?
            };
            bind_message_id = message.id.clone();
            assistant_message = Some(message);
        }
        // Remaining events came from iterations at or after the last persisted
        // segment: bind them to the last inserted message.
        for te in pending_events {
            tool_events.push(persist_event(te, &bind_message_id)?);
        }
        Ok((assistant_message, tool_events))
    }

    pub fn insert_message(
        session_id: &str,
        role: &str,
        content: &str,
        reasoning: Option<&str>,
        provider_id: Option<&str>,
        model_id: Option<&str>,
        effort_level: Option<&str>,
    ) -> DbResult<NativeChatMessage> {
        let conn = StorageService::connect()?;
        let sort_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM native_chat_messages WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let message = NativeChatMessage {
            id: gen_id("nmsg"),
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            reasoning: reasoning.map(str::to_string),
            sort_order,
            provider_id: provider_id.map(str::to_string),
            model_id: model_id.map(str::to_string),
            effort_level: effort_level.map(str::to_string),
            created_at: now_seconds(),
        };
        conn.execute(
            "INSERT INTO native_chat_messages (id, session_id, role, content, reasoning, sort_order, provider_id, model_id, effort_level, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
                message.reasoning,
                message.sort_order,
                message.provider_id,
                message.model_id,
                message.effort_level,
                message.created_at,
            ],
        )
        .map_err(|e| format!("Failed to save native chat message: {e}"))?;
        Ok(message)
    }

    /// Checkpoint an in-flight assistant message. The row is created before a
    /// provider request starts, then updated as text and reasoning arrive so a
    /// process exit cannot erase the visible work completed so far.
    pub(crate) fn update_message_progress(
        message_id: &str,
        content: &str,
        reasoning: Option<&str>,
    ) -> DbResult<NativeChatMessage> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE native_chat_messages SET content = ?1, reasoning = ?2 WHERE id = ?3",
            params![content, reasoning, message_id],
        )
        .map_err(|e| format!("Failed to checkpoint native chat message: {e}"))?;
        conn.query_row(
            "SELECT id, session_id, role, content, reasoning, sort_order, provider_id, model_id, effort_level, created_at
             FROM native_chat_messages WHERE id = ?1",
            params![message_id],
            map_message,
        )
        .map_err(|e| format!("Failed to reload native chat checkpoint: {e}"))
    }

    pub(crate) fn delete_message(message_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM native_chat_messages WHERE id = ?1 AND role = 'assistant'",
            params![message_id],
        )
        .map_err(|e| format!("Failed to remove empty native chat checkpoint: {e}"))?;
        Ok(())
    }

    /// Roll back a steering row that was persisted before the running loop
    /// declined it. Scoped to user rows so it can never delete assistant
    /// output, and used only by `steer`.
    fn delete_steer_message(message_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM native_chat_messages WHERE id = ?1 AND role = 'user'",
            params![message_id],
        )
        .map_err(|e| format!("Failed to roll back native chat steering message: {e}"))?;
        Ok(())
    }

    fn insert_tool_event(
        session_id: &str,
        message_id: Option<&str>,
        kind: &str,
        status: &str,
        summary: &str,
        arguments: Option<&str>,
        diff: Option<&str>,
        decision: Option<&str>,
        rule_source: Option<&str>,
    ) -> DbResult<NativeToolEvent> {
        Self::upsert_tool_event(
            &gen_id("ntool"),
            session_id,
            message_id,
            kind,
            status,
            summary,
            arguments,
            diff,
            decision,
            rule_source,
        )
    }

    /// Persist a live tool event under the provider's stable tool-call id.
    /// Later status updates replace the same row instead of creating duplicate
    /// pending/running/completed cards.
    pub(crate) fn upsert_tool_event(
        event_id: &str,
        session_id: &str,
        message_id: Option<&str>,
        kind: &str,
        status: &str,
        summary: &str,
        arguments: Option<&str>,
        diff: Option<&str>,
        decision: Option<&str>,
        rule_source: Option<&str>,
    ) -> DbResult<NativeToolEvent> {
        let conn = StorageService::connect()?;
        let created_at = now_seconds();
        // Provider tool-call ids are stable only within a conversation. Scope
        // the primary key to the session so two providers cannot overwrite
        // each other's persisted tool history by reusing an id.
        let persisted_id = format!("{session_id}:{event_id}");
        conn.execute(
            "INSERT INTO native_tool_events (
                id, session_id, message_id, kind, status, summary, arguments,
                diff, decision, rule_source, sequence, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                (SELECT COALESCE(MAX(sequence), 0) + 1 FROM native_tool_events WHERE session_id = ?2),
                ?11
             )
             ON CONFLICT(id) DO UPDATE SET
                message_id = COALESCE(excluded.message_id, native_tool_events.message_id),
                kind = excluded.kind,
                status = excluded.status,
                summary = excluded.summary,
                arguments = COALESCE(excluded.arguments, native_tool_events.arguments),
                diff = COALESCE(excluded.diff, native_tool_events.diff),
                decision = COALESCE(excluded.decision, native_tool_events.decision),
                rule_source = COALESCE(excluded.rule_source, native_tool_events.rule_source)",
            params![
                persisted_id,
                session_id,
                message_id,
                kind,
                status,
                summary,
                arguments,
                diff,
                decision,
                rule_source,
                created_at,
            ],
        )
        .map_err(|e| format!("Failed to checkpoint native tool event: {e}"))?;
        conn.query_row(
            "SELECT id, session_id, message_id, kind, status, summary, arguments, diff, decision, rule_source, sequence, created_at
             FROM native_tool_events WHERE id = ?1",
            params![persisted_id],
            |row| {
                Ok(NativeToolEvent {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    message_id: row.get(2)?,
                    kind: row.get(3)?,
                    status: row.get(4)?,
                    summary: row.get(5)?,
                    arguments: row.get(6)?,
                    diff: row.get(7)?,
                    decision: row.get(8)?,
                    rule_source: row.get(9)?,
                    sequence: row.get(10)?,
                    created_at: row.get(11)?,
                })
            },
        )
        .map_err(|e| format!("Failed to reload native tool checkpoint: {e}"))
    }

    pub fn list_tool_events(session_id: &str) -> DbResult<Vec<NativeToolEvent>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, message_id, kind, status, summary, arguments, diff, decision, rule_source, sequence, created_at
                 FROM native_tool_events WHERE session_id = ?1 ORDER BY sequence ASC, created_at ASC",
            )
            .map_err(|e| format!("Failed to prepare tool event query: {e}"))?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(NativeToolEvent {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    message_id: row.get(2)?,
                    kind: row.get(3)?,
                    status: row.get(4)?,
                    summary: row.get(5)?,
                    arguments: row.get(6)?,
                    diff: row.get(7)?,
                    decision: row.get(8)?,
                    rule_source: row.get(9)?,
                    sequence: row.get(10)?,
                    created_at: row.get(11)?,
                })
            })
            .map_err(|e| format!("Failed to query tool events: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect tool events: {e}"))
    }
    /// Resolve the provider's subscription/tier for per-message usage sync.
    /// Reads the declared per-provider plan map from settings
    /// (`usage.provider_plans` in app_defaults): a JSON object keyed by
    /// provider id → `{ "tier": "...", "planName": "..." }`. Returns
    /// `(tier, source, plan_name)`; falls back to `(None, "unknown", None)`
    /// when nothing is declared for the provider.
    fn resolve_subscription(provider_id: &str) -> (Option<String>, Option<String>, Option<String>) {
        if let Ok(conn) = StorageService::connect() {
            let raw: Option<String> = conn
                .query_row(
                    "SELECT value FROM app_defaults WHERE key = 'usage.provider_plans'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            if let Some(raw) = raw {
                if let Ok(map) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(entry) = map.get(provider_id) {
                        let tier = entry
                            .get("tier")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(str::to_string);
                        if tier.is_some() {
                            let plan_name = entry
                                .get("planName")
                                .and_then(|v| v.as_str())
                                .map(str::to_string);
                            return (tier, Some("declared".to_string()), plan_name);
                        }
                    }
                }
            }
        }
        (None, Some("unknown".to_string()), None)
    }

    fn insert_metric(metric: &NativeRequestMetric) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_request_metrics (
                id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                subscription_tier, subscription_source, plan_name, account_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                metric.id,
                metric.session_id,
                metric.provider_id,
                metric.model_id,
                metric.effort_level,
                metric.started_at,
                metric.completed_at,
                metric.duration_ms,
                metric.ttft_ms,
                metric.ttlt_ms,
                metric.input_tokens,
                metric.output_tokens,
                metric.cache_read_tokens,
                metric.cache_write_tokens,
                metric.tokens_per_second,
                metric.cost_total,
                metric.outcome,
                metric.error_class,
                metric.created_at,
                metric.subscription_tier,
                metric.subscription_source,
                metric.plan_name,
                metric.account_id,
            ],
        )
        .map_err(|e| format!("Failed to save native request metrics: {e}"))?;
        Ok(())
    }

    fn touch_session(session_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE native_chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![now_seconds(), session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Auto-title a native chat session from its first user message.
    /// Only updates sessions still on a default title ("Native Chat" or "New Chat").
    /// No-ops if the session has a custom title or doesn't exist.
    fn auto_title_native(session_id: &str, suggested: &str) -> DbResult<bool> {
        if suggested.trim().is_empty() {
            return Ok(false);
        }
        let conn = StorageService::connect()?;
        Self::auto_title_native_with_conn(&conn, session_id, suggested)
    }

    /// Connection-receiving variant for callers that already hold a
    /// `Connection` — notably `backfill_default_titles`, which runs inside
    /// `StorageService::initialize()` while `INITIALIZED_DBS` is locked.
    /// Calling `StorageService::connect()` there would re-enter the lock and
    /// deadlock (parking_lot::Mutex is not reentrant).
    fn auto_title_native_with_conn(
        conn: &Connection,
        session_id: &str,
        suggested: &str,
    ) -> DbResult<bool> {
        let current: Option<String> = conn
            .query_row(
                "SELECT title FROM native_chat_sessions WHERE id = ?1",
                params![session_id],
                |r| r.get::<_, String>(0),
            )
            .ok();
        let Some(current_title) = current else {
            return Ok(false);
        };
        // Only auto-title sessions still on a default placeholder title.
        if current_title != "Native Chat" && current_title != "New Chat" {
            return Ok(false);
        }
        let humanized = humanize_title(suggested);
        let truncated = crate::services::session_service::truncate_title(&humanized, 60);
        conn.execute(
            "UPDATE native_chat_sessions SET title = ?1 WHERE id = ?2",
            params![truncated, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Backfill titles for existing native chat sessions that still have a
    /// default placeholder title. Reads the first user message for each
    /// session and generates a title from it. Called during initialization.
    pub fn backfill_default_titles(conn: &Connection) -> DbResult<()> {
        let session_ids: Vec<(String, String)> = conn
            .prepare(
                "SELECT s.id, COALESCE((
                    SELECT m.content FROM native_chat_messages m
                    WHERE m.session_id = s.id AND m.role = 'user'
                    ORDER BY m.sort_order ASC LIMIT 1
                ), '') as first_msg
                 FROM native_chat_sessions s
                 WHERE s.title = 'Native Chat' OR s.title = 'New Chat'",
            )
            .map_err(|e| e.to_string())?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (session_id, first_msg) in session_ids {
            if !first_msg.is_empty() {
                let _ = Self::auto_title_native_with_conn(conn, &session_id, &first_msg);
            }
        }
        Ok(())
    }

    /// Build the system prompt for a turn: harness identity, project path, and
    /// optionally the project schematic (clipped) for grounding. Reads the
    /// `chat_system` prompt from PlanningPromptService (compiled default or
    /// user override) and substitutes {project_path}/{schematic} placeholders.
    pub fn system_prompt(project_path: &str, schematic: Option<&str>) -> String {
        let template = crate::services::planning_prompt_service::PlanningPromptService::get(
            crate::models::planning_prompt::CHAT_SYSTEM,
        )
        .unwrap_or_default();
        let schematic_text = schematic
            .map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    String::new()
                } else {
                    s.chars().take(4000).collect::<String>()
                }
            })
            .unwrap_or_default();
        template
            .replace("{project_path}", project_path)
            .replace("{schematic}", &schematic_text)
    }

    /// Parse a provider response into structured ideas. Extracts the first JSON
    /// array and reads `title`/`description` from each object; tolerant of
    /// Parse the model's response into a list of ideas, tolerating
    /// surrounding prose or code fences.
    pub fn parse_ideas(raw: &str) -> Vec<NativeGeneratedIdea> {
        let text = raw.trim();
        let (start, end) = match (text.find('['), text.rfind(']')) {
            (Some(s), Some(e)) if e > s => (s, e),
            _ => return vec![],
        };
        let parsed: Value = match serde_json::from_str(&text[start..=end]) {
            Ok(v) => v,
            Err(_) => return vec![],
        };
        let arr = match parsed.as_array() {
            Some(a) => a,
            None => return vec![],
        };
        arr.iter()
            .filter_map(|item| {
                let title = item
                    .get("title")
                    .and_then(Value::as_str)?
                    .trim()
                    .to_string();
                if title.is_empty() {
                    return None;
                }
                let description = item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let grounding = item
                    .get("grounding")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let anchor = item
                    .get("anchor")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let assessment = item
                    .get("assessment")
                    .cloned()
                    .and_then(|value| serde_json::from_value(value).ok());
                Some(NativeGeneratedIdea {
                    title,
                    description,
                    grounding,
                    anchor,
                    assessment,
                })
            })
            .collect()
    }
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeChatSession> {
    Ok(NativeChatSession {
        id: row.get(0)?,
        project_path: row.get(1)?,
        title: row.get(2)?,
        profile_id: row.get(3)?,
        provider_id: row.get(4)?,
        model_id: row.get(5)?,
        effort_level: row.get(6)?,
        status: row.get(7)?,
        run_state: row
            .get::<_, Option<String>>(8)?
            .unwrap_or_else(|| "idle".to_string()),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_history_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeChatHistoryEntry> {
    Ok(NativeChatHistoryEntry {
        id: row.get(0)?,
        project_path: row.get(1)?,
        title: row.get(2)?,
        profile_id: row.get(3)?,
        provider_id: row.get(4)?,
        model_id: row.get(5)?,
        effort_level: row.get(6)?,
        status: row.get(7)?,
        run_state: row
            .get::<_, Option<String>>(8)?
            .unwrap_or_else(|| "idle".to_string()),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        message_count: row.get(11)?,
    })
}

fn map_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeChatMessage> {
    Ok(NativeChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        reasoning: row.get(4)?,
        sort_order: row.get(5)?,
        provider_id: row.get(6)?,
        model_id: row.get(7)?,
        effort_level: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn map_metric(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeRequestMetric> {
    Ok(NativeRequestMetric {
        id: row.get(0)?,
        session_id: row.get(1)?,
        provider_id: row.get(2)?,
        model_id: row.get(3)?,
        effort_level: row.get(4)?,
        started_at: row.get(5)?,
        completed_at: row.get(6)?,
        duration_ms: row.get(7)?,
        ttft_ms: row.get(8)?,
        ttlt_ms: row.get(9)?,
        input_tokens: row.get(10)?,
        output_tokens: row.get(11)?,
        cache_read_tokens: row.get(12)?,
        cache_write_tokens: row.get(13)?,
        tokens_per_second: row.get(14)?,
        cost_total: row.get(15)?,
        outcome: row.get(16)?,
        error_class: row.get(17)?,
        created_at: row.get(18)?,
        subscription_tier: row.get(19)?,
        subscription_source: row.get(20)?,
        plan_name: row.get(21)?,
        account_id: row.get(22)?,
    })
}

/// Detect an agent-loop run that failed before any output streamed: not
/// completed/cancelled/capped, no tool activity, and exactly one first-
/// iteration segment holding only the terminal error text. Returns the error
/// message for health classification. Anything mid-stream returns None —
/// those surface the error instead of silently retrying.
fn pre_stream_failure(
    run_result: &crate::services::agent_loop_service::RunResult,
) -> Option<String> {
    if run_result.completed || run_result.cancelled || run_result.hit_cap {
        return None;
    }
    if !run_result.tool_events.is_empty() || run_result.segments.len() != 1 {
        return None;
    }
    let segment = &run_result.segments[0];
    if segment.iteration != 1 || segment.reasoning.is_some() {
        return None;
    }
    segment.content.strip_prefix("Error: ").map(str::to_string)
}

fn gen_id(prefix: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}_{ts:x}")
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Active OMP agent directory. The cache is explicitly invalidated after an
/// OMP login so profile changes and newly-created databases are visible in the
/// running process.
static OMP_AGENT_DIR: std::sync::LazyLock<RwLock<Option<std::path::PathBuf>>> =
    std::sync::LazyLock::new(|| RwLock::new(None));

fn resolve_omp_agent_dir() -> std::path::PathBuf {
    use crate::services::process_helpers::hidden_command;
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    let default = home
        .as_ref()
        .map(|h| std::path::Path::new(h).join(".omp/agent"))
        .unwrap_or_default();
    let output = hidden_command("omp").args(["config", "path"]).output();
    match output {
        Ok(o) if o.status.success() => {
            let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if path.is_empty() {
                default
            } else {
                std::path::PathBuf::from(path)
            }
        }
        _ => default,
    }
}

/// Map an OMP provider id to the matching Basebuild catalog provider.
fn omp_to_basebuild_provider(omp_id: &str) -> Option<String> {
    model_catalog::provider_ids()
        .contains(&omp_id)
        .then(|| omp_id.to_string())
}

/// OAuth token cache: (token, fetched_at). TTL prevents per-send CLI spawns.
/// ponytail: 5-min TTL; OAuth tokens typically last 1h, refresh handled by omp.
static OAUTH_TOKEN_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));
const OAUTH_TOKEN_TTL_SECS: u64 = 300;

/// Get a live OAuth token for an OMP provider via `omp token <provider>`.
/// Cached for 5 min to avoid spawning a process on every send. Returns None
/// on any failure (expired refresh token, omp not found, etc.) — the caller
/// skips the credential, preserving the setup-required prompt.
fn omp_oauth_token(omp_provider: &str) -> Option<String> {
    {
        let cache = OAUTH_TOKEN_CACHE.lock().ok()?;
        if let Some((token, fetched_at)) = cache.get(omp_provider) {
            if fetched_at.elapsed().as_secs() < OAUTH_TOKEN_TTL_SECS {
                return Some(token.clone());
            }
        }
    }
    use crate::services::process_helpers::hidden_command;
    let output = hidden_command("omp")
        .args(["token", omp_provider])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return None;
    }
    if let Ok(mut cache) = OAUTH_TOKEN_CACHE.lock() {
        cache.insert(
            omp_provider.to_string(),
            (token.clone(), std::time::Instant::now()),
        );
    }
    Some(token)
}

pub(crate) fn omp_agent_dir() -> std::path::PathBuf {
    if let Some(path) = OMP_AGENT_DIR.read().clone() {
        return path;
    }
    let path = resolve_omp_agent_dir();
    *OMP_AGENT_DIR.write() = Some(path.clone());
    path
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.split_whitespace().count().max(1) as i64
    }
}

fn existing_planning_work_context(
    ideas: &[crate::models::idea::Idea],
    plans: &[crate::models::plan::Plan],
) -> String {
    ideas
        .iter()
        .take(50)
        .map(|idea| format!("- idea [{}]: {}", idea.status.as_str(), idea.title))
        .chain(
            plans
                .iter()
                .take(50)
                .map(|plan| format!("- plan [{}]: {}", plan.status.as_str(), plan.title)),
        )
        .collect::<Vec<_>>()
        .join("\n")
}

/// Turn a raw first message into a human-readable auto-title. Command
/// invocations like `<command name="/skill:basebuild-sync">…</command>`
/// previously truncated into markup garbage; extract the command name
/// instead. For plain messages, strip any `<…>` tag spans and collapse
/// whitespace. Falls back to the trimmed raw text when stripping leaves
/// nothing.
fn humanize_title(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("<command") {
        if let Some(name_start) = trimmed.find("name=\"").map(|pos| pos + "name=\"".len()) {
            if let Some(name_len) = trimmed[name_start..].find('"') {
                let name = trimmed[name_start..name_start + name_len].trim_start_matches('/');
                if let Some(skill) = name.strip_prefix("skill:") {
                    if !skill.is_empty() {
                        return format!("Skill: {skill}");
                    }
                }
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    let mut stripped = String::with_capacity(trimmed.len());
    let mut in_tag = false;
    for ch in trimmed.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => stripped.push(ch),
            _ => {}
        }
    }
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        trimmed.to_string()
    } else {
        collapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::lock_db;

    #[test]
    fn humanize_title_extracts_skill_command_name() {
        assert_eq!(
            humanize_title(r#"<command name="/skill:basebuild-sync">sync now</command>"#),
            "Skill: basebuild-sync"
        );
        // Non-skill commands surface the bare command name.
        assert_eq!(
            humanize_title(r#"  <command name="/compact">everything</command>"#),
            "compact"
        );
    }

    #[test]
    fn humanize_title_passes_plain_text_through() {
        assert_eq!(
            humanize_title("  Fix the login redirect bug  "),
            "Fix the login redirect bug"
        );
    }

    #[test]
    fn humanize_title_strips_tags_and_collapses_whitespace() {
        assert_eq!(
            humanize_title("Please <b>review</b>\n\n the   <i>diff</i>"),
            "Please review the diff"
        );
        // Nothing but markup falls back to the trimmed raw text.
        assert_eq!(humanize_title("<br/>"), "<br/>");
    }
    #[test]
    fn provider_catalog_has_local_default_and_effort_levels() {
        let catalog = NativeChatService::provider_catalog();
        assert_eq!(catalog.default_provider_id, LOCAL_PROVIDER_ID);
        assert_eq!(catalog.default_model_id, "basebuild-local-coordinator");
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == LOCAL_PROVIDER_ID && provider.configured));
        assert!(catalog
            .effort_levels
            .iter()
            .any(|effort| effort.id == "xhigh"));
    }
    #[test]
    fn route_requires_omp_for_any_omp_owned_oauth_credential() {
        assert!(NativeChatService::route_requires_omp(
            "openai-responses",
            Some(crate::services::provider_client::OMP_CODEX_BASE_URL),
            "",
            false,
        ));
        assert!(NativeChatService::route_requires_omp(
            "anthropic-messages",
            Some("omp://anthropic"),
            "https://api.anthropic.com/v1",
            false,
        ));
        assert!(!NativeChatService::route_requires_omp(
            "openai-responses",
            Some(crate::services::provider_client::NATIVE_CODEX_BASE_URL),
            "",
            false,
        ));
    }

    #[test]
    fn route_requires_omp_refuses_unsupported_kind_without_endpoint() {
        assert!(NativeChatService::route_requires_omp(
            "cursor-agent",
            None,
            "",
            false
        ));
        assert!(NativeChatService::route_requires_omp(
            "openai-codex-responses",
            None,
            "",
            false
        ));
    }

    #[test]
    fn route_requires_omp_allows_native_kinds_and_escape_hatches() {
        for kind in [
            "openai-completions",
            "openai-responses",
            "azure-openai-responses",
            "anthropic-messages",
            "openrouter",
            "devin-agent",
            "ollama-chat",
        ] {
            assert!(
                !NativeChatService::route_requires_omp(kind, None, "", false),
                "{kind} is native"
            );
        }
        // An explicit credential endpoint remains the compatibility escape
        // hatch for a provider exposed through an OpenAI-compatible proxy.
        assert!(!NativeChatService::route_requires_omp(
            "cursor-agent",
            Some("https://compatible.example/v1"),
            "",
            false
        ));
        // Unknown protocol kinds may likewise declare a compatible catalog
        // endpoint; known native Devin does not depend on this escape hatch.
        assert!(!NativeChatService::route_requires_omp(
            "custom-openai",
            None,
            "https://compatible.example/v1",
            false
        ));
        // Local coordinator never routes through OMP.
        assert!(!NativeChatService::route_requires_omp("", None, "", true));
    }

    #[test]
    fn resolve_model_default_falls_back_when_no_project_or_global_default() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let resolved = NativeChatService::resolve_model_default("/test/no-defaults").unwrap();
        assert_eq!(resolved.source, "fallback");
        assert!(resolved.notice.is_none());
        assert!(!resolved.provider_id.is_empty());
        assert!(!resolved.model_id.is_empty());
    }

    #[test]
    fn resolve_model_default_uses_project_default_when_set() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let project_path = "/test/project-default";
        let default = ChatModelDefault {
            provider_id: LOCAL_PROVIDER_ID.to_string(),
            model_id: "basebuild-local-coordinator".to_string(),
            effort_level: "medium".to_string(),
        };
        NativeChatService::set_project_model_default(project_path, &default).unwrap();
        let resolved = NativeChatService::resolve_model_default(project_path).unwrap();
        assert_eq!(resolved.source, "project");
        assert_eq!(resolved.provider_id, LOCAL_PROVIDER_ID);
        assert_eq!(resolved.model_id, "basebuild-local-coordinator");
        assert!(resolved.notice.is_none());
    }

    #[test]
    fn resolve_model_default_falls_back_when_project_default_unavailable() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let project_path = "/test/project-unavailable";
        let default = ChatModelDefault {
            provider_id: "nonexistent-provider".to_string(),
            model_id: "nonexistent-model".to_string(),
            effort_level: "high".to_string(),
        };
        NativeChatService::set_project_model_default(project_path, &default).unwrap();
        let resolved = NativeChatService::resolve_model_default(project_path).unwrap();
        assert_eq!(resolved.source, "fallback");
        assert!(resolved.notice.is_some());
        assert!(resolved
            .notice
            .as_ref()
            .unwrap()
            .contains("nonexistent-provider"));
    }

    /// Builds an OMP-shaped `agent.db` fixture in a temp dir so the credential
    /// reader can be exercised deterministically on any machine, with or
    /// without OMP installed.
    fn write_omp_fixture_db(
        db_path: &std::path::Path,
        rows: &[(&str, &str, &str, Option<&str>, i64)],
    ) {
        let conn = Connection::open(db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE auth_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                credential_type TEXT NOT NULL,
                data TEXT NOT NULL,
                disabled_cause TEXT,
                updated_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        for (provider, cred_type, data, disabled_cause, updated_at) in rows {
            conn.execute(
                "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![provider, cred_type, data, disabled_cause, updated_at],
            )
            .unwrap();
        }
    }

    #[test]
    fn omp_credentials_maps_dedupes_and_filters_api_key_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("agent.db");
        write_omp_fixture_db(
            &db_path,
            &[
                ("umans", "api_key", r#"{"key":"sk-old"}"#, None, 100),
                ("umans", "api_key", r#"{"key":"sk-new"}"#, None, 200),
                ("anthropic", "api_key", r#"{"key":"sk-ant"}"#, None, 150),
                (
                    "anthropic",
                    "api_key",
                    r#"{"key":"sk-revoked"}"#,
                    Some("revoked"),
                    300,
                ),
                (
                    "mystery-provider",
                    "api_key",
                    r#"{"key":"sk-x"}"#,
                    None,
                    100,
                ),
                ("openai", "api_key", r#"{"key":""}"#, None, 100),
            ],
        );

        let creds = NativeChatService::omp_credentials_from(&db_path, false);
        assert_eq!(creds.len(), 2, "expected only umans + anthropic: {creds:?}");
        let umans = creds
            .iter()
            .find(|c| c.provider_id == "umans")
            .expect("umans mapped");
        assert_eq!(umans.api_key, "sk-new", "newest active row should win");
        assert!(
            umans.base_url.is_none(),
            "api_key rows must not get the OMP Codex base_url tag"
        );
        let anthropic = creds
            .iter()
            .find(|c| c.provider_id == "anthropic")
            .expect("anthropic mapped");
        assert_eq!(
            anthropic.api_key, "sk-ant",
            "disabled row must not shadow the active one"
        );
    }

    #[test]
    fn omp_credentials_missing_db_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(
            NativeChatService::omp_credentials_from(&dir.path().join("agent.db"), false).is_empty()
        );
    }

    #[test]
    fn omp_provider_ids_preserve_catalog_identity() {
        assert_eq!(
            omp_to_basebuild_provider("openai-codex"),
            Some("openai-codex".to_string())
        );
        assert_eq!(
            omp_to_basebuild_provider("openai"),
            Some("openai".to_string())
        );
        assert_eq!(
            omp_to_basebuild_provider("anthropic"),
            Some("anthropic".to_string())
        );
        assert_eq!(
            omp_to_basebuild_provider("umans"),
            Some("umans".to_string())
        );
        assert_eq!(
            omp_to_basebuild_provider("devin"),
            Some("devin".to_string())
        );
        assert_eq!(omp_to_basebuild_provider("groq"), Some("groq".to_string()));
        assert_eq!(omp_to_basebuild_provider("something-else"), None);
    }

    #[test]
    fn try_resolve_clamps_unsupported_effort_to_supported() {
        let catalog = NativeChatService::provider_catalog();
        // Find a configured provider's model with restricted supported_efforts.
        let configured_providers: Vec<&str> = catalog
            .providers
            .iter()
            .filter(|p| p.configured)
            .map(|p| p.id.as_str())
            .collect();
        let Some(model) = catalog.models.iter().find(|m| {
            configured_providers.contains(&m.provider_id.as_str())
                && !m.supported_efforts.is_empty()
                && !m.supported_efforts.iter().any(|e| e == "medium")
        }) else {
            return; // No restricted-effort configured model — skip.
        };
        let default = ChatModelDefault {
            provider_id: model.provider_id.clone(),
            model_id: model.id.clone(),
            effort_level: "medium".to_string(),
        };
        let resolved = NativeChatService::try_resolve(&catalog, &default, "test");
        let resolved = resolved.expect("configured model should resolve");
        assert_ne!(resolved.effort_level, "medium");
        assert!(model.supported_efforts.contains(&resolved.effort_level));
    }

    #[test]
    fn update_session_model_persists_and_rejects_invalid() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session = NativeChatService::start_session(NativeChatStartRequest {
            project_path: "/test/update-session".to_string(),
            title: Some("Test".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();

        // Update to a (valid) local model with a different effort.
        let updated = NativeChatService::update_session_model(
            &session.id,
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "high",
        )
        .unwrap();
        assert_eq!(updated.effort_level, "high");

        // Re-read to confirm persistence.
        let reread = NativeChatService::get_session(&session.id)
            .unwrap()
            .unwrap();
        assert_eq!(reread.effort_level, "high");

        // Invalid provider/model pair should be rejected.
        let err = NativeChatService::update_session_model(
            &session.id,
            "nonexistent-provider",
            "nonexistent-model",
            "medium",
        );
        assert!(err.is_err(), "invalid provider/model should be rejected");

        // Nonexistent session should error.
        let err = NativeChatService::update_session_model(
            "no-such-session",
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "medium",
        );
        assert!(err.is_err(), "nonexistent session should error");
    }
    #[test]
    fn clear_session_messages_deletes_messages_and_tool_events() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session = NativeChatService::start_session(NativeChatStartRequest {
            project_path: "/test/clear".to_string(),
            title: Some("Clear Test".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();

        // Insert two messages and a tool event.
        NativeChatService::insert_message(
            &session.id,
            "user",
            "hello",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        NativeChatService::insert_message(
            &session.id,
            "assistant",
            "hi there",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        NativeChatService::insert_tool_event(
            &session.id,
            None,
            "test_tool",
            "ok",
            "ran",
            None,
            None,
            None,
            None,
        );

        // Verify they exist.
        assert_eq!(
            NativeChatService::list_messages(&session.id).unwrap().len(),
            2
        );
        assert_eq!(
            NativeChatService::list_tool_events(&session.id)
                .unwrap()
                .len(),
            1
        );

        // Clear and verify deletion count.
        let deleted = NativeChatService::clear_session_messages(&session.id).unwrap();
        assert_eq!(deleted, 2, "should delete 2 messages");
        assert_eq!(
            NativeChatService::list_messages(&session.id).unwrap().len(),
            0
        );
        assert_eq!(
            NativeChatService::list_tool_events(&session.id)
                .unwrap()
                .len(),
            0
        );

        // Session record itself should still exist (provider/model/effort preserved).
        let reread = NativeChatService::get_session(&session.id)
            .unwrap()
            .unwrap();
        assert_eq!(reread.provider_id, LOCAL_PROVIDER_ID);
        assert_eq!(reread.model_id, "basebuild-local-coordinator");
        assert_eq!(reread.effort_level, "medium");

        // Clearing an already-empty session should return 0.
        let deleted2 = NativeChatService::clear_session_messages(&session.id).unwrap();
        assert_eq!(deleted2, 0);
    }

    #[test]
    fn chat_history_returns_cross_project_sessions_with_counts_newest_first() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);

        let older = NativeChatService::start_session(NativeChatStartRequest {
            project_path: "/test/history-a".to_string(),
            title: Some("Older".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();
        // Ensure distinct updated_at values so ORDER BY is deterministic.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        NativeChatService::insert_message(
            &older.id,
            "user",
            "hello",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        NativeChatService::insert_message(
            &older.id,
            "assistant",
            "hi",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();

        let newer = NativeChatService::start_session(NativeChatStartRequest {
            project_path: "/test/history-b".to_string(),
            title: Some("Newer".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();
        NativeChatService::insert_message(
            &newer.id,
            "user",
            "only one",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        // Force deterministic ordering: newer must sort before older.
        StorageService::connect()
            .unwrap()
            .execute(
                "UPDATE native_chat_sessions SET updated_at = ?1 WHERE id = ?2",
                params![older.updated_at + 10, newer.id],
            )
            .unwrap();

        let all = NativeChatService::chat_history(None).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].title, "Newer");
        assert_eq!(all[0].message_count, 1);
        assert_eq!(all[1].title, "Older");
        assert_eq!(all[1].message_count, 2);

        let limited = NativeChatService::chat_history(Some(1)).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].title, "Newer");
    }
    #[test]
    fn delete_credential_blocks_omp_credentials() {
        // delete_credential should add the provider to native_blocked_providers
        // so OMP-imported credentials don't reappear after disconnect.
        // This test verifies the block is created; the full list_credentials
        // behavior with OMP merge is tested via the e2e flow.
        let _home = crate::test_util::test::isolated_home();
        let conn = StorageService::connect().unwrap();

        // Insert a credential for "umans".
        conn.execute(
            "INSERT INTO native_provider_credentials (provider_id, label, api_key, base_url, updated_at)
             VALUES ('umans', 'test', 'sk-test', NULL, 100)",
            [],
        )
        .unwrap();

        // Delete it (should also block).
        NativeChatService::delete_credential("umans").unwrap();

        // The Basebuild credential should be gone.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_provider_credentials WHERE provider_id = 'umans'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "Basebuild credential should be deleted");

        // The block should exist.
        let blocked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_blocked_providers WHERE provider_id = 'umans'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(blocked, 1, "umans should be blocked after disconnect");

        // list_credentials should not return umans even if OMP has it.
        let creds = NativeChatService::list_credentials().unwrap();
        assert!(
            !creds.iter().any(|c| c.provider_id == "umans"),
            "blocked provider should not appear in list_credentials"
        );
    }

    #[test]
    fn save_credential_unblocks_provider() {
        let _home = crate::test_util::test::isolated_home();
        let conn = StorageService::connect().unwrap();

        // Block umans first (simulate a prior disconnect).
        conn.execute(
            "INSERT INTO native_blocked_providers (provider_id, blocked_at) VALUES ('umans', 100)",
            [],
        )
        .unwrap();

        // Save a new credential (should unblock).
        NativeChatService::save_credential(
            crate::models::native_chat::NativeProviderCredentialInput {
                provider_id: "umans".to_string(),
                label: "test".to_string(),
                api_key: "sk-new".to_string(),
                base_url: None,
            },
        )
        .unwrap();

        // The block should be gone.
        let blocked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_blocked_providers WHERE provider_id = 'umans'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            blocked, 0,
            "umans should be unblocked after saving a new credential"
        );

        // The credential should be present (either the Basebuild one or the
        // OMP-imported one — what matters is the provider is no longer blocked).
        let creds = NativeChatService::list_credentials().unwrap();
        assert!(
            creds.iter().any(|c| c.provider_id == "umans"),
            "umans credential should be visible after unblock (got {} creds)",
            creds.len()
        );
    }

    #[test]
    fn latest_metric_is_scoped_to_the_requested_session() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        for session_id in ["session-a", "session-b"] {
            conn.execute(
                "INSERT INTO native_chat_sessions (
                    id, project_path, title, profile_id, provider_id, model_id,
                    effort_level, status, run_state, created_at, updated_at
                 ) VALUES (?1, '/test/project', 'Chat', 'basebuild-native',
                    'basebuild-local', 'basebuild-local-coordinator', 'medium',
                    'ready', 'idle', 1, 1)",
                params![session_id],
            )
            .unwrap();
        }
        for (id, session_id, created_at, input_tokens, output_tokens) in [
            ("metric-a-old", "session-a", 10, 100, 20),
            ("metric-b", "session-b", 30, 900, 90),
            ("metric-a-new", "session-a", 40, 240, 60),
        ] {
            conn.execute(
                "INSERT INTO native_request_metrics (
                    id, session_id, provider_id, model_id, effort_level,
                    started_at, input_tokens, output_tokens, outcome, created_at
                 ) VALUES (?1, ?2, 'basebuild-local', 'basebuild-local-coordinator',
                    'medium', ?3, ?4, ?5, 'success', ?3)",
                params![id, session_id, created_at, input_tokens, output_tokens],
            )
            .unwrap();
        }

        let latest = NativeChatService::latest_metric_for_session("session-a")
            .unwrap()
            .expect("session metric");
        assert_eq!(latest.id, "metric-a-new");
        assert_eq!(latest.input_tokens, 240);
        assert_eq!(latest.output_tokens, 60);
        assert!(NativeChatService::latest_metric_for_session("missing")
            .unwrap()
            .is_none());
    }

    fn segment(content: &str, reasoning: Option<&str>, iteration: usize) -> TurnSegment {
        TurnSegment {
            content: content.to_string(),
            reasoning: reasoning.map(str::to_string),
            iteration,
            message_id: None,
        }
    }

    fn event_record(tool_name: &str, iteration: usize) -> ToolEventRecord {
        ToolEventRecord {
            tool_name: tool_name.to_string(),
            status: "ok".to_string(),
            summary: "ran".to_string(),
            arguments: None,
            duration_ms: 0,
            decision: "approved".to_string(),
            rule_source: None,
            diff: None,
            iteration,
            tool_call_id: format!("tool-{iteration}-{tool_name}"),
        }
    }

    fn start_persist_session(project_path: &str) -> (NativeChatSession, NativeChatMessage) {
        let session = NativeChatService::start_session(NativeChatStartRequest {
            project_path: project_path.to_string(),
            title: Some("Persist Test".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();
        let user = NativeChatService::insert_message(
            &session.id,
            "user",
            "do the thing",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        (session, user)
    }

    #[test]
    fn persist_turn_segments_interleaves_messages_and_binds_events_per_iteration() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/persist-interleave");

        // Iteration 1 produced text then two tool calls; iteration 2 produced
        // only tool calls (no segment); iteration 3 produced the final answer.
        let segments = vec![
            segment("Let me look at the files.", Some("planning"), 1),
            segment("All done.", None, 3),
        ];
        let events = vec![
            event_record("read_file", 1),
            event_record("search", 1),
            event_record("write_file", 2),
        ];
        let (last, tool_events) = NativeChatService::persist_turn_segments(
            &session.id,
            &user.id,
            &segments,
            &events,
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "medium",
        )
        .unwrap();

        let messages = NativeChatService::list_messages(&session.id).unwrap();
        let assistants: Vec<_> = messages.iter().filter(|m| m.role == "assistant").collect();
        assert_eq!(
            assistants.len(),
            2,
            "one assistant row per text-producing iteration"
        );
        assert_eq!(assistants[0].content, "Let me look at the files.");
        assert_eq!(assistants[0].reasoning.as_deref(), Some("planning"));
        assert_eq!(assistants[1].content, "All done.");
        let last = last.expect("last assistant message");
        assert_eq!(
            last.id, assistants[1].id,
            "SendResult carries the LAST inserted message"
        );

        // Iteration 1 and 2 events all ran after the first segment's text and
        // before the final answer: bound to the first assistant message.
        assert_eq!(tool_events.len(), 3);
        for event in &tool_events {
            assert_eq!(event.message_id.as_deref(), Some(assistants[0].id.as_str()));
        }
        // No event is left unbound after the turn.
        let persisted = NativeChatService::list_tool_events(&session.id).unwrap();
        assert!(persisted.iter().all(|e| e.message_id.is_some()));
    }

    #[test]
    fn persisted_checkpoint_is_reused_without_duplicate_assistant_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/persist-checkpoint");
        let draft = NativeChatService::insert_message(
            &session.id,
            "assistant",
            "",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        NativeChatService::update_message_progress(
            &draft.id,
            "Partial answer",
            Some("Careful reasoning"),
        )
        .unwrap();
        let segments = vec![TurnSegment {
            content: "Final answer".to_string(),
            reasoning: Some("Careful reasoning".to_string()),
            iteration: 1,
            message_id: Some(draft.id.clone()),
        }];

        NativeChatService::persist_turn_segments(
            &session.id,
            &user.id,
            &segments,
            &[],
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "medium",
        )
        .unwrap();

        let messages = NativeChatService::list_messages(&session.id).unwrap();
        let assistants: Vec<_> = messages
            .iter()
            .filter(|message| message.role == "assistant")
            .collect();
        assert_eq!(assistants.len(), 1);
        assert_eq!(assistants[0].id, draft.id);
        assert_eq!(assistants[0].content, "Final answer");
        assert_eq!(
            assistants[0].reasoning.as_deref(),
            Some("Careful reasoning")
        );
    }

    #[test]
    fn startup_sweep_preserves_progress_and_interrupts_live_state() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, _user) = start_persist_session("/test/interrupted-checkpoint");
        let draft = NativeChatService::insert_message(
            &session.id,
            "assistant",
            "",
            None,
            Some(LOCAL_PROVIDER_ID),
            Some("basebuild-local-coordinator"),
            Some("medium"),
        )
        .unwrap();
        NativeChatService::update_message_progress(
            &draft.id,
            "Saved before shutdown",
            Some("Recovered thought"),
        )
        .unwrap();
        NativeChatService::upsert_tool_event(
            "live-tool",
            &session.id,
            Some(&draft.id),
            "read_file",
            "running",
            "Running read file",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "UPDATE native_chat_sessions SET run_state = 'running' WHERE id = ?1",
            params![session.id],
        )
        .unwrap();

        crate::services::agent_loop_service::sweep_interrupted_runs();

        let recovered = NativeChatService::get_session(&session.id)
            .unwrap()
            .expect("recovered session");
        assert_eq!(recovered.run_state, "interrupted");
        let messages = NativeChatService::list_messages(&session.id).unwrap();
        let saved = messages
            .iter()
            .find(|message| message.id == draft.id)
            .unwrap();
        assert_eq!(saved.content, "Saved before shutdown");
        assert_eq!(saved.reasoning.as_deref(), Some("Recovered thought"));
        let tools = NativeChatService::list_tool_events(&session.id).unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].status, "interrupted");
    }

    #[test]
    fn persist_turn_segments_cancelled_run_keeps_prior_segments_without_empty_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/persist-cancel");

        // Cancelled mid-turn: iteration 1 text + events survived, iteration 2
        // was cut off after its tool calls. An empty segment must not produce
        // an assistant row.
        let segments = vec![segment("Working on it.", None, 1), segment("", None, 2)];
        let events = vec![event_record("read_file", 1), event_record("bash", 2)];
        let (last, tool_events) = NativeChatService::persist_turn_segments(
            &session.id,
            &user.id,
            &segments,
            &events,
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "medium",
        )
        .unwrap();

        let messages = NativeChatService::list_messages(&session.id).unwrap();
        let assistants: Vec<_> = messages.iter().filter(|m| m.role == "assistant").collect();
        assert_eq!(assistants.len(), 1, "empty segment must not insert a row");
        assert_eq!(assistants[0].content, "Working on it.");
        assert_eq!(last.unwrap().id, assistants[0].id);
        assert_eq!(tool_events.len(), 2);
        for event in &tool_events {
            assert_eq!(event.message_id.as_deref(), Some(assistants[0].id.as_str()));
        }
    }

    #[test]
    fn persist_turn_segments_without_segments_binds_events_to_user_message() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/persist-no-segments");

        // Cancelled before any text streamed: no assistant rows at all, and
        // the iteration's events fall back to the user message.
        let (last, tool_events) = NativeChatService::persist_turn_segments(
            &session.id,
            &user.id,
            &[],
            &[event_record("read_file", 1)],
            LOCAL_PROVIDER_ID,
            "basebuild-local-coordinator",
            "medium",
        )
        .unwrap();

        assert!(last.is_none(), "no assistant message without segments");
        let messages = NativeChatService::list_messages(&session.id).unwrap();
        assert!(
            messages.iter().all(|m| m.role != "assistant"),
            "no empty assistant row on cancel"
        );
        assert_eq!(tool_events.len(), 1);
        assert_eq!(tool_events[0].message_id.as_deref(), Some(user.id.as_str()));
    }

    #[test]
    fn history_to_provider_messages_merges_consecutive_assistant_rows() {
        let row = |role: &str, content: &str, sort_order: i64| NativeChatMessage {
            id: format!("m{sort_order}"),
            session_id: "s".to_string(),
            role: role.to_string(),
            content: content.to_string(),
            reasoning: None,
            sort_order,
            provider_id: None,
            model_id: None,
            effort_level: None,
            created_at: 0,
        };
        let history = vec![
            row("user", "question", 1),
            row("assistant", "first pass", 2),
            row("assistant", "second pass", 3),
            row("system", "noise", 4),
            row("user", "follow-up", 5),
            row("assistant", "answer", 6),
        ];
        let messages = NativeChatService::history_to_provider_messages(&history);
        let shape: Vec<(&str, &str)> = messages
            .iter()
            .map(|m| (m.role.as_str(), m.content.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("user", "question"),
                ("assistant", "first pass\n\nsecond pass"),
                ("user", "follow-up"),
                ("assistant", "answer"),
            ],
            "consecutive assistant rows merge; providers never see back-to-back assistant messages"
        );
    }
    #[test]
    fn existing_planning_work_context_exposes_titles_and_statuses() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = lock_db(&directory);
        let session = crate::services::session_service::SessionService::create_session(
            "/test/existing-work",
            "Existing work",
        )
        .unwrap();
        crate::services::session_service::SessionService::create_idea(
            &session.id,
            "Avoid duplicate route",
            "Existing idea",
            None,
            "fixture",
            None,
            None,
            None,
        )
        .unwrap();
        crate::services::plan_service::PlanService::create(
            &session.id,
            &crate::models::plan::NewPlan {
                title: "Ship active planner".to_string(),
                description: "Existing plan".to_string(),
                goal: None,
                status: crate::models::plan::PlanStatus::Ready,
                priority: None,
                tags: vec![],
                idea_id: None,
            },
        )
        .unwrap();
        let ideas =
            crate::services::session_service::SessionService::list_ideas(&session.id).unwrap();
        let plans =
            crate::services::plan_service::PlanService::list_for_project("/test/existing-work")
                .unwrap();

        let context = existing_planning_work_context(&ideas, &plans);

        assert!(context.contains("idea [concept]: Avoid duplicate route"));
        assert!(context.contains("plan [ready]: Ship active planner"));
    }

    #[test]
    fn input_history_persists_and_lists_most_recent_first() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);

        // No history initially.
        assert_eq!(NativeChatService::list_input_history().unwrap(), Vec::<String>::new());

        NativeChatService::add_input_history("first message").unwrap();
        NativeChatService::add_input_history("second message").unwrap();
        NativeChatService::add_input_history("third message").unwrap();

        // Most-recent-first.
        let history = NativeChatService::list_input_history().unwrap();
        assert_eq!(history, vec!["third message", "second message", "first message"]);
    }

    #[test]
    fn input_history_deduplicates_by_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);

        NativeChatService::add_input_history("hello").unwrap();
        NativeChatService::add_input_history("world").unwrap();
        NativeChatService::add_input_history("hello").unwrap(); // re-send moves to newest

        let history = NativeChatService::list_input_history().unwrap();
        // "hello" should appear once, at the top (most recent).
        assert_eq!(history, vec!["hello", "world"]);
    }

    #[test]
    fn input_history_trims_to_100_entries() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);

        // Insert 105 unique messages.
        for i in 0..105 {
            NativeChatService::add_input_history(&format!("msg-{i}")).unwrap();
        }

        let history = NativeChatService::list_input_history().unwrap();
        assert_eq!(history.len(), 100);
        // Most recent is msg-104, oldest kept is msg-5.
        assert_eq!(history[0], "msg-104");
        assert_eq!(history[99], "msg-5");
    }

    /// With no loop in flight the steer must decline cleanly and leave the
    /// transcript untouched, so the caller can re-send the draft as a normal
    /// turn without duplicating it.
    #[test]
    fn steer_without_an_active_run_declines_and_persists_nothing() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/steer-no-run");

        let result =
            NativeChatService::steer(&session.id, "  actually, check the tests  ").unwrap();

        assert!(
            !result.delivered,
            "no run is active, so nothing could be steered"
        );
        assert!(result.message.is_none());
        let messages = NativeChatService::list_messages(&session.id).unwrap();
        assert_eq!(
            messages.len(),
            1,
            "a declined steer must not add a row to the transcript"
        );
        assert_eq!(messages[0].id, user.id);
    }

    #[test]
    fn steer_rejects_blank_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, _user) = start_persist_session("/test/steer-blank");

        assert!(NativeChatService::steer(&session.id, "   \n  ").is_err());
        assert_eq!(
            NativeChatService::list_messages(&session.id).unwrap().len(),
            1,
            "a rejected steer must not add a row to the transcript"
        );
    }
}

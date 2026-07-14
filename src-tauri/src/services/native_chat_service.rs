use rusqlite::{params, OptionalExtension, OpenFlags, Connection};
use serde_json::Value;
use std::env;
use tauri::{AppHandle, Emitter};

use crate::{
    events::NATIVE_CHAT_CHUNK,
    models::{
        native_chat::{
            ChatModelDefault, NativeChatHistoryEntry, NativeChatMessage,
            NativeChatSendRequest, NativeChatSendResult, NativeChatSession,
            NativeChatStartRequest, NativeGenerateIdeasRequest,
            NativeGenerateIdeasResult, NativeGeneratedIdea, NativeProviderCatalog,
            NativeProviderCredential, NativeProviderCredentialInput, NativeRequestMetric,
            NativeRequestMetricsSummary, NativeSetupRequired, NativeToolApprovalRequest,
            NativeToolApprovalResult, NativeToolEvent, ResolvedChatModelDefault,
        },
        omp_catalog,
        permission::PermissionDecision,
        plan::Plan,
    },
    services::{
        agent_loop_service::{ToolEventRecord, TurnSegment},
        provider_client::{resolve_client_for_model, ChatMsg, ProviderRequest, OMP_CODEX_BASE_URL},
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
                let d: ChatModelDefault =
                    serde_json::from_str(&v).map_err(|e| e.to_string())?;
                Ok(Some(d))
            }
            None => Ok(None),
        }
    }

    /// Persist the global chat model default.
    pub fn set_global_model_default(default: &ChatModelDefault) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let value =
            serde_json::to_string(default).map_err(|e| e.to_string())?;
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

        // 1. Per-project default.
        if let Some(project_default) = Self::get_project_model_default(project_path)? {
            if let Some(resolved) = Self::try_resolve(&catalog, &project_default, "project") {
                return Ok(resolved);
            }
            // Stored project default is unavailable — fall through with a notice.
            let fallback = Self::first_connected_default(&catalog);
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
            if let Some(resolved) = Self::try_resolve(&catalog, &global_default, "global") {
                return Ok(resolved);
            }
        }

        // 3. First connected provider's default model.
        let fallback = Self::first_connected_default(&catalog);
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
        } else if model.supported_efforts.iter().any(|e| e == &default.effort_level) {
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
    pub fn save_credential(input: NativeProviderCredentialInput) -> DbResult<NativeProviderCredential> {
        let now = now_seconds();
        let cred = NativeProviderCredential {
            provider_id: input.provider_id.clone(),
            label: input.label,
            api_key: input.api_key,
            base_url: input.base_url,
            updated_at: now,
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_provider_credentials (provider_id, label, api_key, base_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(provider_id) DO UPDATE SET
               label = excluded.label, api_key = excluded.api_key, base_url = excluded.base_url, updated_at = excluded.updated_at",
            params![&cred.provider_id, &cred.label, &cred.api_key, &cred.base_url, cred.updated_at],
        ).map_err(|e| format!("Failed to save provider credential: {e}"))?;
        // Remove any block so OMP-imported credentials can flow again after reconnect.
        conn.execute(
            "DELETE FROM native_blocked_providers WHERE provider_id = ?1",
            params![&cred.provider_id],
        )
        .map_err(|e| e.to_string())?;
        let _ = crate::services::provider_model_catalog_service::ProviderModelCatalogService::refresh_provider(&cred.provider_id, true);
        Ok(cred)
    }

    pub fn list_credentials() -> DbResult<Vec<NativeProviderCredential>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare("SELECT provider_id, label, api_key, base_url, updated_at FROM native_provider_credentials ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(NativeProviderCredential {
                provider_id: row.get(0)?,
                label: row.get(1)?,
                api_key: row.get(2)?,
                base_url: row.get(3)?,
                updated_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut creds = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        // Load the set of providers the user has explicitly disconnected.
        // This blocks OMP-imported credentials from re-appearing after disconnect.
        let blocked: Vec<String> = conn
            .prepare("SELECT provider_id FROM native_blocked_providers")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        // Remove blocked Basebuild credentials.
        creds.retain(|c| !blocked.contains(&c.provider_id));

        // Merge credentials from the OMP (Oh My Pi) key store so providers
        // configured there are usable without re-entering a key here. When
        // both exist, the Basebuild-saved credential takes precedence (the
        // user explicitly entered it); OMP is the fallback for providers not
        // configured in Basebuild. OMP credentials for blocked providers are
        // skipped entirely.
        let mut omp_seen = Vec::new();
        for omp in Self::omp_credentials() {
            if blocked.contains(&omp.provider_id) {
                continue;
            }
            if omp_seen.contains(&omp.provider_id) {
                continue;
            }
            omp_seen.push(omp.provider_id.clone());
            // Only add OMP credential if Basebuild doesn't have one already.
            if !creds.iter().any(|c| c.provider_id == omp.provider_id) {
                creds.push(omp);
            }
        }
        Ok(creds)
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
    /// spawns. OMP provider ids are mapped to Basebuild's (e.g.
    /// `openai-codex` → `openai`).
    fn omp_credentials() -> Vec<NativeProviderCredential> {
        Self::omp_credentials_from(&omp_agent_dir().join("agent.db"))
    }

    fn omp_credentials_from(db_path: &std::path::Path) -> Vec<NativeProviderCredential> {
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
        for credential in rows.filter_map(|r| r.ok()).filter_map(|(omp_id, cred_type, data, updated_at)| {
            let basebuild_id = omp_to_basebuild_provider(&omp_id)?;
            let key = match cred_type.as_str() {
                "api_key" => serde_json::from_str::<Value>(&data)
                    .ok()
                    .and_then(|v| v.get("key").and_then(|k| k.as_str()).map(String::from))?,
                "oauth" => omp_oauth_token(&omp_id)?,
                _ => return None,
            };
            if key.is_empty() { return None; }
            let is_omp_codex_oauth = omp_id == "openai-codex" && cred_type == "oauth";
            Some(NativeProviderCredential {
                provider_id: basebuild_id,
                label: omp_id,
                api_key: key,
                base_url: is_omp_codex_oauth.then(|| OMP_CODEX_BASE_URL.to_string()),
                updated_at,
            })
        }) {
            if !creds.iter().any(|c: &NativeProviderCredential| c.provider_id == credential.provider_id) {
                creds.push(credential);
            }
        }
        creds
    }

    pub fn delete_credential(provider_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM native_provider_credentials WHERE provider_id = ?1", params![provider_id])
            .map_err(|e| e.to_string())?;
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
        Self::get_session(session_id)?
            .ok_or_else(|| "Session not found after update.".to_string())
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
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn chat_history(limit: Option<i64>) -> DbResult<Vec<NativeChatHistoryEntry>> {
        let conn = StorageService::connect()?;
        let base_sql = "SELECT s.id, s.project_path, s.title, s.profile_id, s.provider_id, s.model_id, s.effort_level, s.status, s.run_state, s.created_at, s.updated_at, COUNT(m.id) as message_count
                        FROM native_chat_sessions s
                        LEFT JOIN native_chat_messages m ON m.session_id = s.id
                        GROUP BY s.id
                        ORDER BY s.updated_at DESC";
        if let Some(l) = limit {
            let mut stmt = conn.prepare(&format!("{} LIMIT ?1", base_sql)).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![l], map_history_entry).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        } else {
            let mut stmt = conn.prepare(base_sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], map_history_entry).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

        let is_local = provider_id == LOCAL_PROVIDER_ID;
        let credential = Self::list_credentials()?
            .into_iter()
            .find(|c| c.provider_id == provider_id);

        // Non-local provider without a stored credential → typed setup prompt.
        if !is_local && credential.is_none() {
            return Ok(NativeChatSendResult {
                user_message,
                assistant_message: None,
                metrics: None,
                tool_events: vec![],
                setup_required: Some(NativeSetupRequired {
                    provider_id: provider_id.clone(),
                    provider_label: provider_label.clone(),
                    message: format!(
                        "Connect {provider_label} to send this message. Your draft was kept."
                    ),
                }),
                offline: false,
            });
        }

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
        let resolved_model_id = Self::resolve_model_api_id(&provider_id, &model_id)
            .unwrap_or_else(|| model_id.clone());

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
        // Native-first contract (AGENTS.md): native chat streams providers
        // directly and NEVER bridges through OMP RPC. ChatGPT-subscription
        // OAuth credentials (omp://openai-codex sentinel) and bespoke agent
        // protocols with no direct endpoint have no native transport — refuse
        // with actionable guidance instead of silently delegating to OMP,
        // which cannot run Basebuild tools (approvals, ask_user, schematic
        // wizard) and leaks protocol frames into the transcript.
        if Self::route_requires_omp(&api_kind, req.base_url.as_deref(), is_local) {
            let is_oauth = req.base_url.as_deref() == Some(OMP_CODEX_BASE_URL);
            let message = if is_oauth {
                format!(
                    "{provider_label} is connected with a ChatGPT-subscription OAuth credential, which only works through the OMP bridge — native chat no longer uses it. Reconnect {provider_label} with an API key to chat natively (with tools, approvals, and the schematic wizard). Your draft was kept."
                )
            } else {
                format!(
                    "This model has no native API endpoint and previously routed through the OMP bridge — native chat no longer uses it. Pick a native-supported model (OpenAI, Anthropic, OpenRouter, Ollama, or any OpenAI-compatible endpoint), or connect {provider_label} with a direct base URL. Your draft was kept."
                )
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

        let started_at = now_millis();

        // Check if the model supports tools → use the agent loop. OMP-routed
        // models were refused above, so every remaining route is native.
        let supports_tools = !is_local && Self::model_supports_tools(&provider_id, &model_id);

        // Capture schematic mtime before the turn to detect agent-driven writes.
        let schematic_path = std::path::Path::new(&session.project_path)
            .join(".basebuild/project-schematic.md");
        let schematic_mtime_before = std::fs::metadata(&schematic_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        if supports_tools {
            // Run the agentic loop: stream → tool calls → approval → execute → repeat.
            let run_result = crate::services::agent_loop_service::run_agent_turn(
                &request.session_id,
                &session.project_path,
                &provider_id,
                &resolved_model_id,
                &effort_level,
                credential.as_ref().map(|c| c.api_key.clone()),
                credential.as_ref().and_then(|c| c.base_url.clone()),
                system,
                messages,
                app.clone(),
                true,
            );

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
                        Some("The agent wrote to the project schematic during this turn.".to_string()),
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
                outcome: if run_result.cancelled { "cancelled" } else { "success" }.to_string(),
                error_class: None,
                subscription_tier: subscription.0.clone(),
                subscription_source: subscription.1.clone(),
                plan_name: subscription.2.clone(),
                created_at: now_seconds(),
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

        let client = resolve_client_for_model(&provider_id, &api_kind, req.base_url.as_deref(), &model_base_url);
        let session_id_for_emit = request.session_id.clone();
        let app_for_emit = app.clone();
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({ "sessionId": session_id_for_emit, "delta": delta, "channel": channel }),
            );
        };

        // Signal the UI that the model is thinking before the first token.
        emit("thinking", "status");

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
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
                    error_class: Some("provider_error".to_string()),
                    subscription_tier: subscription.0.clone(),
                    subscription_source: subscription.1.clone(),
                    plan_name: subscription.2.clone(),
                    created_at: now_seconds(),
                };
                let _ = Self::insert_metric(&metric);
                return Err(e);
            }
        };

        let assistant_message = Self::insert_message(
            &request.session_id,
            "assistant",
            &response.content,
            response.reasoning.as_deref(),
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;

        let duration_ms = response.duration_ms.max(1);
        let output_tokens = response
            .output_tokens
            .unwrap_or_else(|| estimate_tokens(&response.content));
        let input_tokens = response.input_tokens.unwrap_or_else(|| estimate_tokens(content));
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

        Ok(NativeChatSendResult {
            user_message,
            assistant_message: Some(assistant_message),
            metrics: Some(metric),
            tool_events: vec![event],
            setup_required: None,
            offline: is_local,
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
        // Record this as a pipeline_runs row (generate_ideas stage).
        let session = Self::get_session(&request.session_id)?
            .ok_or_else(|| format!("Native chat session '{}' not found", request.session_id))?;
        let run_id = format!("run-{:x}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0));
        let now = now_seconds();
        let _ = Self::record_pipeline_run(&run_id, &request.session_id, &session.project_path, "generate_ideas", "running", now);
        let provider_id = request
            .provider_id
            .unwrap_or_else(|| session.provider_id.clone());
        let model_id = request.model_id.unwrap_or_else(|| session.model_id.clone());
        let effort_level = request
            .effort_level
            .unwrap_or_else(|| session.effort_level.clone());
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        let catalog = Self::provider_catalog();
        let provider_label = catalog
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .map(|p| p.label.clone())
            .unwrap_or_else(|| provider_id.clone());

        // Idea generation requires a configured, network-backed provider. The
        // local coordinator has no credential row, so this covers both cases.
        let credential = Self::list_credentials()?
            .into_iter()
            .find(|c| c.provider_id == provider_id);
        if credential.is_none() {
            return Ok(NativeGenerateIdeasResult {
                ideas: vec![],
                setup_required: Some(NativeSetupRequired {
                    provider_id: provider_id.clone(),
                    provider_label: provider_label.clone(),
                    message: "Connect a model provider to generate ideas from this chat."
                        .to_string(),
                }),
                grounding: None,
                user_message: None,
                assistant_message: None,
            });
        }

        let history = Self::list_messages(&request.session_id)?;
        let convo: String = history
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");

        // Category-directed generation: ground the prompt in the category and
        // tag captured ideas. Seed defaults if the session has no categories.
        let category_id = request.category_id.clone();
        if category_id.is_some() {
            let _ = crate::services::session_service::SessionService::ensure_default_categories(&request.session_id);
        }
        let category = category_id.as_ref().and_then(|id| {
            crate::services::session_service::SessionService::list_categories(&request.session_id)
                .ok()?
                .into_iter()
                .find(|c| c.id == *id)
        });
        let category_direction = category.as_ref().map(|c| {
            format!(
                "\n\nDirect idea generation within this category:\nName: {}\nDescription: {}\nStay on-theme. Tag every idea with this category.",
                c.name, c.description
            )
        }).unwrap_or_default();

        // Optional free-form steering from the request, appended after any
        // category direction.
        let extra_direction = request
            .direction
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(|d| format!("\n\nAdditional direction:\n{d}"))
            .unwrap_or_default();

        let system = Self::system_prompt(&session.project_path, request.schematic.as_deref());
        let idea_template = crate::services::planning_prompt_service::PlanningPromptService::get(
            crate::models::planning_prompt::IDEA_GENERATION,
        )
        .unwrap_or_default();
        let prompt = format!(
            "{}{}{}",
            idea_template.replace("{conversation}", &convo),
            category_direction,
            extra_direction
        );

        // Persist the generation prompt as a user message so the turn is
        // visible in the transcript and survives reloads — matching send_message.
        let user_message = Self::insert_message(
            &request.session_id,
            "user",
            &prompt,
            None,
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        Self::touch_session(&request.session_id)?;

        let (api_kind, model_base_url) = Self::resolve_model_routing(&provider_id, &model_id);

        let req = ProviderRequest {
            model_id: model_id.clone(),
            effort_level: effort_level.clone(),
            system: Some(system),
            messages: vec![ChatMsg {
                role: "user".to_string(),
                content: prompt,
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
            }],
            api_key: credential.as_ref().map(|c| c.api_key.clone()),
            base_url: credential.as_ref().and_then(|c| c.base_url.clone()),
            tools: Vec::new(),
        };

        let client = resolve_client_for_model(&provider_id, &api_kind, req.base_url.as_deref(), &model_base_url);
        let session_id_for_emit = request.session_id.clone();
        let app_for_emit = app.clone();
        // Forward the actual channel label from the provider client so
        // reasoning tokens stream on "reasoning" and content on "content" —
        // matching send_message's emit contract.
        let emit = move |delta: &str, channel: &str| {
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({
                    "sessionId": session_id_for_emit,
                    "delta": delta,
                    "channel": channel
                }),
            );
        };

        // Signal the UI that the model is thinking before the first token.
        emit("thinking", "status");

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
                let _ = Self::record_pipeline_run(&run_id, &request.session_id, &session.project_path, "generate_ideas", "failed", now_seconds());
                return Err(e);
            }
        };

        // Persist the assistant response so the generated ideas survive reloads.
        let assistant_message = Self::insert_message(
            &request.session_id,
            "assistant",
            &response.content,
            response.reasoning.as_deref(),
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        Self::touch_session(&request.session_id)?;

        let ideas = Self::parse_ideas(&response.content);
        let cat_id_ref = category_id.as_deref();
        let _ = Self::parse_and_capture_ideas(&response.content, &request.session_id, cat_id_ref, Some(&run_id));
        // Mark the pipeline run as succeeded.
        let stage_kind = if category_id.is_some() { "generate_ideas_category" } else { "generate_ideas" };
        let _ = Self::record_pipeline_run(&run_id, &request.session_id, &session.project_path, stage_kind, "succeeded", now_seconds());
        let grounding = crate::services::planning_prompt_service::PlanningPromptService::grounding_metadata(
            &request.session_id,
            &session.project_path,
        );
        Ok(NativeGenerateIdeasResult {
            ideas,
            setup_required: None,
            grounding: Some(grounding),
            user_message: Some(user_message),
            assistant_message: Some(assistant_message),
        })
    }

    /// Record a pipeline_runs row for a generate-ideas/generate-plans stage.
    pub fn record_pipeline_run(run_id: &str, session_id: &str, project_path: &str, kind: &str, status: &str, ts: i64) -> DbResult<()> {
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

    /// Parse idea-shaped JSON from a model response and capture each as a
    /// concept idea in the ideas catalog. Fallback for models that emit ideas
    /// as prose/JSON instead of calling the propose_ideas tool.
    fn parse_and_capture_ideas(content: &str, session_id: &str, category_id: Option<&str>, batch_id: Option<&str>) {
        let text = content.trim();
        let (start, end) = match (text.find('['), text.rfind(']')) {
            (Some(s), Some(e)) if e > s => (s, e),
            _ => return,
        };
        let parsed: serde_json::Value = match serde_json::from_str(&text[start..=end]) {
            Ok(v) => v,
            Err(_) => return,
        };
        let Some(arr) = parsed.as_array() else { return };
        for item in arr {
            let title = item.get("title").and_then(serde_json::Value::as_str).unwrap_or("");
            if title.trim().is_empty() {
                continue;
            }
            let description = item
                .get("description")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let _ = crate::services::session_service::SessionService::create_idea(
                session_id,
                title,
                &description,
                category_id,
                "",
                None,
                batch_id,
            );
        }
    }

    pub fn list_metrics(limit: u32) -> DbResult<Vec<NativeRequestMetric>> {
        let limit = i64::from(limit.clamp(1, 500));
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                        subscription_tier, subscription_source, plan_name
                 FROM native_request_metrics ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], map_metric).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn latest_metric_for_session(session_id: &str) -> DbResult<Option<NativeRequestMetric>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                    subscription_tier, subscription_source, plan_name
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

    /// Metrics created strictly after `since_created_at` (epoch seconds),
    /// oldest-first, for the incremental app→basebuild.net message sync.
    pub fn metrics_since(since_created_at: i64, limit: u32) -> DbResult<Vec<NativeRequestMetric>> {
        let limit = i64::from(limit.clamp(1, 5000));
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at,
                        subscription_tier, subscription_source, plan_name
                 FROM native_request_metrics WHERE created_at > ?1 ORDER BY created_at ASC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![since_created_at, limit], map_metric).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
            PermissionDecision::Ask => ("ask", true, "User approval is required before this native harness action can run."),
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
    /// provider routing. Falls back to the bundled OMP catalog if the
    /// model is not in the cache or has no `api_kind` set.
    pub fn resolve_model_routing(
        provider_id: &str,
        model_id: &str,
    ) -> (String, String) {
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
        // Fall back to the bundled OMP catalog.
        if let Some(cm) = omp_catalog::models_for(provider_id)
            .iter()
            .find(|m| m.id == model_id)
        {
            return (cm.api_kind.clone(), cm.base_url.clone());
        }
        (String::new(), String::new())
    }

    /// True when this (api_kind, credential base_url) combination has no
    /// native transport and would previously have bridged through OMP RPC:
    /// the ChatGPT-subscription OAuth sentinel (`omp://openai-codex`), or a
    /// bespoke agent api_kind with no direct endpoint. Native chat refuses
    /// these routes (native-first contract) instead of delegating to OMP.
    pub fn route_requires_omp(
        api_kind: &str,
        credential_base_url: Option<&str>,
        is_local: bool,
    ) -> bool {
        credential_base_url == Some(OMP_CODEX_BASE_URL)
            || (api_kind != "openai-completions"
                && api_kind != "openai-responses"
                && api_kind != "azure-openai-responses"
                && api_kind != "anthropic-messages"
                && api_kind != "openrouter"
                && api_kind != "ollama-chat"
                && !is_local
                && credential_base_url.is_none())
    }

    fn validate_provider_model(provider_id: &str, model_id: &str, allow_unconfigured: bool) -> DbResult<()> {
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
        for m in history.iter().filter(|m| m.role == "user" || m.role == "assistant") {
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
            Self::insert_tool_event(
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
            let message = Self::insert_message(
                session_id,
                "assistant",
                &segment.content,
                segment.reasoning.as_deref(),
                Some(provider_id),
                Some(model_id),
                Some(effort_level),
            )?;
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
        let conn = StorageService::connect()?;
        let next_seq: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM native_tool_events WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(1);
        let event = NativeToolEvent {
            id: gen_id("ntool"),
            session_id: session_id.to_string(),
            message_id: message_id.map(str::to_string),
            kind: kind.to_string(),
            status: status.to_string(),
            summary: summary.to_string(),
            arguments: arguments.map(str::to_string),
            diff: diff.map(str::to_string),
            decision: decision.map(str::to_string),
            rule_source: rule_source.map(str::to_string),
            sequence: next_seq,
            created_at: now_seconds(),
        };
        conn.execute(
            "INSERT INTO native_tool_events (id, session_id, message_id, kind, status, summary, arguments, diff, decision, rule_source, sequence, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM native_tool_events WHERE session_id = ?2), ?11)",
            params![event.id, event.session_id, event.message_id, event.kind, event.status, event.summary, event.arguments, event.diff, event.decision, event.rule_source, event.created_at],
        )
        .map_err(|e| format!("Failed to save native tool event: {e}"))?;
        // Read back the assigned sequence so the returned event matches what was persisted.
        let persisted_seq: i64 = conn
            .query_row(
                "SELECT sequence FROM native_tool_events WHERE id = ?1",
                params![event.id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to read back tool event sequence: {e}"))?;
        Ok(NativeToolEvent { sequence: persisted_seq, ..event })
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
                            let plan_name =
                                entry.get("planName").and_then(|v| v.as_str()).map(str::to_string);
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
                subscription_tier, subscription_source, plan_name
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
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
        let truncated = crate::services::session_service::truncate_title(suggested, 60);
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
                if s.is_empty() { String::new() } else { s.chars().take(4000).collect::<String>() }
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
                let title = item.get("title").and_then(Value::as_str)?.trim().to_string();
                if title.is_empty() {
                    return None;
                }
                let description = item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                Some(NativeGeneratedIdea { title, description })
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
        run_state: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "idle".to_string()),
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
        run_state: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "idle".to_string()),
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
    })
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

/// Active OMP agent directory, resolved once per process. Prefers
/// `omp config path` so per-profile DBs are honored; falls back to
/// `<home>/.omp/agent` when omp isn't installed or the call fails.
static OMP_AGENT_DIR: std::sync::LazyLock<std::path::PathBuf> = std::sync::LazyLock::new(|| {
    use crate::services::process_helpers::hidden_command;
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    let default = home
        .as_ref()
        .map(|h| std::path::Path::new(h).join(".omp/agent"))
        .unwrap_or_default();
    let output = hidden_command("omp").args(["config", "path"]).output();
    match output {
        Ok(o) if o.status.success() => {
            let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if p.is_empty() { default } else { std::path::PathBuf::from(p) }
        }
        _ => default,
    }
});

/// Map an OMP provider id to a Basebuild provider id. With the vendored OMP
/// catalog, this is an identity mapping for all catalog providers, with one
/// historical sentinel: `openai-codex` (ChatGPT OAuth) maps to `openai` so
/// its credentials flow through the existing `OMP_CODEX_BASE_URL` routing.
fn omp_to_basebuild_provider(omp_id: &str) -> Option<String> {
    if omp_id == "openai-codex" {
        return Some("openai".to_string());
    }
    // Identity mapping for all OMP catalog providers.
    if omp_catalog::provider_ids().contains(&omp_id) {
        return Some(omp_id.to_string());
    }
    None
}

/// OAuth token cache: (token, fetched_at). TTL prevents per-send CLI spawns.
/// ponytail: 5-min TTL; OAuth tokens typically last 1h, refresh handled by omp.
static OAUTH_TOKEN_CACHE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));
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
    if token.is_empty() { return None; }
    if let Ok(mut cache) = OAUTH_TOKEN_CACHE.lock() {
        cache.insert(omp_provider.to_string(), (token.clone(), std::time::Instant::now()));
    }
    Some(token)
}

pub(crate) fn omp_agent_dir() -> &'static std::path::Path {
    &OMP_AGENT_DIR
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        0
    } else {
        trimmed.split_whitespace().count().max(1) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::lock_db;
    #[test]
    fn provider_catalog_has_local_default_and_effort_levels() {
        let catalog = NativeChatService::provider_catalog();
        assert_eq!(catalog.default_provider_id, LOCAL_PROVIDER_ID);
        assert_eq!(catalog.default_model_id, "basebuild-local-coordinator");
        assert!(catalog.providers.iter().any(|provider| provider.id == LOCAL_PROVIDER_ID && provider.configured));
        assert!(catalog.effort_levels.iter().any(|effort| effort.id == "xhigh"));
    }
    #[test]
    fn route_requires_omp_refuses_codex_oauth_sentinel() {
        // ChatGPT-subscription OAuth has no native transport regardless of kind.
        assert!(NativeChatService::route_requires_omp(
            "openai-responses",
            Some(crate::services::provider_client::OMP_CODEX_BASE_URL),
            false,
        ));
    }

    #[test]
    fn route_requires_omp_refuses_bespoke_kind_without_endpoint() {
        assert!(NativeChatService::route_requires_omp("devin-agent", None, false));
        assert!(NativeChatService::route_requires_omp("openai-codex-responses", None, false));
    }

    #[test]
    fn route_requires_omp_allows_native_kinds_and_escape_hatches() {
        for kind in [
            "openai-completions",
            "openai-responses",
            "azure-openai-responses",
            "anthropic-messages",
            "openrouter",
            "ollama-chat",
        ] {
            assert!(!NativeChatService::route_requires_omp(kind, None, false), "{kind} is native");
        }
        // Custom base_url is the OpenAI-compatible escape hatch for bespoke kinds.
        assert!(!NativeChatService::route_requires_omp("devin-agent", Some("https://server.codeium.com"), false));
        // Local coordinator never routes through OMP.
        assert!(!NativeChatService::route_requires_omp("", None, true));
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
        assert!(resolved.notice.as_ref().unwrap().contains("nonexistent-provider"));
    }

    /// Builds an OMP-shaped `agent.db` fixture in a temp dir so the credential
    /// reader can be exercised deterministically on any machine, with or
    /// without OMP installed.
    fn write_omp_fixture_db(db_path: &std::path::Path, rows: &[(&str, &str, &str, Option<&str>, i64)]) {
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
                ("anthropic", "api_key", r#"{"key":"sk-revoked"}"#, Some("revoked"), 300),
                ("mystery-provider", "api_key", r#"{"key":"sk-x"}"#, None, 100),
                ("openai", "api_key", r#"{"key":""}"#, None, 100),
            ],
        );

        let creds = NativeChatService::omp_credentials_from(&db_path);
        assert_eq!(creds.len(), 2, "expected only umans + anthropic: {creds:?}");
        let umans = creds.iter().find(|c| c.provider_id == "umans").expect("umans mapped");
        assert_eq!(umans.api_key, "sk-new", "newest active row should win");
        assert!(umans.base_url.is_none(), "api_key rows must not get the OMP Codex base_url tag");
        let anthropic = creds.iter().find(|c| c.provider_id == "anthropic").expect("anthropic mapped");
        assert_eq!(anthropic.api_key, "sk-ant", "disabled row must not shadow the active one");
    }

    #[test]
    fn omp_credentials_missing_db_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(NativeChatService::omp_credentials_from(&dir.path().join("agent.db")).is_empty());
    }

    #[test]
    fn omp_provider_ids_map_to_basebuild_ids() {
        assert_eq!(omp_to_basebuild_provider("openai-codex"), Some("openai".to_string()));
        assert_eq!(omp_to_basebuild_provider("openai"), Some("openai".to_string()));
        assert_eq!(omp_to_basebuild_provider("anthropic"), Some("anthropic".to_string()));
        assert_eq!(omp_to_basebuild_provider("umans"), Some("umans".to_string()));
        assert_eq!(omp_to_basebuild_provider("devin"), Some("devin".to_string()));
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
        let reread = NativeChatService::get_session(&session.id).unwrap().unwrap();
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
        NativeChatService::insert_message(&session.id, "user", "hello", None, Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium")).unwrap();
        NativeChatService::insert_message(&session.id, "assistant", "hi there", None, Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium")).unwrap();
        NativeChatService::insert_tool_event(&session.id, None, "test_tool", "ok", "ran", None, None, None, None);

        // Verify they exist.
        assert_eq!(NativeChatService::list_messages(&session.id).unwrap().len(), 2);
        assert_eq!(NativeChatService::list_tool_events(&session.id).unwrap().len(), 1);

        // Clear and verify deletion count.
        let deleted = NativeChatService::clear_session_messages(&session.id).unwrap();
        assert_eq!(deleted, 2, "should delete 2 messages");
        assert_eq!(NativeChatService::list_messages(&session.id).unwrap().len(), 0);
        assert_eq!(NativeChatService::list_tool_events(&session.id).unwrap().len(), 0);

        // Session record itself should still exist (provider/model/effort preserved).
        let reread = NativeChatService::get_session(&session.id).unwrap().unwrap();
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
        NativeChatService::insert_message(&older.id, "user", "hello", None, Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium")).unwrap();
        NativeChatService::insert_message(&older.id, "assistant", "hi", None, Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium")).unwrap();

        let newer = NativeChatService::start_session(NativeChatStartRequest {
            project_path: "/test/history-b".to_string(),
            title: Some("Newer".to_string()),
            provider_id: Some(LOCAL_PROVIDER_ID.to_string()),
            model_id: Some("basebuild-local-coordinator".to_string()),
            effort_level: Some("medium".to_string()),
        })
        .unwrap();
        NativeChatService::insert_message(&newer.id, "user", "only one", None, Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium")).unwrap();
        // Force deterministic ordering: newer must sort before older.
        StorageService::connect()
            .unwrap()
            .execute("UPDATE native_chat_sessions SET updated_at = ?1 WHERE id = ?2", params![older.updated_at + 10, newer.id])
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
        NativeChatService::save_credential(crate::models::native_chat::NativeProviderCredentialInput {
            provider_id: "umans".to_string(),
            label: "test".to_string(),
            api_key: "sk-new".to_string(),
            base_url: None,
        })
        .unwrap();

        // The block should be gone.
        let blocked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_blocked_providers WHERE provider_id = 'umans'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(blocked, 0, "umans should be unblocked after saving a new credential");

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
        assert!(NativeChatService::latest_metric_for_session("missing").unwrap().is_none());
    }

    fn segment(content: &str, reasoning: Option<&str>, iteration: usize) -> TurnSegment {
        TurnSegment {
            content: content.to_string(),
            reasoning: reasoning.map(str::to_string),
            iteration,
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
            &session.id, "user", "do the thing", None,
            Some(LOCAL_PROVIDER_ID), Some("basebuild-local-coordinator"), Some("medium"),
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
            &session.id, &user.id, &segments, &events,
            LOCAL_PROVIDER_ID, "basebuild-local-coordinator", "medium",
        )
        .unwrap();

        let messages = NativeChatService::list_messages(&session.id).unwrap();
        let assistants: Vec<_> = messages.iter().filter(|m| m.role == "assistant").collect();
        assert_eq!(assistants.len(), 2, "one assistant row per text-producing iteration");
        assert_eq!(assistants[0].content, "Let me look at the files.");
        assert_eq!(assistants[0].reasoning.as_deref(), Some("planning"));
        assert_eq!(assistants[1].content, "All done.");
        let last = last.expect("last assistant message");
        assert_eq!(last.id, assistants[1].id, "SendResult carries the LAST inserted message");

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
    fn persist_turn_segments_cancelled_run_keeps_prior_segments_without_empty_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let (session, user) = start_persist_session("/test/persist-cancel");

        // Cancelled mid-turn: iteration 1 text + events survived, iteration 2
        // was cut off after its tool calls. An empty segment must not produce
        // an assistant row.
        let segments = vec![
            segment("Working on it.", None, 1),
            segment("", None, 2),
        ];
        let events = vec![event_record("read_file", 1), event_record("bash", 2)];
        let (last, tool_events) = NativeChatService::persist_turn_segments(
            &session.id, &user.id, &segments, &events,
            LOCAL_PROVIDER_ID, "basebuild-local-coordinator", "medium",
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
            &session.id, &user.id, &[], &[event_record("read_file", 1)],
            LOCAL_PROVIDER_ID, "basebuild-local-coordinator", "medium",
        )
        .unwrap();

        assert!(last.is_none(), "no assistant message without segments");
        let messages = NativeChatService::list_messages(&session.id).unwrap();
        assert!(messages.iter().all(|m| m.role != "assistant"), "no empty assistant row on cancel");
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
        let shape: Vec<(&str, &str)> = messages.iter().map(|m| (m.role.as_str(), m.content.as_str())).collect();
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
}

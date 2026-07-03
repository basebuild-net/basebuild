use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    events::NATIVE_CHAT_CHUNK,
    models::{
        native_chat::{
            NativeChatMessage, NativeChatSendRequest, NativeChatSendResult, NativeChatSession,
            NativeChatStartRequest, NativeEffortLevel, NativeGenerateIdeasRequest,
            NativeGenerateIdeasResult, NativeGeneratedIdea, NativeModel, NativeProvider,
            NativeProviderCatalog, NativeProviderCredential, NativeProviderCredentialInput,
            NativeRequestMetric, NativeRequestMetricsSummary, NativeSetupRequired,
            NativeToolApprovalRequest, NativeToolApprovalResult, NativeToolEvent,
        },
        permission::PermissionDecision,
    },
    services::{
        provider_client::{resolve_client, ChatMsg, ProviderRequest},
        settings_service::SettingsService,
        storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

const NATIVE_PROFILE_ID: &str = "basebuild-native";
const LOCAL_PROVIDER_ID: &str = "basebuild-local";
const LOCAL_MODEL_ID: &str = "basebuild-local-coordinator";
const DEFAULT_EFFORT: &str = "medium";

#[derive(Debug, Default)]
pub struct NativeChatService;

impl NativeChatService {
    pub fn provider_catalog() -> NativeProviderCatalog {
        let credentials = Self::list_credentials().unwrap_or_default();
        let is_configured = |pid: &str| -> bool {
            pid == LOCAL_PROVIDER_ID
                || credentials.iter().any(|c| c.provider_id == pid)
        };

        NativeProviderCatalog {
            providers: vec![
                NativeProvider {
                    id: LOCAL_PROVIDER_ID.to_string(),
                    label: "Basebuild Local".to_string(),
                    status: "ready".to_string(),
                    credential_owner: "basebuild".to_string(),
                    configured: true,
                    local_only: true,
                    detail: "Runs locally without a network provider.".to_string(),
                },
                NativeProvider {
                    id: "umans".to_string(),
                    label: "Umans".to_string(),
                    status: if is_configured("umans") { "ready" } else { "setup_required" }.to_string(),
                    credential_owner: "user".to_string(),
                    configured: is_configured("umans"),
                    local_only: false,
                    detail: "Umans API — OpenAI-compatible. Enter your API key to connect.".to_string(),
                },
                NativeProvider {
                    id: "openai".to_string(),
                    label: "OpenAI".to_string(),
                    status: if is_configured("openai") { "ready" } else { "setup_required" }.to_string(),
                    credential_owner: "user".to_string(),
                    configured: is_configured("openai"),
                    local_only: false,
                    detail: "OpenAI API — enter your API key to connect.".to_string(),
                },
                NativeProvider {
                    id: "anthropic".to_string(),
                    label: "Anthropic".to_string(),
                    status: if is_configured("anthropic") { "ready" } else { "setup_required" }.to_string(),
                    credential_owner: "user".to_string(),
                    configured: is_configured("anthropic"),
                    local_only: false,
                    detail: "Anthropic API — enter your API key to connect.".to_string(),
                },
            ],
            models: vec![
                NativeModel {
                    id: LOCAL_MODEL_ID.to_string(),
                    provider_id: LOCAL_PROVIDER_ID.to_string(),
                    label: "Local Coordinator".to_string(),
                    supports_effort: true,
                    supports_streaming: false,
                    local_only: true,
                },
                NativeModel {
                    id: "umans-glm-5.2".to_string(),
                    provider_id: "umans".to_string(),
                    label: "Umans GLM 5.2".to_string(),
                    supports_effort: true,
                    supports_streaming: true,
                    local_only: false,
                },
                NativeModel {
                    id: "gpt-5.1".to_string(),
                    provider_id: "openai".to_string(),
                    label: "GPT-5.1".to_string(),
                    supports_effort: true,
                    supports_streaming: true,
                    local_only: false,
                },
                NativeModel {
                    id: "claude-sonnet-4.5".to_string(),
                    provider_id: "anthropic".to_string(),
                    label: "Claude Sonnet 4.5".to_string(),
                    supports_effort: true,
                    supports_streaming: true,
                    local_only: false,
                },
            ],
            effort_levels: vec![
                NativeEffortLevel { id: "low".to_string(), label: "Low".to_string(), description: "Fast, shallow planning.".to_string() },
                NativeEffortLevel { id: "medium".to_string(), label: "Medium".to_string(), description: "Balanced reliability and speed.".to_string() },
                NativeEffortLevel { id: "high".to_string(), label: "High".to_string(), description: "Deeper reasoning for implementation planning.".to_string() },
                NativeEffortLevel { id: "xhigh".to_string(), label: "XHigh".to_string(), description: "Maximum local planning budget before provider-backed execution.".to_string() },
            ],
            default_provider_id: LOCAL_PROVIDER_ID.to_string(),
            default_model_id: LOCAL_MODEL_ID.to_string(),
            default_effort_level: DEFAULT_EFFORT.to_string(),
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
            params![cred.provider_id, cred.label, cred.api_key, cred.base_url, cred.updated_at],
        ).map_err(|e| format!("Failed to save provider credential: {e}"))?;
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
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_credential(provider_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM native_provider_credentials WHERE provider_id = ?1", params![provider_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn start_session(request: NativeChatStartRequest) -> DbResult<NativeChatSession> {
        if request.project_path.trim().is_empty() {
            return Err("Project path is required.".to_string());
        }

        let catalog = Self::provider_catalog();
        let provider_id = request
            .provider_id
            .unwrap_or_else(|| catalog.default_provider_id.clone());
        let model_id = request.model_id.unwrap_or_else(|| catalog.default_model_id.clone());
        let effort_level = request
            .effort_level
            .unwrap_or_else(|| catalog.default_effort_level.clone());
        Self::validate_provider_model(&provider_id, &model_id, true)?;

        let now = now_seconds();
        let session = NativeChatSession {
            id: gen_id("nchat"),
            project_path: request.project_path,
            title: request.title.unwrap_or_else(|| "Native Chat".to_string()),
            profile_id: NATIVE_PROFILE_ID.to_string(),
            provider_id,
            model_id,
            effort_level,
            status: "ready".to_string(),
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

    pub fn get_session(session_id: &str) -> DbResult<Option<NativeChatSession>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at
             FROM native_chat_sessions WHERE id = ?1",
            params![session_id],
            map_session,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn list_sessions(project_path: &str) -> DbResult<Vec<NativeChatSession>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at
                 FROM native_chat_sessions WHERE project_path = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], map_session)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_messages(session_id: &str) -> DbResult<Vec<NativeChatMessage>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, sort_order, provider_id, model_id, effort_level, created_at
                 FROM native_chat_messages WHERE session_id = ?1 ORDER BY sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], map_message)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
            Some(&provider_id),
            Some(&model_id),
            Some(&effort_level),
        )?;
        Self::touch_session(&request.session_id)?;

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
        let history = Self::list_messages(&request.session_id)?;
        let messages: Vec<ChatMsg> = history
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| ChatMsg {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();
        let system = Self::system_prompt(&session.project_path, None);

        let req = ProviderRequest {
            model_id: model_id.clone(),
            effort_level: effort_level.clone(),
            system: Some(system),
            messages,
            api_key: credential.as_ref().map(|c| c.api_key.clone()),
            base_url: credential.as_ref().and_then(|c| c.base_url.clone()),
        };

        let client = resolve_client(&provider_id, req.base_url.as_deref());
        let started_at = now_millis();
        let session_id_for_emit = request.session_id.clone();
        let app_for_emit = app.clone();
        let emit = move |delta: &str| {
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({ "sessionId": session_id_for_emit, "delta": delta }),
            );
        };

        let response = match client.generate(&req, &emit) {
            Ok(r) => r,
            Err(e) => {
                let completed_at = now_millis();
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
            created_at: now_seconds(),
        };
        Self::insert_metric(&metric)?;

        let summary = if is_local {
            "Handled offline by the local coordinator; no external model was contacted."
        } else {
            "Provider-backed turn: streamed assistant output with real timing/token metrics."
        };
        let event = Self::insert_tool_event(
            &request.session_id,
            Some(&assistant_message.id),
            "request_metrics",
            "recorded",
            summary,
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
        let session = Self::get_session(&request.session_id)?
            .ok_or_else(|| format!("Native chat session '{}' not found", request.session_id))?;
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
            });
        }

        let history = Self::list_messages(&request.session_id)?;
        let convo: String = history
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");

        let system = Self::system_prompt(&session.project_path, request.schematic.as_deref());
        let prompt = format!(
            "Based on the conversation below and the project context, propose 3-6 concrete, \
             actionable ideas for this project.\nRespond with ONLY a JSON array of objects, each \
             with \"title\" (max 8 words) and \"description\" (1-2 sentences). No prose, no code \
             fences.\n\nConversation:\n{convo}"
        );

        let req = ProviderRequest {
            model_id,
            effort_level,
            system: Some(system),
            messages: vec![ChatMsg {
                role: "user".to_string(),
                content: prompt,
            }],
            api_key: credential.as_ref().map(|c| c.api_key.clone()),
            base_url: credential.as_ref().and_then(|c| c.base_url.clone()),
        };

        let client = resolve_client(&provider_id, req.base_url.as_deref());
        let session_id_for_emit = request.session_id.clone();
        let app_for_emit = app.clone();
        let emit = move |delta: &str| {
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({
                    "sessionId": session_id_for_emit,
                    "delta": delta,
                    "channel": "ideas"
                }),
            );
        };
        let response = client.generate(&req, &emit)?;
        let ideas = Self::parse_ideas(&response.content);
        Ok(NativeGenerateIdeasResult {
            ideas,
            setup_required: None,
        })
    }

    pub fn list_metrics(limit: u32) -> DbResult<Vec<NativeRequestMetric>> {
        let limit = i64::from(limit.clamp(1, 500));
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at
                 FROM native_request_metrics ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], map_metric).map_err(|e| e.to_string())?;
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

    fn insert_message(
        session_id: &str,
        role: &str,
        content: &str,
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
            sort_order,
            provider_id: provider_id.map(str::to_string),
            model_id: model_id.map(str::to_string),
            effort_level: effort_level.map(str::to_string),
            created_at: now_seconds(),
        };
        conn.execute(
            "INSERT INTO native_chat_messages (id, session_id, role, content, sort_order, provider_id, model_id, effort_level, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                message.id,
                message.session_id,
                message.role,
                message.content,
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
    ) -> DbResult<NativeToolEvent> {
        let event = NativeToolEvent {
            id: gen_id("ntool"),
            session_id: session_id.to_string(),
            message_id: message_id.map(str::to_string),
            kind: kind.to_string(),
            status: status.to_string(),
            summary: summary.to_string(),
            created_at: now_seconds(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_tool_events (id, session_id, message_id, kind, status, summary, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![event.id, event.session_id, event.message_id, event.kind, event.status, event.summary, event.created_at],
        )
        .map_err(|e| format!("Failed to save native tool event: {e}"))?;
        Ok(event)
    }

    fn insert_metric(metric: &NativeRequestMetric) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO native_request_metrics (
                id, session_id, provider_id, model_id, effort_level, started_at, completed_at, duration_ms, ttft_ms, ttlt_ms,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_per_second, cost_total, outcome, error_class, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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

    /// Build the system prompt for a turn: harness identity, project path, and
    /// optionally the project schematic (clipped) for grounding.
    fn system_prompt(project_path: &str, schematic: Option<&str>) -> String {
        let mut s = format!(
            "You are the Basebuild native chat harness, an assistant embedded in a local desktop \
             IDE.\nActive project path: {project_path}\nBe concise and practical. Do not modify \
             files, run commands, or commit unless the user explicitly asks."
        );
        if let Some(sch) = schematic {
            let sch = sch.trim();
            if !sch.is_empty() {
                let clipped: String = sch.chars().take(4000).collect();
                s.push_str(&format!("\n\nProject schematic:\n{clipped}"));
            }
        }
        s
    }

    /// Parse a provider response into structured ideas. Extracts the first JSON
    /// array and reads `title`/`description` from each object; tolerant of
    /// surrounding prose or code fences.
    fn parse_ideas(raw: &str) -> Vec<NativeGeneratedIdea> {
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
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn map_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<NativeChatMessage> {
    Ok(NativeChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        sort_order: row.get(4)?,
        provider_id: row.get(5)?,
        model_id: row.get(6)?,
        effort_level: row.get(7)?,
        created_at: row.get(8)?,
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

    #[test]
    fn provider_catalog_has_local_default_and_effort_levels() {
        let catalog = NativeChatService::provider_catalog();
        assert_eq!(catalog.default_provider_id, LOCAL_PROVIDER_ID);
        assert_eq!(catalog.default_model_id, LOCAL_MODEL_ID);
        assert!(catalog.providers.iter().any(|provider| provider.id == LOCAL_PROVIDER_ID && provider.configured));
        assert!(catalog.effort_levels.iter().any(|effort| effort.id == "xhigh"));
    }

    #[test]
    fn token_estimate_never_counts_empty_content() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("one two"), 2);
    }
}

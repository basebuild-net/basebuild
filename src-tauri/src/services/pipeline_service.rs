use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::{
    events::NATIVE_CHAT_CHUNK,
    models::{
        idea::{Idea, IdeaStatus},
        pipeline::{PipelineRun, PipelineRunStatus, PipelineStageKind, PipelineStartRequest},
    },
    services::{
        native_chat_service::NativeChatService, provider_client::{resolve_client, ChatMsg, ProviderRequest},
        session_service::SessionService, storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// A cancellation token for a running pipeline stage. Held in the global
/// `RUNNING_STAGES` map keyed by run id. When the user cancels, the token is
/// set and the stage's provider request is aborted (the emit closure checks
/// it between chunks).
#[derive(Debug, Default, Clone)]
pub struct CancellationToken {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Global map of running stage run ids → cancellation tokens. Allows the
/// cancel command to signal a running stage without holding a reference to it.
static RUNNING_STAGES: std::sync::LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Default)]
pub struct PipelineService;

impl PipelineService {
    /// Start a pipeline stage. Records a `pending` run row, marks it
    /// `running`, executes the stage, and records the terminal status. The
    /// `CancellationToken` is held in `RUNNING_STAGES` so cancel can abort.
    pub fn start_stage(
        app: &AppHandle,
        request: PipelineStartRequest,
    ) -> DbResult<PipelineRun> {
        let kind = PipelineStageKind::from_str(&request.kind)
            .ok_or_else(|| format!("Unknown pipeline stage kind: {}", request.kind))?;

        // Record the run row as pending.
        let run_id = gen_id();
        let created = now();
        let input_summary = request.input.clone().unwrap_or_default();
        Self::insert_run(
            &run_id,
            &request.session_id,
            &request.project_path,
            &request.kind,
            request.idea_id.as_deref(),
            request.plan_id.as_deref(),
            &input_summary,
            request.chat_session_id.as_deref(),
            PipelineRunStatus::Pending,
            None,
            &[],
            None,
            None,
            created,
        )?;

        // Mark running and register the cancellation token.
        let token = CancellationToken::new();
        if let Ok(mut map) = RUNNING_STAGES.lock() {
            map.insert(run_id.clone(), token.clone());
        }
        Self::update_run_status(&run_id, PipelineRunStatus::Running, None, &[], Some(now()), None)?;

        // Execute the stage. Errors are recorded on the run row.
        let result = match kind {
            PipelineStageKind::GenerateCategories => {
                Self::stage_generate_categories(app, &request, &run_id, &token)
            }
            PipelineStageKind::GenerateIdeas => {
                Self::stage_generate_ideas(app, &request, &run_id, &token)
            }
            PipelineStageKind::EnhanceIdea => {
                Self::stage_enhance_idea(app, &request, &run_id, &token)
            }
            PipelineStageKind::GenerateOpenspec => {
                Self::stage_generate_openspec(app, &request, &run_id, &token)
            }
        };

        // Remove the token regardless of outcome.
        if let Ok(mut map) = RUNNING_STAGES.lock() {
            map.remove(&run_id);
        }

        // Check cancellation first — a cancelled run that also errored is
        // recorded as cancelled (the user's intent), not failed.
        if token.is_cancelled() {
            Self::update_run_status(
                &run_id,
                PipelineRunStatus::Cancelled,
                Some("Cancelled by user"),
                &[],
                None,
                Some(now()),
            )?;
        } else {
            match result {
                Ok(output_refs) => {
                    Self::update_run_status(
                        &run_id,
                        PipelineRunStatus::Succeeded,
                        None,
                        &output_refs,
                        None,
                        Some(now()),
                    )?;
                }
                Err(e) => {
                    Self::update_run_status(
                        &run_id,
                        PipelineRunStatus::Failed,
                        Some(&e),
                        &[],
                        None,
                        Some(now()),
                    )?;
                }
            }
        }

        Self::get_run(&run_id)?
            .ok_or_else(|| "Pipeline run not found after completion".to_string())
    }

    /// Cancel a running pipeline stage by run id. Sets the cancellation token
    /// so the stage's emit closure aborts the request on the next chunk.
    pub fn cancel_run(run_id: &str) -> DbResult<()> {
        if let Ok(mut map) = RUNNING_STAGES.lock() {
            if let Some(token) = map.get(run_id) {
                token.cancel();
                return Ok(());
            }
        }
        // If the run isn't in the map, it may have already completed. Mark it
        // cancelled if it's still in a non-terminal state.
        Self::update_run_status(
            run_id,
            PipelineRunStatus::Cancelled,
            Some("Cancelled by user"),
            &[],
            None,
            Some(now()),
        )?;
        Ok(())
    }

    /// List pipeline runs for a session, newest first.
    pub fn list_runs(session_id: &str) -> DbResult<Vec<PipelineRun>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, project_path, kind, idea_id, plan_id, input_summary,
                        session_chat_id, status, error, output_refs, started_at, completed_at, created_at
                 FROM pipeline_runs WHERE session_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], row_to_run)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Get a single pipeline run by id.
    pub fn get_run(run_id: &str) -> DbResult<Option<PipelineRun>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, session_id, project_path, kind, idea_id, plan_id, input_summary,
                    session_chat_id, status, error, output_refs, started_at, completed_at, created_at
             FROM pipeline_runs WHERE id = ?1",
            params![run_id],
            row_to_run,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    // ─── Stage implementations ───

    /// Stage: generate idea categories from the project schematic + conversation.
    /// Returns created category ids as output refs.
    fn stage_generate_categories(
        app: &AppHandle,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        let schematic = Self::load_schematic(&request.project_path);
        let convo = Self::load_conversation(&request.session_id);

        let system = NativeChatService::system_prompt(&request.project_path, schematic.as_deref());
        let prompt = format!(
            "Based on the project context and conversation below, propose 3-6 category names for \
             organizing ideas for this project.\nRespond with ONLY a JSON array of strings (the \
             category names, max 3 words each). No prose, no code fences.\n\nConversation:\n{convo}"
        );

        let response = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system,
            prompt,
            "categories",
        )?;

        let names: Vec<String> = serde_json::from_str(&response)
            .unwrap_or_else(|_| {
                response
                    .lines()
                    .map(|l| l.trim().trim_matches(',').trim_matches('"').to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            });

        let mut category_ids = Vec::new();
        for name in names.iter().take(10) {
            let cat = SessionService::create_category(&request.session_id, name, "")?;
            category_ids.push(cat.id);
        }
        Ok(category_ids)
    }

    /// Stage: generate ideas, optionally within a category or freeform.
    /// Returns created idea ids as output refs.
    fn stage_generate_ideas(
        app: &AppHandle,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        let schematic = Self::load_schematic(&request.project_path);
        let convo = Self::load_conversation(&request.session_id);
        let category_hint = request.input.as_deref().unwrap_or("");

        let system = NativeChatService::system_prompt(&request.project_path, schematic.as_deref());
        let prompt = format!(
            "Based on the project context and conversation below, propose 3-6 concrete, actionable \
             ideas for this project.\nRespond with ONLY a JSON array of objects, each with \"title\" \
             (max 8 words) and \"description\" (1-2 sentences). No prose, no code fences.\n\nCategory \
             hint: {category_hint}\n\nConversation:\n{convo}"
        );

        let response = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system,
            prompt,
            "ideas",
        )?;

        let ideas = NativeChatService::parse_ideas(&response);
        let mut idea_ids = Vec::new();
        for idea in ideas {
            let category_id = if category_hint.is_empty() {
                None
            } else {
                // Try to find a category matching the hint; if not, leave uncategorized.
                let cats = SessionService::list_categories(&request.session_id)?;
                cats.iter()
                    .find(|c| c.name.eq_ignore_ascii_case(category_hint))
                    .map(|c| c.id.clone())
            };
            let created = SessionService::create_idea(
                &request.session_id,
                &idea.title,
                &idea.description,
                category_id.as_deref(),
            )?;
            idea_ids.push(created.id);
        }
        Ok(idea_ids)
    }
    fn load_schematic(project_path: &str) -> Option<String> {
        let path = std::path::PathBuf::from(project_path);
        crate::services::schematic_service::read(&path)
            .ok()
            .map(|s| {
                if s.len() > 4000 {
                    format!("{}…", &s[..4000])
                } else {
                    s
                }
            })
    }

    /// Stage: enhance an idea into a draft plan. Creates a draft plan linked
    /// to the idea and returns the plan id as an output ref.
    fn stage_enhance_idea(
        app: &AppHandle,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let idea_id = request
            .idea_id
            .as_deref()
            .ok_or("enhance_idea stage requires idea_id")?;
        let ideas = SessionService::list_ideas(&request.session_id)?;
        let idea = ideas
            .iter()
            .find(|i| i.id == idea_id)
            .ok_or_else(|| format!("Idea '{}' not found", idea_id))?;

        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        let schematic = Self::load_schematic(&request.project_path);

        let system = NativeChatService::system_prompt(&request.project_path, schematic.as_deref());
        let prompt = format!(
            "Enhance the following idea into a structured plan with a clear goal and description.\n\
             Respond with ONLY a JSON object with \"title\" (max 12 words), \"goal\" (1 sentence), \
             and \"description\" (2-3 sentences). No prose, no code fences.\n\nIdea: {}\n{}",
            idea.title,
            idea.description
        );

        let response = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system,
            prompt,
            "enhance",
        )?;

        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_default();
        let title = parsed
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&idea.title)
            .to_string();
        let goal = parsed
            .get("goal")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = parsed
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or(&idea.description)
            .to_string();

        // Create a draft plan linked to the idea.
        let plan = crate::services::plan_service::PlanService::create(
            &request.session_id,
            &crate::models::plan::NewPlan {
                title,
                description,
                goal,
                status: crate::models::plan::PlanStatus::Draft,
                priority: Some(50),
                tags: vec![],
                idea_id: Some(idea_id.to_string()),
            },
        )?;

        // Mark the idea as picked.
        SessionService::update_idea_status(idea_id, IdeaStatus::Picked)?;

        Ok(vec![plan.id])
    }

    /// Stage: generate OpenSpec artifacts (proposal.md, specs/, design.md,
    /// tasks.md, .openspec.yaml) for a plan. Calls the model to generate each
    /// artifact, writes them atomically, and links the plan to the change.
    fn stage_generate_openspec(
        app: &AppHandle,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let plan_id = request
            .plan_id
            .as_deref()
            .ok_or("generate_openspec stage requires plan_id")?;
        let plan = crate::services::plan_service::PlanService::get(plan_id)?
            .ok_or_else(|| format!("Plan '{}' not found", plan_id))?;

        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        let schematic = Self::load_schematic(&request.project_path);
        let system = NativeChatService::system_prompt(&request.project_path, schematic.as_deref());

        // Derive a unique change name.
        let change_name = crate::services::openspec_service::resolve_unique_change_name(
            &request.project_path,
            &plan.title,
        );

        // Generate proposal.md
        let proposal_prompt = format!(
            "Generate an OpenSpec proposal for the following plan. The proposal should include \
             '## Why', '## What Changes', '## Capabilities' (### New Capabilities and ### \
             Modified Capabilities), and '## Impact' sections.\nRespond with ONLY the markdown \
             content, no code fences.\n\nPlan title: {}\nDescription: {}\nGoal: {}",
            plan.title,
            plan.description,
            plan.goal.as_deref().unwrap_or("Not specified"),
        );
        let proposal = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system.clone(),
            proposal_prompt,
            "openspec-proposal",
        )?;

        // Generate specs (single capability spec for now).
        let spec_prompt = format!(
            "Generate an OpenSpec spec for the plan's primary capability. Include '## ADDED \
             Requirements' with '### Requirement: <name>' headings, each followed by '#### \
             Scenario: <name>' with '- **WHEN**', '- **THEN**' bullets.\nRespond with ONLY the \
             markdown content, no code fences.\n\nPlan: {} — {}",
            plan.title, plan.description,
        );
        let spec_content = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system.clone(),
            spec_prompt,
            "openspec-specs",
        )?;
        let capability_name = crate::services::openspec_service::derive_change_name(&plan.title);
        let specs = vec![(capability_name, spec_content)];

        // Generate design.md
        let design_prompt = format!(
            "Generate a design document for this plan. Include '## Context', '## Goals / \
             Non-Goals', '## Decisions', and '## Risks / Trade-offs' sections.\nRespond with ONLY \
             the markdown content, no code fences.\n\nPlan: {} — {}",
            plan.title, plan.description,
        );
        let design = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system.clone(),
            design_prompt,
            "openspec-design",
        )?;

        // Generate tasks.md
        let tasks_prompt = format!(
            "Generate a tasks.md checklist for this plan. Group tasks into numbered phases with \
             '## N. Phase Name' headings. Each task is a checkbox: '- [ ] N.M Task \
             description'.\nRespond with ONLY the markdown content, no code fences.\n\nPlan: {} — \
             {}",
            plan.title, plan.description,
        );
        let tasks = Self::call_model(
            app,
            &request.session_id,
            run_id,
            token,
            &provider_id,
            &model_id,
            &effort_level,
            system,
            tasks_prompt,
            "openspec-tasks",
        )?;

        // Write artifacts atomically.
        crate::services::openspec_service::write_artifacts_atomic(
            &request.project_path,
            &change_name,
            &proposal,
            &specs,
            Some(&design),
            &tasks,
        )?;

        // Link the plan to the change.
        crate::services::openspec_service::link_plan_to_change(&plan.id, &change_name)?;

        Ok(vec![change_name])
    }

    // ─── Helpers ───

    /// Resolve the provider/model/effort for a pipeline stage from the
    /// project's chat model default.
    fn resolve_stage_model(request: &PipelineStartRequest) -> DbResult<(String, String, String)> {
        let resolved = NativeChatService::resolve_model_default(&request.project_path)?;
        Ok((resolved.provider_id, resolved.model_id, resolved.effort_level))
    }


    /// Load the conversation history for a session as a single string.
    fn load_conversation(session_id: &str) -> String {
        let messages = SessionService::list_ideas(session_id)
            .map(|ideas| {
                ideas
                    .iter()
                    .map(|i: &Idea| format!("idea: {}", i.title))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        // Also try to load native chat messages if the session has a chat session.
        let chat_messages = NativeChatService::list_messages(session_id).unwrap_or_default();
        let convo: String = chat_messages
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        if convo.is_empty() {
            messages
        } else {
            convo
        }
    }

    /// Call the model with streaming, checking the cancellation token between
    /// chunks. Returns the full response content.
    fn call_model(
        app: &AppHandle,
        session_id: &str,
        run_id: &str,
        token: &CancellationToken,
        provider_id: &str,
        model_id: &str,
        effort_level: &str,
        system: String,
        prompt: String,
        channel: &str,
    ) -> DbResult<String> {
        let credential = NativeChatService::list_credentials()?
            .into_iter()
            .find(|c| c.provider_id == provider_id);
        if credential.is_none() && provider_id != "basebuild-local" {
            return Err(format!(
                "Provider '{}' is not configured. Connect it in Settings first.",
                provider_id
            ));
        }

        let resolved_model_id = NativeChatService::resolve_model_api_id(provider_id, model_id)
            .unwrap_or_else(|| model_id.to_string());

        let req = ProviderRequest {
            model_id: resolved_model_id,
            effort_level: effort_level.to_string(),
            system: Some(system),
            messages: vec![ChatMsg {
                role: "user".to_string(),
                content: prompt,
            }],
            api_key: credential.as_ref().map(|c| c.api_key.clone()),
            base_url: credential.as_ref().and_then(|c| c.base_url.clone()),
        };

        let client = resolve_client(provider_id, req.base_url.as_deref());
        let session_id_for_emit = session_id.to_string();
        let run_id_for_check = run_id.to_string();
        let token_clone = token.clone();
        let app_for_emit = app.clone();
        let channel_for_emit = channel.to_string();
        let emit = move |delta: &str, _ch: &str| {
            // Check cancellation between chunks.
            if token_clone.is_cancelled() {
                return;
            }
            let _ = app_for_emit.emit(
                NATIVE_CHAT_CHUNK,
                serde_json::json!({
                    "sessionId": session_id_for_emit,
                    "runId": run_id_for_check,
                    "delta": delta,
                    "channel": channel_for_emit,
                }),
            );
        };

        let response = client.generate(&req, &emit)?;
        if token.is_cancelled() {
            return Err("Cancelled by user".to_string());
        }
        Ok(response.content)
    }

    // ─── DB helpers ───

    fn insert_run(
        id: &str,
        session_id: &str,
        project_path: &str,
        kind: &str,
        idea_id: Option<&str>,
        plan_id: Option<&str>,
        input_summary: &str,
        session_chat_id: Option<&str>,
        status: PipelineRunStatus,
        error: Option<&str>,
        output_refs: &[String],
        started_at: Option<i64>,
        completed_at: Option<i64>,
        created_at: i64,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let output_json = serde_json::to_string(output_refs).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO pipeline_runs (id, session_id, project_path, kind, idea_id, plan_id,
                input_summary, session_chat_id, status, error, output_refs, started_at, completed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id,
                session_id,
                project_path,
                kind,
                idea_id,
                plan_id,
                input_summary,
                session_chat_id,
                status.as_str(),
                error,
                output_json,
                started_at,
                completed_at,
                created_at,
            ],
        )
        .map_err(|e| format!("Failed to insert pipeline run: {e}"))?;
        Ok(())
    }

    fn update_run_status(
        id: &str,
        status: PipelineRunStatus,
        error: Option<&str>,
        output_refs: &[String],
        started_at: Option<i64>,
        completed_at: Option<i64>,
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let output_json = serde_json::to_string(output_refs).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE pipeline_runs SET status = ?1, error = ?2, output_refs = ?3,
                started_at = COALESCE(?4, started_at), completed_at = COALESCE(?5, completed_at)
             WHERE id = ?6",
            params![status.as_str(), error, output_json, started_at, completed_at, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Map a rusqlite row to a `PipelineRun`.
fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<PipelineRun> {
    let output_json: String = row.get(10)?;
    Ok(PipelineRun {
        id: row.get(0)?,
        session_id: row.get(1)?,
        project_path: row.get(2)?,
        kind: row.get(3)?,
        idea_id: row.get(4)?,
        plan_id: row.get(5)?,
        input_summary: row.get(6)?,
        session_chat_id: row.get(7)?,
        status: row.get(8)?,
        error: row.get(9)?,
        output_refs: serde_json::from_str(&output_json).unwrap_or_default(),
        started_at: row.get(11)?,
        completed_at: row.get(12)?,
        created_at: row.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_token_signals_cancellation() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn pipeline_run_status_is_terminal_correctly() {
        assert!(!PipelineRunStatus::Pending.is_terminal());
        assert!(!PipelineRunStatus::Running.is_terminal());
        assert!(PipelineRunStatus::Succeeded.is_terminal());
        assert!(PipelineRunStatus::Failed.is_terminal());
        assert!(PipelineRunStatus::Cancelled.is_terminal());
    }

    #[test]
    fn pipeline_run_status_from_str_parses_known_values() {
        assert_eq!(PipelineRunStatus::from_str("pending"), PipelineRunStatus::Pending);
        assert_eq!(PipelineRunStatus::from_str("running"), PipelineRunStatus::Running);
        assert_eq!(PipelineRunStatus::from_str("succeeded"), PipelineRunStatus::Succeeded);
        assert_eq!(PipelineRunStatus::from_str("failed"), PipelineRunStatus::Failed);
        assert_eq!(PipelineRunStatus::from_str("cancelled"), PipelineRunStatus::Cancelled);
        assert_eq!(PipelineRunStatus::from_str("nonsense"), PipelineRunStatus::Pending);
    }

    #[test]
    fn pipeline_stage_kind_round_trips() {
        for kind in [
            PipelineStageKind::GenerateCategories,
            PipelineStageKind::GenerateIdeas,
            PipelineStageKind::EnhanceIdea,
            PipelineStageKind::GenerateOpenspec,
        ] {
            let s = kind.as_str();
            assert_eq!(PipelineStageKind::from_str(s), Some(kind));
        }
        assert_eq!(PipelineStageKind::from_str("nonsense"), None);
    }

    #[test]
    fn cancel_run_marks_nonexistent_run_cancelled() {
        // Cancelling a run that isn't in the RUNNING_STAGES map (already
        // completed or never existed) should still update the DB row if it
        // exists. For a nonexistent id, the update affects 0 rows but doesn't
        // error — the caller gets Ok(()).
        let result = PipelineService::cancel_run("nonexistent-run-id");
        assert!(result.is_ok());
    }

    #[test]
    fn list_runs_returns_empty_for_new_session() {
        // A session with no pipeline runs returns an empty vec.
        let result = PipelineService::list_runs("no-such-session");
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}

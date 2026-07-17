use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    events::{NATIVE_CHAT_CHUNK, NATIVE_CHAT_TRANSCRIPT_UPDATED},
    models::{
        idea::{Idea, IdeaStatus},
        pipeline::{PipelineRun, PipelineRunStatus, PipelineStageKind, PipelineStartRequest},
        planning_event::PlanningEventKind,
    },
    services::{
        native_chat_service::NativeChatService,
        planning_events,
        provider_client::{resolve_client_for_model, ChatMsg, ProviderRequest},
        session_service::SessionService,
        storage_service::StorageService,
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
    pub fn start_stage<R: Runtime>(
        app: &AppHandle<R>,
        request: PipelineStartRequest,
    ) -> DbResult<PipelineRun> {
        let kind = PipelineStageKind::from_str(&request.kind)
            .ok_or_else(|| format!("Unknown pipeline stage kind: {}", request.kind))?;

        // Global concurrency cap: refuse to start a pipeline stage when the
        // total active run count (plan + pipeline, running + pending) has
        // reached `global_max`. The caller can retry once a slot frees.
        let global_max =
            crate::services::settings_service::SettingsService::effective_global_max() as i64;
        let active =
            crate::services::plan_runner_service::PlanRunnerService::count_active_runs(None)?;
        if active >= global_max {
            return Err(format!(
                "Global concurrency limit reached ({active}/{global_max} active runs). \
                 Wait for a run to finish or raise the global limit."
            ));
        }

        // A generate_openspec run gets a dedicated native chat session so the
        // user can open the background agent and watch each artifact stream
        // in. Best-effort: a provisioning failure degrades to a chat-less run
        // instead of blocking generation.
        let mut request = request;
        if kind == PipelineStageKind::GenerateOpenspec && request.chat_session_id.is_none() {
            let plan = request.plan_id.as_deref().and_then(|id| {
                crate::services::plan_service::PlanService::get(id)
                    .ok()
                    .flatten()
            });
            if let Some(plan) = plan {
                match NativeChatService::create_session_for_openspec_generation(&plan) {
                    Ok(chat) => request.chat_session_id = Some(chat.id),
                    Err(e) => {
                        eprintln!("[pipeline] OpenSpec chat session provisioning failed: {e}");
                    }
                }
            }
        }

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
        Self::update_run_status(
            app,
            &run_id,
            PipelineRunStatus::Running,
            None,
            &[],
            Some(now()),
            None,
        )?;

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

        let failure = result.as_ref().err().cloned();

        // Check cancellation first — a cancelled run that also errored is
        // recorded as cancelled (the user's intent), not failed.
        if token.is_cancelled() {
            Self::update_run_status(
                app,
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
                        app,
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
                        app,
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

        // Settle the bound chat session: record the terminal outcome as an
        // assistant message and clear the live-run indicator so the chat
        // panel stops showing a phantom thinking state.
        if let Some(chat_id) = request.chat_session_id.as_deref() {
            let outcome = if token.is_cancelled() {
                "cancelled"
            } else if failure.is_some() {
                "failed"
            } else {
                "succeeded"
            };
            let note = if token.is_cancelled() {
                Some("OpenSpec generation was cancelled.".to_string())
            } else {
                failure.map(|e| format!("**OpenSpec generation failed.**\n\n{e}"))
            };
            if let Some(note) = note {
                let _ = NativeChatService::insert_message(
                    chat_id, "assistant", &note, None, None, None, None,
                );
            }
            let _ = NativeChatService::set_session_run_state(chat_id, "idle");
            let _ = app.emit(
                NATIVE_CHAT_TRANSCRIPT_UPDATED,
                serde_json::json!({ "sessionId": chat_id, "outcome": outcome }),
            );
        }

        Self::get_run(&run_id)?.ok_or_else(|| "Pipeline run not found after completion".to_string())
    }

    /// Cancel a running pipeline stage by run id. Sets the cancellation token
    /// so the stage's emit closure aborts the request on the next chunk.
    pub fn cancel_run<R: Runtime>(app: &AppHandle<R>, run_id: &str) -> DbResult<()> {
        if let Ok(map) = RUNNING_STAGES.lock() {
            if let Some(token) = map.get(run_id) {
                token.cancel();
                return Ok(());
            }
        }
        // If the run isn't in the map, it may have already completed. Mark it
        // cancelled if it's still in a non-terminal state.
        Self::update_run_status(
            app,
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
                        session_chat_id, status, error, output_refs, started_at, completed_at, created_at,
                        provider_id, model_id
                 FROM pipeline_runs WHERE session_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], row_to_run)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// List pipeline runs for a project path, newest first. Used by the
    /// background agents dropdown so runs show up regardless of which
    /// workspace session created them.
    pub fn list_runs_by_project(project_path: &str) -> DbResult<Vec<PipelineRun>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, project_path, kind, idea_id, plan_id, input_summary,
                        session_chat_id, status, error, output_refs, started_at, completed_at, created_at,
                        provider_id, model_id
                 FROM pipeline_runs WHERE project_path = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], row_to_run)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Get a single pipeline run by id.
    pub fn get_run(run_id: &str) -> DbResult<Option<PipelineRun>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, session_id, project_path, kind, idea_id, plan_id, input_summary,
                    session_chat_id, status, error, output_refs, started_at, completed_at, created_at,
                    provider_id, model_id
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
    fn stage_generate_categories<R: Runtime>(
        app: &AppHandle<R>,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        Self::record_run_model(run_id, &provider_id, &model_id);
        let schematic = Self::load_schematic(&request.project_path);
        let convo = Self::load_conversation(&request.session_id);

        let system = crate::services::planning_prompt_service::PlanningPromptService::get(
            crate::models::planning_prompt::CATEGORY_GENERATION,
        )
        .unwrap_or_else(|_| {
            NativeChatService::system_prompt(&request.project_path, schematic.as_deref())
        });
        let focus = Self::focus_directive(&request.project_path);
        let digest =
            crate::services::planning_prompt_service::PlanningPromptService::decision_digest(
                &request.session_id,
                &request.project_path,
            );
        let focus_and_digest = match &digest {
            Some(d) => format!("{focus}\n\n{d}"),
            None => format!("{focus}\n\n## Recent decisions\n(No decisions since last schematic update — generate freely from the schematic.)"),
        };
        let preferences = Self::load_preferences(&request.project_path);
        let focus_full = match &preferences {
            Some(p) => format!("{focus_and_digest}\n\n{p}"),
            None => focus_and_digest.clone(),
        };
        let prompt = format!(
            "{focus_full}\n\n\
             Based on the project schematic and conversation below, propose 3-6 \
             category names for organizing ideas for THIS project's domain (not a \
             generic taxonomy like SEO/Optimization/Design — derive from the \
             schematic's Blueprint, Vision, and priorities).\n\
             Respond with ONLY a JSON array of strings (category names, max 3 words \
             each). No prose, no code fences.\n\n\
             Schematic:\n{schematic_text}\n\nConversation:\n{convo}",
            schematic_text = schematic.as_deref().unwrap_or("(no schematic)"),
            focus_full = focus_full,
            convo = convo,
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

        let names: Vec<String> = serde_json::from_str(&response).unwrap_or_else(|_| {
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
    fn stage_generate_ideas<R: Runtime>(
        app: &AppHandle<R>,
        request: &PipelineStartRequest,
        run_id: &str,
        token: &CancellationToken,
    ) -> DbResult<Vec<String>> {
        let (provider_id, model_id, effort_level) = Self::resolve_stage_model(request)?;
        Self::record_run_model(run_id, &provider_id, &model_id);
        let schematic = Self::load_schematic(&request.project_path);
        let convo = Self::load_conversation(&request.session_id);
        let category_hint = request.input.as_deref().unwrap_or("");

        let system = crate::services::planning_prompt_service::PlanningPromptService::get(
            crate::models::planning_prompt::IDEA_GENERATION,
        )
        .unwrap_or_else(|_| {
            NativeChatService::system_prompt(&request.project_path, schematic.as_deref())
        });
        let focus = Self::focus_directive(&request.project_path);
        let digest =
            crate::services::planning_prompt_service::PlanningPromptService::decision_digest(
                &request.session_id,
                &request.project_path,
            );
        let focus_and_digest = match &digest {
            Some(d) => format!("{focus}\n\n{d}"),
            None => format!("{focus}\n\n## Recent decisions\n(No decisions since last schematic update — generate freely from the schematic.)"),
        };
        let preferences = Self::load_preferences(&request.project_path);
        let focus_full = match &preferences {
            Some(p) => format!("{focus_and_digest}\n\n{p}"),
            None => focus_and_digest.clone(),
        };
        let existing_work = SessionService::list_ideas(&request.session_id)?
            .into_iter()
            .take(50)
            .map(|idea| format!("- idea [{}]: {}", idea.status.as_str(), idea.title))
            .chain(
                crate::services::plan_service::PlanService::list_for_project(
                    &request.project_path,
                )?
                .into_iter()
                .take(50)
                .map(|plan| format!("- plan [{}]: {}", plan.status.as_str(), plan.title)),
            )
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "{focus_full}\n\n\
             Based on the project schematic and conversation below, propose 3-6 \
             distinct, bounded ideas for this project. Inspect the repository, compare \
             trade-offs, and exclude duplicates from the existing-work list unless the \
             scope is materially different. Respond with ONLY a JSON array. Every object \
             requires \"title\", \"description\", \"grounding\", and \"assessment\". \
             assessment must be {{\"schemaVersion\":1,\"effort\":{{\"minHours\":integer,\"maxHours\":integer}},\
             \"difficulty\":1-5,\"impact\":1-5,\"risk\":1-5,\"confidence\":1-5,\
             \"rationale\":string,\"grounding\":[string],\"requiredCapabilities\":[string],\
             \"constraints\":[string],\"missingEvidence\":[string],\"alternatives\":[string]}}. \
             Ground estimates in real files, symbols, observed behavior, or explicit unknowns. \
             Low evidence requires low confidence and non-empty missingEvidence. Optionally include \
             \"anchor\" naming the Vision/End goal/priority served. No prose or code fences.\n\n\
             Existing ideas and plans (do not duplicate):\n{existing_work}\n\n\
             Category hint: {category_hint}\n\n\
             Schematic:\n{schematic_text}\n\nConversation:\n{convo}",
            schematic_text = schematic.as_deref().unwrap_or("(no schematic)"),
            focus_full = focus_full,
            category_hint = category_hint,
            convo = convo,
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
        if ideas.is_empty() {
            return Err("Idea generation returned no parseable JSON ideas.".to_string());
        }
        for (index, idea) in ideas.iter().enumerate() {
            if idea.grounding.trim().is_empty() {
                return Err(format!(
                    "Generated idea {index} is missing concrete grounding; no ideas were persisted."
                ));
            }
            let assessment = idea.assessment.as_ref().ok_or_else(|| {
                format!(
                    "Generated idea {index} is missing its versioned assessment; no ideas were persisted."
                )
            })?;
            assessment.validate().map_err(|error| {
                format!("Generated idea {index} has invalid {error}; no ideas were persisted.")
            })?;
        }
        let category_id = if category_hint.is_empty() {
            None
        } else {
            let categories = SessionService::list_categories(&request.session_id)?;
            categories
                .iter()
                .find(|category| category.name.eq_ignore_ascii_case(category_hint))
                .map(|category| category.id.clone())
        };
        let mut idea_ids = Vec::with_capacity(ideas.len());
        for idea in ideas {
            let created = SessionService::create_idea(
                &request.session_id,
                &idea.title,
                &idea.description,
                category_id.as_deref(),
                &idea.grounding,
                idea.anchor.as_deref(),
                Some(run_id),
                idea.assessment.as_ref(),
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

    /// Build a focus directive from the schematic: Vision, End goals, Current
    /// priorities, and Blueprint constraints. Assembled into generation prompts
    /// so ideas stay grounded in the project's actual goals (anti-feature-creep).
    fn focus_directive(project_path: &str) -> String {
        let path = std::path::PathBuf::from(project_path);
        let report = crate::services::schematic_service::inspect(&path);
        if !report.exists {
            return "No schematic found. Generation runs without grounding; \
                    consider creating a schematic first."
                .to_string();
        }
        let mut parts = Vec::new();
        parts.push("Focus directive:".to_string());
        parts.push(
            "Serve the project's Vision, End goals, and Current priorities first. \
             Decline generic filler that does not serve the goal."
                .to_string(),
        );
        if report.missing_year_goal || report.missing_month_goal {
            parts.push("Note: year-end or month-end goal is missing.".to_string());
        }
        if report.stale_goal {
            parts.push("Note: an end goal's period has passed.".to_string());
        }
        parts.join(" ")
    }

    /// Load the project's preferences file (`.basebuild/preferences.md`) if
    /// present. Injected into generation prompts so the user's stated
    /// preferences steer generation.
    fn load_preferences(project_path: &str) -> Option<String> {
        let path = std::path::PathBuf::from(project_path).join(".basebuild/preferences.md");
        let content = std::fs::read_to_string(&path).ok()?;
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(format!("## Project preferences\n{trimmed}"))
    }

    /// Stage: enhance an idea into a draft plan. Creates a draft plan linked
    /// to the idea and returns the plan id as an output ref.
    fn stage_enhance_idea<R: Runtime>(
        app: &AppHandle<R>,
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
        Self::record_run_model(run_id, &provider_id, &model_id);
        let schematic = Self::load_schematic(&request.project_path);

        let system = crate::services::planning_prompt_service::PlanningPromptService::get(
            crate::models::planning_prompt::PLAN_GENERATION,
        )
        .unwrap_or_else(|_| {
            NativeChatService::system_prompt(&request.project_path, schematic.as_deref())
        });
        let focus = Self::focus_directive(&request.project_path);
        let prompt = format!(
            "{focus}\n\n\
             Enhance the following idea into a structured plan with a clear goal \
             and description. Respond with ONLY a JSON object with \"title\" \
             (max 12 words), \"goal\" (1 sentence), and \"description\" \
             (2-3 sentences). No prose, no code fences.\n\n\
             Idea: {title}\n{desc}\n\n\
             Grounding: {grounding}\nAnchor: {anchor}",
            focus = focus,
            title = idea.title,
            desc = idea.description,
            grounding = idea.grounding,
            anchor = idea
                .anchor
                .as_deref()
                .unwrap_or("(none — outside current focus)"),
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
    fn stage_generate_openspec<R: Runtime>(
        app: &AppHandle<R>,
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
        Self::record_run_model(run_id, &provider_id, &model_id);
        let schematic = Self::load_schematic(&request.project_path);
        let system = NativeChatService::system_prompt(&request.project_path, schematic.as_deref());

        // When the run is bound to a chat session, stream deltas there on the
        // content channel (the chat panel renders them live) and persist each
        // artifact as an assistant message so the transcript survives reload.
        let chat_id = request.chat_session_id.as_deref();
        let stream_session: &str = chat_id.unwrap_or(&request.session_id);

        // Derive a unique change name.
        let change_name = crate::services::openspec_service::resolve_unique_change_name(
            &request.project_path,
            &plan.title,
        );

        // Prerequisite context: artifacts must acknowledge upstream plans so
        // the generated proposal/design/tasks build on prerequisite outputs
        // instead of re-planning their scope.
        let prereq_context =
            crate::services::plan_dependency_service::PlanDependencyService::get_dependencies(
                plan_id,
            )
            .map(|deps| deps.prerequisites)
            .unwrap_or_default()
            .iter()
            .filter_map(|id| {
                crate::services::plan_service::PlanService::get(id)
                    .ok()
                    .flatten()
            })
            .map(|p| format!("{} (status: {})", p.title, p.status.as_str()))
            .collect::<Vec<_>>()
            .join("; ");
        let prereq_context = if prereq_context.is_empty() {
            String::new()
        } else {
            format!(
                "\n\nPrerequisite plans (planned separately and guaranteed to finish before this \
                 plan runs — treat their outputs as available, do NOT re-plan their scope): \
                 {prereq_context}"
            )
        };

        // Generate each artifact with the same model. When chat-bound, a
        // status boundary is emitted before each artifact so the chat panel
        // promotes the previous stream into its own completed segment.
        let generate = |heading: &str, prompt: String, channel: &str| -> DbResult<String> {
            if let Some(chat) = chat_id {
                Self::emit_status(app, chat, run_id, "next");
            }
            let content = Self::call_model(
                app,
                stream_session,
                run_id,
                token,
                &provider_id,
                &model_id,
                &effort_level,
                system.clone(),
                prompt,
                if chat_id.is_some() { "content" } else { channel },
            )?;
            if let Some(chat) = chat_id {
                let _ = NativeChatService::insert_message(
                    chat,
                    "assistant",
                    &format!("## {heading}\n\n{content}"),
                    None,
                    Some(&provider_id),
                    Some(&model_id),
                    Some(&effort_level),
                );
                let _ = app.emit(
                    NATIVE_CHAT_TRANSCRIPT_UPDATED,
                    serde_json::json!({ "sessionId": chat }),
                );
            }
            Ok(content)
        };

        // Generate proposal.md
        let proposal_prompt = format!(
            "Generate an OpenSpec proposal for the following plan. The proposal should include \
             '## Why', '## What Changes', '## Capabilities' (### New Capabilities and ### \
             Modified Capabilities), and '## Impact' sections.\nRespond with ONLY the markdown \
             content, no code fences.\n\nPlan title: {}\nDescription: {}\nGoal: {}{prereq_context}",
            plan.title,
            plan.description,
            plan.goal.as_deref().unwrap_or("Not specified"),
        );
        let proposal = generate("Proposal", proposal_prompt, "openspec-proposal")?;

        // Generate specs (single capability spec for now).
        let spec_prompt = format!(
            "Generate an OpenSpec spec for the plan's primary capability. Include '## ADDED \
             Requirements' with '### Requirement: <name>' headings, each followed by '#### \
             Scenario: <name>' with '- **WHEN**', '- **THEN**' bullets.\nRespond with ONLY the \
             markdown content, no code fences.\n\nPlan: {} — {}",
            plan.title, plan.description,
        );
        let spec_content = generate("Spec", spec_prompt, "openspec-specs")?;
        let capability_name = crate::services::openspec_service::derive_change_name(&plan.title);
        let specs = vec![(capability_name, spec_content)];

        // Generate design.md
        let design_prompt = format!(
            "Generate a design document for this plan. Include '## Context', '## Goals / \
             Non-Goals', '## Decisions', and '## Risks / Trade-offs' sections.\nRespond with ONLY \
             the markdown content, no code fences.\n\nPlan: {} — {}{prereq_context}",
            plan.title, plan.description,
        );
        let design = generate("Design", design_prompt, "openspec-design")?;

        // Generate tasks.md
        let tasks_prompt = format!(
            "Generate a tasks.md checklist for this plan. Group tasks into numbered phases with \
             '## N. Phase Name' headings. Each task is a checkbox: '- [ ] N.M Task \
             description'.\nRespond with ONLY the markdown content, no code fences.\n\nPlan: {} — \
             {}{prereq_context}",
            plan.title, plan.description,
        );
        let tasks = generate("Tasks", tasks_prompt, "openspec-tasks")?;

        // Write artifacts atomically.
        crate::services::openspec_service::write_artifacts_atomic(
            &request.project_path,
            &change_name,
            &proposal,
            &specs,
            Some(&design),
            &tasks,
        )?;

        // Validate artifacts: check proposal has Why/What-Changes, specs have
        // requirements + scenarios, tasks.md has ≥1 task. If validation fails,
        // keep the plan in draft status and return an error with details.
        let change_dir =
            crate::services::openspec_service::change_dir(&request.project_path, &change_name);
        let validation = crate::services::openspec_service::validate_artifacts(&change_dir);
        if !validation.valid {
            // Artifacts are preserved on disk; plan stays in draft.
            let error_msg = format!(
                "Artifact validation failed: {}",
                validation.errors.join("; ")
            );
            // Record the validation error on the pipeline run.
            let _ = crate::services::native_chat_service::NativeChatService::record_pipeline_run(
                run_id,
                &request.session_id,
                &request.project_path,
                "generate_openspec",
                "failed",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
            );
            return Err(error_msg);
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct GeneratedPlanAssessment {
            implementation: crate::models::planning_assessment::ImplementationAssessment,
            parallelism: crate::models::planning_assessment::ParallelismGuidance,
        }

        // Shared schema block: embedded in the first prompt and re-sent
        // verbatim in every repair prompt so retries correct against the
        // exact contract the parser enforces.
        let assessment_schema = "{\"implementation\":{\"schemaVersion\":1,\
             \"effort\":{\"minHours\":<int>,\"maxHours\":<int>},\
             \"difficulty\":<1-5>,\"impact\":<1-5>,\"risk\":<1-5>,\"confidence\":<1-5>,\
             \"rationale\":\"<string>\",\"grounding\":[\"<string>\"],\
             \"requiredCapabilities\":[\"<string>\"],\"constraints\":[\"<string>\"],\
             \"missingEvidence\":[\"<string>\"],\"alternatives\":[\"<string>\"]},\
             \"parallelism\":{\"maxParallelTasks\":<1-16>,\"rationale\":\"<string>\"}}";

        let assessment_prompt = format!(
            "Assess the implementation represented by these validated OpenSpec artifacts. \
             Return ONLY one JSON object, no code fences and no prose, matching EXACTLY this \
             shape (field types are mandatory — every *list* field is a JSON array of strings, \
             never a single string):\n{assessment_schema}\n\
             Use honest ranges, cite artifact evidence in grounding items, lower confidence \
             when evidence is weak, and do not invent precision.\n\nPROPOSAL\n{proposal}\n\n\
             SPEC\n{}\n\nDESIGN\n{design}\n\nTASKS\n{tasks}",
            specs
                .first()
                .map(|(_, content)| content.as_str())
                .unwrap_or("")
        );

        // Self-correcting assessment: models routinely return almost-valid
        // JSON (stray fields, flattened lists, out-of-range ratings). Instead
        // of failing the whole run after every artifact was already written,
        // feed the exact rejection back to the model and let it repair its
        // own response, up to three attempts total.
        const MAX_ASSESSMENT_ATTEMPTS: usize = 3;
        let mut last_error = String::new();
        let mut last_response = String::new();
        let mut parsed_assessment: Option<GeneratedPlanAssessment> = None;
        for attempt in 1..=MAX_ASSESSMENT_ATTEMPTS {
            let (heading, prompt) = if attempt == 1 {
                ("Assessment".to_string(), assessment_prompt.clone())
            } else {
                (
                    format!("Assessment (retry {attempt})"),
                    format!(
                        "Your previous assessment response was rejected: {last_error}.\n\n\
                         Previous response:\n{last_response}\n\n\
                         Return ONLY the corrected JSON object — no code fences, no prose, \
                         no extra fields.\n{assessment_schema}"
                    ),
                )
            };
            let response = generate(&heading, prompt, "openspec-assessment")?;
            match serde_json::from_str::<GeneratedPlanAssessment>(extract_json_object(&response)) {
                Ok(generated) => match generated.implementation.validate() {
                    Ok(()) => {
                        parsed_assessment = Some(generated);
                        break;
                    }
                    Err(error) => {
                        last_error = format!("invalid {error}");
                        last_response = response;
                    }
                },
                Err(error) => {
                    last_error = format!("invalid JSON ({error})");
                    last_response = response;
                }
            }
        }
        let Some(generated) = parsed_assessment else {
            let report_note = Self::write_assessment_error_report(
                run_id,
                plan_id,
                &provider_id,
                &model_id,
                &last_error,
                &last_response,
                MAX_ASSESSMENT_ATTEMPTS,
            )
            .map(|path| {
                format!(
                    " Error report saved to {} — attach it when reporting this issue to \
                     basebuild.net.",
                    path.display()
                )
            })
            .unwrap_or_default();
            return Err(format!(
                "Plan assessment failed after {MAX_ASSESSMENT_ATTEMPTS} attempts: \
                 {last_error}.{report_note} Artifacts remain on disk; the plan stays draft."
            ));
        };
        let (completed_tasks, task_count) =
            crate::services::openspec_service::parse_task_progress(&tasks);
        debug_assert_eq!(completed_tasks, 0);
        let source_idea = plan
            .idea_id
            .as_deref()
            .map(SessionService::get_idea)
            .transpose()?
            .flatten();
        let inherited_idea_assessment = source_idea
            .as_ref()
            .and_then(|idea| idea.assessment.clone());
        let estimate_drift = inherited_idea_assessment.as_ref().map_or_else(
            || "No source idea assessment was available; this estimate starts from the validated task graph.".to_string(),
            |idea| {
                format!(
                    "Idea estimate {}-{}h became {}-{}h after validating {} task(s).",
                    idea.effort.min_hours,
                    idea.effort.max_hours,
                    generated.implementation.effort.min_hours,
                    generated.implementation.effort.max_hours,
                    task_count
                )
            },
        );
        let artifact_fingerprint =
            crate::services::openspec_service::assessment_artifact_fingerprint(
                &request.project_path,
                &change_name,
            )?;
        let artifact_chars = proposal
            .chars()
            .count()
            .saturating_add(
                specs
                    .iter()
                    .map(|(_, content)| content.chars().count())
                    .sum(),
            )
            .saturating_add(design.chars().count())
            .saturating_add(tasks.chars().count());
        let expected_context_tokens = u32::try_from(artifact_chars.div_ceil(4))
            .unwrap_or(2_000_000)
            .clamp(1, 2_000_000);
        let assessment = crate::models::planning_assessment::PlanAssessment {
            schema_version: crate::models::planning_assessment::ASSESSMENT_SCHEMA_VERSION,
            implementation: generated.implementation,
            artifact_fingerprint,
            source_idea_id: plan.idea_id.clone(),
            estimate_drift,
            expected_context_tokens,
            parallelism: generated.parallelism,
            assessed_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or_default(),
            stale: false,
        };
        assessment.validate()?;
        crate::services::plan_service::PlanService::save_assessment(&plan.id, &assessment)?;

        // Link the plan to the change.
        crate::services::openspec_service::link_plan_to_change(&plan.id, &change_name)?;

        // Chat-bound runs get a final summary message so the transcript ends
        // with the outcome instead of the raw assessment JSON.
        if let Some(chat) = chat_id {
            let _ = NativeChatService::insert_message(
                chat,
                "assistant",
                &format!(
                    "**OpenSpec change `{change_name}` created** — {task_count} task(s) across \
                     proposal.md, specs/, design.md, and tasks.md under \
                     `openspec/changes/{change_name}/`. The plan is linked to this change and \
                     its assessment is saved."
                ),
                None,
                Some(&provider_id),
                Some(&model_id),
                Some(&effort_level),
            );
            let _ = app.emit(
                NATIVE_CHAT_TRANSCRIPT_UPDATED,
                serde_json::json!({ "sessionId": chat }),
            );
        }

        Ok(vec![change_name])
    }

    // ─── Helpers ───

    /// Resolve the provider/model/effort for a pipeline stage from the
    /// project's chat model default.
    fn resolve_stage_model(request: &PipelineStartRequest) -> DbResult<(String, String, String)> {
        let resolved = NativeChatService::resolve_model_default(&request.project_path)?;
        Ok((
            resolved.provider_id,
            resolved.model_id,
            resolved.effort_level,
        ))
    }

    /// Write a local error report for a failed OpenSpec assessment so the
    /// user can attach it when reporting the issue. Local-first: the report
    /// lives under the global Basebuild data dir and is never uploaded.
    /// Best-effort — any failure is logged and swallowed (returns `None`).
    fn write_assessment_error_report(
        run_id: &str,
        plan_id: &str,
        provider_id: &str,
        model_id: &str,
        error: &str,
        raw_response: &str,
        attempts: usize,
    ) -> Option<std::path::PathBuf> {
        let paths = match crate::services::storage_paths::StoragePathService::ensure_global_layout()
        {
            Ok(paths) => paths,
            Err(e) => {
                eprintln!("[pipeline] assessment error report skipped: {e}");
                return None;
            }
        };
        let dir = paths.global_dir.join("error-reports");
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("[pipeline] assessment error report dir creation failed: {e}");
            return None;
        }
        let path = dir.join(format!("{run_id}.json"));
        let report = serde_json::json!({
            "runId": run_id,
            "kind": "generate_openspec",
            "planId": plan_id,
            "providerId": provider_id,
            "modelId": model_id,
            "error": error,
            "rawResponse": raw_response,
            "attempts": attempts,
            "createdAt": now(),
            "appVersion": env!("CARGO_PKG_VERSION"),
        });
        let body = serde_json::to_string_pretty(&report).unwrap_or_else(|_| report.to_string());
        if let Err(e) = std::fs::write(&path, body) {
            eprintln!("[pipeline] assessment error report write failed: {e}");
            return None;
        }
        Some(path)
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

    /// Emit a status-phase chunk on the native chat channel. The chat panel
    /// promotes buffered stream text into a completed live segment on
    /// "next", so each pipeline artifact renders as its own block.
    fn emit_status<R: Runtime>(app: &AppHandle<R>, session_id: &str, run_id: &str, phase: &str) {
        let _ = app.emit(
            NATIVE_CHAT_CHUNK,
            serde_json::json!({
                "sessionId": session_id,
                "runId": run_id,
                "delta": phase,
                "channel": "status",
            }),
        );
    }

    /// Call the model with streaming, checking the cancellation token between
    /// chunks. Returns the full response content.
    fn call_model<R: Runtime>(
        app: &AppHandle<R>,
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
            model_id: resolved_model_id.clone(),
            effort_level: effort_level.to_string(),
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

        let (api_kind, model_base_url) =
            NativeChatService::resolve_model_routing(provider_id, model_id);
        let client = resolve_client_for_model(
            provider_id,
            &api_kind,
            req.base_url.as_deref(),
            &model_base_url,
        );
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
}

/// Extract the outermost JSON object from a model response. Models routinely
/// wrap "ONLY JSON" answers in a ```json fence or a prose preamble; strict
/// parsing of the raw response then fails at line 1 column 1. Fences are
/// stripped first, then the span from the first `{` to the last `}` is taken.
fn extract_json_object(response: &str) -> &str {
    let trimmed = response.trim();
    let unfenced = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|rest| rest.trim_end().strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    match (unfenced.find('{'), unfenced.rfind('}')) {
        (Some(start), Some(end)) if start < end => &unfenced[start..=end],
        _ => unfenced,
    }
}

/// Build the ask_user tool schema for pipeline turns. Mirrors the schema in
/// tool_runtime_service::registry but as a ProviderClient ToolSchema.
fn ask_user_tool_schema() -> crate::services::provider_client::ToolSchema {
    crate::services::provider_client::ToolSchema {
        name: "ask_user".to_string(),
        description: "Present one or more questions to the user and wait for their response. Each question carries an id, a prompt, a kind (options, multi, confirm, text), an optional option list, an optional recommended-option index, and an optional allow-free-text flag. The loop pauses until the user responds or the run is cancelled.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "Questions to present.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "description": "Unique question id." },
                            "prompt": { "type": "string", "description": "The question text." },
                            "kind": { "type": "string", "enum": ["options", "multi", "confirm", "text"], "description": "Question kind." },
                            "options": {
                                "type": "array",
                                "description": "Options for options/multi/confirm kinds.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string", "description": "Option label." },
                                        "description": { "type": "string", "description": "Optional longer description." }
                                    },
                                    "required": ["label"]
                                }
                            },
                            "recommended": { "type": "integer", "description": "Index of recommended option." },
                            "allowFreeText": { "type": "boolean", "description": "Allow free-text even for options kind.", "default": false },
                            "detail": { "type": "string", "description": "Optional read-only preview/context shown in the card (e.g. prefilled field content to confirm)." }
                        },
                        "required": ["id", "prompt", "kind"]
                    }
                }
            },
            "required": ["questions"]
        }),
    }
}

/// Handle an ask_user tool call from a pipeline turn: parse questions,
/// persist a pending interaction, emit `native-chat://interactive-request`,
/// park until the user responds or cancels. Returns the answers (empty on
/// cancel/timeout).
fn handle_pipeline_ask_user(
    app: &AppHandle,
    session_id: &str,
    call: &crate::services::provider_client::ToolCallRequest,
    _token: &CancellationToken,
) -> DbResult<Vec<crate::models::interaction::QuestionAnswer>> {
    use crate::services::agent_loop_service::{InteractionResolution, PENDING_INTERACTIONS};
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::sync::LazyLock;

    let args: serde_json::Value =
        serde_json::from_str(&call.arguments).unwrap_or(serde_json::json!({}));
    let Some(questions) = args.get("questions").and_then(serde_json::Value::as_array) else {
        return Err("ask_user requires a 'questions' array.".to_string());
    };
    if questions.is_empty() {
        return Err("ask_user requires at least one question.".to_string());
    }
    let mut parsed: Vec<crate::models::interaction::Question> = Vec::with_capacity(questions.len());
    for q in questions {
        let id = q
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
        let prompt = q
            .get("prompt")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
        let kind_str = q
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("text");
        let kind = crate::models::interaction::QuestionKind::from_str(kind_str);
        let options: Vec<crate::models::interaction::QuestionOption> = q
            .get("options")
            .and_then(serde_json::Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|o| {
                        let label = o
                            .get("label")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        if label.is_empty() {
                            return None;
                        }
                        let description = o
                            .get("description")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string);
                        Some(crate::models::interaction::QuestionOption { label, description })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let recommended = q
            .get("recommended")
            .and_then(serde_json::Value::as_i64)
            .map(|i| i as usize);
        let allow_free_text = q
            .get("allowFreeText")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let detail = q
            .get("detail")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        parsed.push(crate::models::interaction::Question {
            id,
            prompt,
            kind,
            options,
            recommended,
            allow_free_text,
            detail,
            page_id: None,
            page_title: None,
            page_description: None,
            required: false,
            multiline: false,
            scale: None,
        });
    }
    let interaction = crate::services::interaction_service::InteractionService::create(
        session_id,
        Some(&call.id),
        &parsed,
    )?;
    let _ = app.emit(
        "native-chat://interactive-request",
        serde_json::json!({ "sessionId": session_id, "interactionId": interaction.id, "toolCallId": call.id }),
    );
    let project_path = SessionService::get(session_id)
        .ok()
        .flatten()
        .map(|session| session.project_path)
        .or_else(|| {
            NativeChatService::get_session(session_id)
                .ok()
                .flatten()
                .map(|session| session.project_path)
        });
    if let Some(project_path) = project_path {
        let _ = crate::services::notification_service::NotificationService::deliver(
            app,
            crate::models::notification::NotificationKind::PendingQuestion,
            &interaction.id,
            "interaction",
            &project_path,
            "Planner needs your input",
            Some("Open the planning chat to answer the pending question."),
        );
    }
    let (tx, rx) = mpsc::channel::<InteractionResolution>();
    {
        let mut pending = PENDING_INTERACTIONS.lock();
        pending.insert(interaction.id.clone(), tx);
    }
    match rx.recv_timeout(std::time::Duration::from_secs(600)) {
        Ok(resolution) => {
            if resolution.cancelled {
                let _ = crate::services::interaction_service::InteractionService::cancel(
                    &interaction.id,
                );
                Ok(Vec::new())
            } else {
                Ok(resolution.answers)
            }
        }
        Err(_) => {
            let _ =
                crate::services::interaction_service::InteractionService::cancel(&interaction.id);
            Ok(Vec::new())
        }
    }
}

impl PipelineService {
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

    /// Record the resolved provider/model on a run row so the UI can show
    /// which model a background stage runs with. Best-effort: a failure here
    /// never aborts the stage.
    fn record_run_model(run_id: &str, provider_id: &str, model_id: &str) {
        if let Ok(conn) = StorageService::connect() {
            let _ = conn.execute(
                "UPDATE pipeline_runs SET provider_id = ?1, model_id = ?2 WHERE id = ?3",
                params![provider_id, model_id, run_id],
            );
        }
    }

    fn update_run_status<R: Runtime>(
        app: &AppHandle<R>,
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
            params![
                status.as_str(),
                error,
                output_json,
                started_at,
                completed_at,
                id
            ],
        )
        .map_err(|e| e.to_string())?;

        // Emit a typed planning event for the stage transition. Best-effort:
        // fetch the run for title + project_path; missing data degrades to
        // the run id rather than failing the transition.
        let kind = match status {
            PipelineRunStatus::Running => Some(PlanningEventKind::StageStarted),
            PipelineRunStatus::Succeeded => Some(PlanningEventKind::StageSucceeded),
            PipelineRunStatus::Failed => Some(PlanningEventKind::StageFailed),
            PipelineRunStatus::Cancelled => Some(PlanningEventKind::StageCancelled),
            PipelineRunStatus::Pending => None,
        };
        if let Some(kind) = kind {
            if let Ok(Some(run)) = Self::get_run(id) {
                let title = format!("{}: {}", run.kind, status.as_str());
                planning_events::emit(
                    app,
                    kind,
                    &run.id,
                    &run.project_path,
                    Some(run.session_id.clone()),
                    &title,
                    error.map(str::to_string),
                );
            }
        }
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
        provider_id: row.get(14)?,
        model_id: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(target_os = "windows"))]
    use tauri::Manager;
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
        assert_eq!(
            PipelineRunStatus::from_str("pending"),
            PipelineRunStatus::Pending
        );
        assert_eq!(
            PipelineRunStatus::from_str("running"),
            PipelineRunStatus::Running
        );
        assert_eq!(
            PipelineRunStatus::from_str("succeeded"),
            PipelineRunStatus::Succeeded
        );
        assert_eq!(
            PipelineRunStatus::from_str("failed"),
            PipelineRunStatus::Failed
        );
        assert_eq!(
            PipelineRunStatus::from_str("cancelled"),
            PipelineRunStatus::Cancelled
        );
        assert_eq!(
            PipelineRunStatus::from_str("nonsense"),
            PipelineRunStatus::Pending
        );
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
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        // cancel_run now requires an AppHandle for event emission. On a
        // nonexistent run, update_run_status is called but get_run returns
        // None so no event is emitted. The tauri test mock requires Wry
        // runtime DLLs that may not be available in CI, so this test is
        // gated on not-Windows.
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result = PipelineService::cancel_run(&app, "nonexistent-run-id");
            assert!(result.is_ok());
        }
    }

    #[test]
    fn list_runs_returns_empty_for_new_session() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let result = PipelineService::list_runs("no-such-session");
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn extract_json_object_passes_plain_json_through() {
        assert_eq!(extract_json_object(r#"{"a":1}"#), r#"{"a":1}"#);
        assert_eq!(extract_json_object("  {\"a\":1}\n"), "{\"a\":1}");
    }

    #[test]
    fn extract_json_object_strips_markdown_fences() {
        assert_eq!(extract_json_object("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(extract_json_object("```\n{\"a\":1}\n```"), "{\"a\":1}");
    }

    #[test]
    fn extract_json_object_takes_outermost_braces_from_prose() {
        assert_eq!(
            extract_json_object("Here is the assessment:\n{\"a\":{\"b\":2}}\nDone."),
            "{\"a\":{\"b\":2}}"
        );
    }

    #[test]
    fn extract_json_object_returns_input_when_no_object_found() {
        assert_eq!(extract_json_object("no json here"), "no json here");
    }
}

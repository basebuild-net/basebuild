use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::{
    events::PLAN_RUN_EVENT,
    models::plan::PlanStatus,
    models::plan_run::{
        EnqueuePlanRequest, ExecutionProfile, PlanQueueEntry, PlanRun, PlanRunEvent,
        PlanRunStatus, RunnerKind, StartQueueRequest,
    },
    models::planning_event::PlanningEventKind,
    services::{
        native_chat_service::NativeChatService, openspec_service, plan_service::PlanService,
        planning_events, session_service::SessionService, storage_service::StorageService,
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

/// Cancellation token for a running plan run. Held in `RUNNING_RUNS` keyed
/// by run id so the cancel command can signal the run without a reference.
#[derive(Debug, Default, Clone)]
pub struct RunCancellationToken {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

impl RunCancellationToken {
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

static RUNNING_RUNS: std::sync::LazyLock<Mutex<HashMap<String, RunCancellationToken>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
/// Per-provider in-flight semaphores (`run-concurrency-limits`). Each
/// provider gets a semaphore sized to its effective concurrency limit
/// (project override else global default else conservative `1`). Runs +
/// subagents both acquire here, so they count together against the provider
/// cap. Replaces the former single-`N` semaphore.
static PROVIDER_SEMAPHORES: std::sync::LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Per-session queue state: whether the queue is paused and the active
/// execution profile. Held in memory so the scheduler loop can read it
/// without hitting the DB on every tick.
#[derive(Debug, Default, Clone)]
struct QueueState {
    paused: bool,
    profile: Option<ExecutionProfile>,
    overrides: HashMap<String, ExecutionProfile>,
}

static QUEUE_STATE: std::sync::LazyLock<Mutex<HashMap<String, QueueState>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Default)]
pub struct PlanRunnerService;

impl PlanRunnerService {
    // ── Queue CRUD ───────────────────────────────────────────────────────

    /// Enqueue a plan at the end of a session's queue.
    pub fn enqueue(request: EnqueuePlanRequest) -> DbResult<PlanQueueEntry> {
        if request.session_id.trim().is_empty() {
            return Err("Session id is required.".to_string());
        }
        if request.plan_id.trim().is_empty() {
            return Err("Plan id is required.".to_string());
        }
        let conn = StorageService::connect()?;
        // Current max sort_order for this session.
        let next_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM plan_queue WHERE session_id = ?1",
                params![request.session_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let entry = PlanQueueEntry {
            id: gen_id(),
            session_id: request.session_id.clone(),
            plan_id: request.plan_id.clone(),
            sort_order: next_order,
            created_at: now(),
        };
        conn.execute(
            "INSERT INTO plan_queue (id, session_id, plan_id, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![entry.id, entry.session_id, entry.plan_id, entry.sort_order, entry.created_at],
        )
        .map_err(|e| format!("Failed to enqueue plan: {e}"))?;
        Ok(entry)
    }

    pub fn list_queue(session_id: &str) -> DbResult<Vec<PlanQueueEntry>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, plan_id, sort_order, created_at
                 FROM plan_queue WHERE session_id = ?1 ORDER BY sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(PlanQueueEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn reorder(session_id: &str, entry_id: &str, new_order: i64) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE plan_queue SET sort_order = ?1 WHERE id = ?2 AND session_id = ?3",
            params![new_order, entry_id, session_id],
        )
        .map_err(|e| format!("Failed to reorder queue: {e}"))?;
        Ok(())
    }

    pub fn remove_from_queue(entry_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM plan_queue WHERE id = ?1", params![entry_id])
            .map_err(|e| format!("Failed to remove queue entry: {e}"))?;
        Ok(())
    }

    /// Emit a typed planning event for a run lifecycle transition, alongside
    /// the existing `PLAN_RUN_EVENT`. Best-effort: fetches plan title + project
    /// path from the run's session; missing data degrades to empty strings
    /// rather than failing the run.
    fn emit_planning_event(app: &AppHandle, run: &PlanRun, kind: PlanningEventKind, detail: Option<String>) {
        let title = PlanService::get(&run.plan_id)
            .ok()
            .flatten()
            .map(|p| p.title)
            .unwrap_or_else(|| run.plan_id.clone());
        let project_path = SessionService::get(&run.session_id)
            .ok()
            .flatten()
            .map(|s| s.project_path)
            .unwrap_or_default();
        planning_events::emit(
            app,
            kind,
            &run.id,
            &project_path,
            Some(run.session_id.clone()),
            &title,
            detail,
        );
    }

    // ── Run lifecycle ───────────────────────────────────────────────────

    /// Start the queue: resolves the profile, then dispatches runs up to
    /// the concurrency limit. The dispatcher runs in a dedicated thread per
    /// session so it survives frontend unmounts.
    pub fn start_queue(app: AppHandle, request: StartQueueRequest) -> DbResult<()> {
        let session_id = request.session_id.clone();
        let profile = request.profile.clone();
        let overrides = request
            .plan_overrides
            .unwrap_or_default()
            .into_iter()
            .map(|o| {
                (
                    o.plan_id.clone(),
                    ExecutionProfile {
                        concurrency: profile.concurrency,
                        provider_id: o.provider_id,
                        model_id: o.model_id,
                        effort_level: o.effort_level,
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        // Store queue state for the scheduler loop.
        if let Ok(mut states) = QUEUE_STATE.lock() {
            states.insert(
                session_id.clone(),
                QueueState {
                    paused: false,
                    profile: Some(profile.clone()),
                    overrides,
                },
            );
        }

        // Spawn the dispatcher thread. It acquires a tokio semaphore permit
        // per run, up to concurrency. Without worktrees (non-git project),
        // concurrency is hard-capped at 1.
        let project_path = SessionService::get(&session_id)
            .ok()
            .flatten()
            .map(|s| s.project_path)
            .unwrap_or_default();
        let worktrees_enabled = Self::worktrees_enabled_for(&project_path);
        let concurrency = profile.concurrency.max(1).min(if worktrees_enabled {
            profile.concurrency
        } else {
            1
        });
        let app_clone = app.clone();
        let sid = session_id.clone();
        std::thread::spawn(move || {
            Self::dispatch_loop(app_clone, sid, concurrency);
        });

        Ok(())
    }

    /// Pause the queue: no new runs are dispatched, but in-flight runs
    /// continue. The user can resume with `start_queue` again.
    pub fn pause_queue(session_id: &str) -> DbResult<()> {
        if let Ok(mut states) = QUEUE_STATE.lock() {
            if let Some(state) = states.get_mut(session_id) {
                state.paused = true;
            }
        }
        Ok(())
    }

    /// Cancel a running plan run by run id. Sets the cancellation token so
    /// the run aborts on the next check. Returns the plan to `ready` (or
    /// `cancelled` if the user chose that) — artifacts are kept.
    pub fn cancel_run(app: &AppHandle, run_id: &str, cancel_plan: bool) -> DbResult<()> {
        if let Ok(map) = RUNNING_RUNS.lock() {
            if let Some(token) = map.get(run_id) {
                token.cancel();
            }
        }
        let now = now();
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE plan_runs SET status = 'cancelled', finished_at = ?1 WHERE id = ?2",
            params![now, run_id],
        )
        .map_err(|e| format!("Failed to cancel plan run: {e}"))?;

        // Emit the cancelled event.
        let run = Self::get_run(run_id)?;
        if let Some(run) = &run {
            let _ = app.emit(
                PLAN_RUN_EVENT,
                PlanRunEvent {
                    run_id: run.id.clone(),
                    session_id: run.session_id.clone(),
                    plan_id: run.plan_id.clone(),
                    status: PlanRunStatus::Cancelled,
                    chat_session_id: run.chat_session_id.clone(),
                    error: Some("Cancelled by user".to_string()),
                },
            );
            Self::emit_planning_event(
                app,
                run,
                PlanningEventKind::StageCancelled,
                Some("Run cancelled by user".to_string()),
            );
            // Return the plan to ready (or cancelled if the user chose).
            let new_status = if cancel_plan {
                PlanStatus::Cancelled
            } else {
                PlanStatus::Ready
            };
            let _ = PlanService::set_status(&run.plan_id, new_status);
        }
        Ok(())
    }

    /// Mark a run complete: called by the completion detector (all tasks
    /// checked or explicit user done). Stamps `finished_at` and transitions
    /// the plan to `finished` if final-touches (phase 8) succeeds.
    pub fn complete_run(app: &AppHandle, run_id: &str, succeeded: bool) -> DbResult<()> {
        let now = now();
        let conn = StorageService::connect()?;
        let status = if succeeded { "succeeded" } else { "failed" };
        conn.execute(
            "UPDATE plan_runs SET status = ?1, finished_at = ?2 WHERE id = ?3",
            params![status, now, run_id],
        )
        .map_err(|e| format!("Failed to complete plan run: {e}"))?;

        let run = Self::get_run(run_id)?;
        if let Some(run) = &run {
            // If succeeded, run final-touches before transitioning.
            let new_plan_status = if succeeded {
                // Run the final-touches pipeline.
                let session = SessionService::get(&run.session_id)
                    .ok()
                    .flatten();
                let project_path = session
                    .as_ref()
                    .map(|s| s.project_path.as_str())
                    .unwrap_or("");
                let step_results = if !project_path.is_empty() {
                    crate::services::final_touches_service::FinalTouchesService::execute_steps(
                        project_path,
                    )
                    .unwrap_or_default()
                } else {
                    Vec::new()
                };
                let _ = Self::update_run_steps(run_id, &step_results);
                let any_failed = step_results.iter().any(|r| r.status == "failed");
                if any_failed {
                    let _ = conn.execute(
                        "UPDATE plan_runs SET status = 'failed' WHERE id = ?1",
                        params![run_id],
                    );
                    PlanStatus::Ready
                } else if !Self::evaluate_checklist_completion(&run) {
                    // Checklist incomplete → park in awaiting_review.
                    let _ = conn.execute(
                        "UPDATE plan_runs SET status = 'awaiting_review' WHERE id = ?1",
                        params![run_id],
                    );
                    // Emit a planning event for the review prompt.
                    let _ = crate::services::planning_events::emit(
                        app,
                        PlanningEventKind::RunFinished,
                        &run.plan_id,
                        project_path,
                        Some(run.session_id.clone()),
                        "Run awaiting review".to_string(),
                        Some("Checklist incomplete — mark as complete or keep running.".to_string()),
                    );
                    PlanStatus::Running // Keep plan running while awaiting review.
                } else {
                    PlanStatus::Finished
                }
            } else {
                PlanStatus::Ready
            };
            let _ = PlanService::set_status(&run.plan_id, new_plan_status);
            let _ = app.emit(
                PLAN_RUN_EVENT,
                PlanRunEvent {
                    run_id: run.id.clone(),
                    session_id: run.session_id.clone(),
                    plan_id: run.plan_id.clone(),
                    status: if succeeded {
                        PlanRunStatus::Succeeded
                    } else {
                        PlanRunStatus::Failed
                    },
                    chat_session_id: run.chat_session_id.clone(),
                    error: if succeeded {
                        None
                    } else {
                        Some("Run failed".to_string())
                    },
                },
            );
            let (run_kind, run_detail) = if succeeded {
                (PlanningEventKind::RunFinished, None)
            } else {
                (
                    PlanningEventKind::RunFailed,
                    Some("Run failed".to_string()),
                )
            };
            Self::emit_planning_event(app, run, run_kind, run_detail);
            // Re-align nudge: if the plan finished and the schematic mtime
            // predates the run start, emit a drift-suspected notification.
            if succeeded && new_plan_status == PlanStatus::Finished {
                let session = SessionService::get(&run.session_id).ok().flatten();
                let project_path = session.as_ref().map(|s| s.project_path.as_str()).unwrap_or("");
                if !project_path.is_empty() {
                    let schematic_mtime = std::fs::metadata(
                        std::path::Path::new(project_path).join(".basebuild/project-schematic.md"),
                    )
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                    let run_start = run.started_at.unwrap_or(0);
                    if schematic_mtime > 0 && run_start > 0 && schematic_mtime < run_start {
                        // Schematic is older than the run — drift suspected.
                        let _ = crate::services::planning_events::emit(
                            app,
                            PlanningEventKind::SchematicUpdated,
                            run.plan_id.clone(),
                            project_path,
                            Some(run.session_id.clone()),
                            "Schematic drift suspected".to_string(),
                            Some("Plan finished but schematic predates the run. Consider re-aligning the schematic.".to_string()),
                        );
                        let _ = crate::services::notification_service::NotificationService::insert(
                            crate::models::notification::NotificationKind::SchematicDriftSuspected,
                            &run.plan_id,
                            "plan",
                            project_path,
                            "Schematic drift suspected",
                            Some("Plan finished but the schematic hasn't been updated since before the run. Re-align the schematic to reflect completed work."),
                        );
                    }
                }
            }
        }
        Ok(())
    }

    /// Mark a run as manually complete. Transitions an `awaiting_review`
    /// or `succeeded` run to fully finished, sets the plan to `Finished`,
    /// and emits events. Used by the completion card "Mark as complete" action.
    pub fn mark_complete(app: &AppHandle, run_id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let now = now();
        // Verify the run exists and is in a completable state.
        let run = Self::get_run(run_id)?;
        let run = run.ok_or("Run not found")?;
        if !matches!(run.status, PlanRunStatus::AwaitingReview | PlanRunStatus::Succeeded) {
            return Err(format!(
                "Cannot mark complete: run is {} (must be awaiting_review or succeeded).",
                run.status.as_str()
            ));
        }
        // Update run status to succeeded.
        conn.execute(
            "UPDATE plan_runs SET status = 'succeeded', finished_at = ?1 WHERE id = ?2",
            params![now, run_id],
        )
        .map_err(|e| format!("Failed to mark run complete: {e}"))?;
        // Set plan to finished.
        let _ = PlanService::set_status(&run.plan_id, PlanStatus::Finished);
        // Emit run event.
        let _ = app.emit(
            PLAN_RUN_EVENT,
            PlanRunEvent {
                run_id: run.id.clone(),
                session_id: run.session_id.clone(),
                plan_id: run.plan_id.clone(),
                status: PlanRunStatus::Succeeded,
                error: None,
                chat_session_id: run.chat_session_id.clone(),
            },
        );
        Ok(())
    }

    /// Evaluate checklist completion at run end. If the linked change has an
    /// incomplete tasks.md, park the run in `awaiting_review` instead of
    /// auto-completing. Returns true if the run should auto-complete, false
    /// if it should park.
    fn evaluate_checklist_completion(run: &PlanRun) -> bool {
        // Get the linked plan's change_name.
        let plan = PlanService::get(&run.plan_id).ok().flatten();
        let plan = match plan {
            Some(p) => p,
            None => return true, // No plan → auto-complete.
        };
        let change_name = match &plan.change_name {
            Some(c) => c,
            None => return true, // No change → auto-complete.
        };
        let session = SessionService::get(&run.session_id).ok().flatten();
        let project_path = session
            .as_ref()
            .map(|s| s.project_path.as_str())
            .unwrap_or("");
        if project_path.is_empty() {
            return true;
        }
        let (completed, total) =
            crate::services::openspec_service::read_task_progress(project_path, change_name);
        if total == 0 {
            return true; // No tasks → auto-complete.
        }
        completed == total // All tasks done → auto-complete.
    }

    /// Update the steps_output JSON on a plan_run row.
    fn update_run_steps(
        run_id: &str,
        steps: &[crate::services::final_touches_service::FinalTouchStepResult],
    ) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let json = serde_json::to_string(steps).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE plan_runs SET steps_output = ?1 WHERE id = ?2",
            params![json, run_id],
        )
        .map_err(|e| format!("Failed to update run steps: {e}"))?;
        Ok(())
    }

    pub fn list_runs(session_id: &str) -> DbResult<Vec<PlanRun>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, plan_id, session_id, chat_session_id, workspace_path, status,
                        runner_kind, error, steps_output, started_at, finished_at, created_at
                 FROM plan_runs WHERE session_id = ?1 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], Self::map_run)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn get_run(run_id: &str) -> DbResult<Option<PlanRun>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, plan_id, session_id, chat_session_id, workspace_path, status,
                    runner_kind, error, steps_output, started_at, finished_at, created_at
             FROM plan_runs WHERE id = ?1",
            params![run_id],
            Self::map_run,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Check whether a plan run is complete by reading its `tasks.md`
    /// checkbox progress. If all tasks are checked (completed > 0 and
    /// completed == total), the run is auto-completed as succeeded. Returns
    /// the (completed, total) counts so the UI can display progress.
    pub fn check_run_completion(app: &AppHandle, run_id: &str) -> DbResult<(u32, u32)> {
        let run = Self::get_run(run_id)?
            .ok_or_else(|| "Plan run not found".to_string())?;
        if run.status != PlanRunStatus::Running {
            return Ok((0, 0));
        }
        let plan = PlanService::get(&run.plan_id)?
            .ok_or_else(|| "Plan not found".to_string())?;
        let session = SessionService::get(&plan.session_id)?
            .ok_or_else(|| "Session not found".to_string())?;
        let project_path = &session.project_path;
        let change_name = plan.change_name.as_deref().unwrap_or("");
        if change_name.is_empty() {
            return Ok((0, 0));
        }
        let (completed, total) = openspec_service::read_task_progress(project_path, change_name);
        if total > 0 && completed == total {
            Self::complete_run(app, run_id, true)?;
        }
        Ok((completed, total))
    }

    /// Start an OMP runner plan run: records a plan_run with `runner_kind=omp`,
    /// transitions the plan to `running`, and emits a `plan_run://event` so
    /// the frontend opens an OMP terminal tab seeded with the plan's reference
    /// id + OpenSpec change path. The OMP terminal is spawned on the frontend
    /// side (existing omp tab creation path) — the backend only records state
    /// and emits the event.
    pub fn start_omp_run(app: &AppHandle, session_id: &str, plan_id: &str) -> DbResult<PlanRun> {
        let run_id = gen_id();
        let created = now();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO plan_runs (id, plan_id, session_id, chat_session_id, workspace_path,
             status, runner_kind, error, steps_output, started_at, finished_at, created_at)
             VALUES (?1, ?2, ?3, NULL, NULL, 'running', 'omp', NULL, '[]', ?4, NULL, ?5)",
            params![run_id, plan_id, session_id, created, created],
        )
        .map_err(|e| format!("Failed to insert OMP plan run: {e}"))?;

        // Transition the plan to running.
        let _ = PlanService::set_status(plan_id, PlanStatus::Running);

        // Emit the running event so the frontend opens the OMP tab.
        let _ = app.emit(
            PLAN_RUN_EVENT,
            PlanRunEvent {
                run_id: run_id.clone(),
                session_id: session_id.to_string(),
                plan_id: plan_id.to_string(),
                status: PlanRunStatus::Running,
                chat_session_id: None,
                error: None,
            },
        );

        // Emit a typed planning event so the inspector/flow board react live.
        if let Some(run) = Self::get_run(&run_id)? {
            Self::emit_planning_event(app, &run, PlanningEventKind::RunStarted, None);
        }

        Self::get_run(&run_id)?
            .ok_or_else(|| "OMP plan run not found after creation".to_string())
    }
    // ── Dispatcher ──────────────────────────────────────────────────────

    /// Dispatch loop: pulls the next pending queue entry, provisions a
    /// session, and runs the plan. Respects pause and cancellation.
    fn dispatch_loop(app: AppHandle, session_id: String, concurrency: u32) {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => return,
        };
        // Legacy single-N semaphore kept as a fallback ceiling; the real
        // bound is per-provider (below). This preserves the old behavior for
        // callers that never set per-provider limits.
        let _legacy_cap = concurrency.max(1);

        loop {
            // Check pause state.
            let paused = QUEUE_STATE
                .lock()
                .ok()
                .and_then(|s| s.get(&session_id).map(|q| q.paused))
                .unwrap_or(true);
            if paused {
                std::thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }

            // Find the next pending queue entry that doesn't already have a
            // running/succeeded/failed plan_run.
            let next = match Self::next_pending_entry(&session_id) {
                Ok(Some(entry)) => entry,
                Ok(None) => break, // Queue empty or all dispatched.
                Err(_) => break,
            };

            // Resolve the profile for this plan (override or default).
            let profile = QUEUE_STATE
                .lock()
                .ok()
                .and_then(|s| {
                    s.get(&session_id).and_then(|q| {
                        q.overrides
                            .get(&next.plan_id)
                            .cloned()
                            .or_else(|| q.profile.clone())
                    })
                })
                .unwrap_or(ExecutionProfile {
                    concurrency: 1,
                    provider_id: String::new(),
                    model_id: String::new(),
                    effort_level: None,
                });

            // Acquire a per-provider permit (blocks if at the provider's
            // effective concurrency limit). Falls back to a single permit
            // when the provider is unknown (empty).
            let provider_id = profile.provider_id.clone();
            let project_path = SessionService::get(&session_id)
                .ok()
                .flatten()
                .map(|s| s.project_path)
                .unwrap_or_default();
            let permit = if provider_id.is_empty() {
                // No provider bound — use a 1-permit fallback.
                let fallback = Arc::new(tokio::sync::Semaphore::new(1));
                runtime.block_on(async { fallback.acquire_owned().await })
            } else {
                let sem = Self::provider_semaphore(&project_path, &provider_id, &runtime);
                runtime.block_on(async { sem.acquire_owned().await })
            };
            let permit = match permit {
                Ok(p) => p,
                Err(_) => break,
            };

            let app_clone = app.clone();
            let sid = session_id.clone();
            std::thread::spawn(move || {
                let _permit = permit; // Released on drop.
                let _ = Self::execute_run(&app_clone, &sid, &next, &profile);
            });
        }
    }

    /// Get or create the semaphore for a provider in a project, sized to the
    /// effective concurrency limit (project override → global → conservative `1`).
    /// If the limit changed since the semaphore was created, it is rebuilt.
    fn provider_semaphore(
        project_path: &str,
        provider_id: &str,
        _runtime: &tokio::runtime::Runtime,
    ) -> Arc<tokio::sync::Semaphore> {
        let entry = crate::services::settings_service::SettingsService::effective_run_concurrency(
            project_path, provider_id,
        ).unwrap_or_default();
        let limit = entry.max_concurrency.max(1) as usize;
        if let Ok(mut map) = PROVIDER_SEMAPHORES.lock() {
            // Rebuild if the limit changed. tokio Semaphore can't be resized
            // after creation, so we replace it when the configured limit differs.
            let needs_rebuild = map
                .get(provider_id)
                .map(|sem| sem.available_permits() > limit || sem.available_permits() == 0)
                .unwrap_or(true);
            if needs_rebuild || !map.contains_key(provider_id) {
                let sem = Arc::new(tokio::sync::Semaphore::new(limit));
                map.insert(provider_id.to_string(), sem);
            }
            map.get(provider_id).unwrap().clone()
        } else {
            Arc::new(tokio::sync::Semaphore::new(limit))
        }
    }

    /// Execute a single plan run: provision a session, mark the plan running,
    /// and emit the running event. The actual agent turn is driven by the
    /// user sending a message in the provisioned session (the opening context
    /// primes it). Completion is detected by task-progress polling (phase 8
    /// final-touches gate) or explicit user action.
    fn execute_run(
        app: &AppHandle,
        session_id: &str,
        entry: &PlanQueueEntry,
        profile: &ExecutionProfile,
    ) -> DbResult<PlanRun> {
        let run_id = gen_id();
        let created = now();

        // Insert the plan_run row as pending.
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO plan_runs (id, plan_id, session_id, chat_session_id, workspace_path,
             status, runner_kind, error, steps_output, started_at, finished_at, created_at)
             VALUES (?1, ?2, ?3, NULL, NULL, 'pending', 'native', NULL, '[]', NULL, NULL, ?4)",
            params![run_id, entry.plan_id, session_id, created],
        )
        .map_err(|e| format!("Failed to insert plan run: {e}"))?;

        // Register the cancellation token.
        let token = RunCancellationToken::new();
        if let Ok(mut map) = RUNNING_RUNS.lock() {
            map.insert(run_id.clone(), token.clone());
        }

        // Mark running.
        let now = now();
        conn.execute(
            "UPDATE plan_runs SET status = 'running', started_at = ?1 WHERE id = ?2",
            params![now, run_id],
        )
        .map_err(|e| format!("Failed to mark run running: {e}"))?;

        // Transition the plan to running.
        let _ = PlanService::set_status(&entry.plan_id, PlanStatus::Running);

        // Provision a native chat session for the plan.
        let plan = PlanService::get(&entry.plan_id)?
            .ok_or_else(|| "Plan not found".to_string())?;
        let chat_session = NativeChatService::create_session_for_plan(
            &plan,
            &profile.provider_id,
            &profile.model_id,
            profile.effort_level.as_deref(),
        )?;

        // Link the chat session to the run.
        conn.execute(
            "UPDATE plan_runs SET chat_session_id = ?1 WHERE id = ?2",
            params![chat_session.id, run_id],
        )
        .map_err(|e| format!("Failed to link chat session: {e}"))?;

        // Emit the running event.
        let _ = app.emit(
            PLAN_RUN_EVENT,
            PlanRunEvent {
                run_id: run_id.clone(),
                session_id: session_id.to_string(),
                plan_id: entry.plan_id.clone(),
                status: PlanRunStatus::Running,
                chat_session_id: Some(chat_session.id),
                error: None,
            },
        );

        // Emit a typed planning event so the inspector/flow board react live.
        if let Some(run) = Self::get_run(&run_id)? {
            Self::emit_planning_event(app, &run, PlanningEventKind::RunStarted, None);
        }

        // Remove the token when done.
        if let Ok(mut map) = RUNNING_RUNS.lock() {
            map.remove(&run_id);
        }

        Self::get_run(&run_id)?
            .ok_or_else(|| "Plan run not found after execution".to_string())
    }

    /// Assign a plan to an *existing* chat session and start the run.
    /// Unlike `execute_run` (which creates a fresh chat session), this
    /// binds the run to the user-chosen `chat_session_id`, seeds opening
    /// context into it, provisions a worktree per policy, and emits the
    /// running event with the same chat session id.
    pub fn assign_to_chat(
        app: &AppHandle,
        plan_id: &str,
        chat_session_id: &str,
    ) -> DbResult<PlanRun> {
        // Validate the plan exists and is ready (or running — re-assign is
        // allowed only if the prior run was cancelled).
        let plan = PlanService::get(plan_id)?
            .ok_or_else(|| "Plan not found".to_string())?;
        if plan.status != PlanStatus::Ready && plan.status != PlanStatus::Draft && plan.status != PlanStatus::Openspec {
            return Err(format!("Plan must be ready to assign, but is {}.", plan.status.as_str()));
        }

        // Validate the chat session exists.
        let chat_session = crate::services::native_chat_service::NativeChatService::get_session(chat_session_id)?
            .ok_or_else(|| "Chat session not found".to_string())?;

        // Check no active run is already bound to this chat session.
        let conn = StorageService::connect()?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM plan_runs WHERE chat_session_id = ?1 AND status IN ('running','pending') LIMIT 1",
                params![chat_session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if existing.is_some() {
            return Err("Chat session is already assigned to an active plan run.".to_string());
        }

        let run_id = gen_id();
        let created = now();
        // Provision a worktree if the project is a git repo.
        let workspace_path = if Self::worktrees_enabled_for(&chat_session.project_path) {
            let slug = crate::services::worktree_service::WorktreeService::slugify(&plan.title);
            crate::services::worktree_service::WorktreeService::create_with_base(
                &chat_session.project_path,
                Some(plan_id),
                &plan.reference_id,
                &slug,
                true,
            )
            .ok()
            .map(|w| w.path)
        } else {
            None
        };

        // Seed the opening context into the existing chat session.
        let opening = crate::services::native_chat_service::NativeChatService::build_plan_opening_context(&plan, &chat_session.project_path);
        if !opening.is_empty() {
            let _ = crate::services::native_chat_service::NativeChatService::insert_message(
                chat_session_id,
                "system",
                &opening,
                None,
                Some(&chat_session.provider_id),
                Some(&chat_session.model_id),
                Some(&chat_session.effort_level),
            );
        }

        // Insert the plan_run row with the existing chat_session_id.
        conn.execute(
            "INSERT INTO plan_runs (id, plan_id, session_id, chat_session_id, workspace_path,
             status, runner_kind, error, steps_output, started_at, finished_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', 'native', NULL, '[]', ?6, NULL, ?7)",
            params![run_id, plan_id, plan.session_id, chat_session_id, workspace_path, created, created],
        )
        .map_err(|e| format!("Failed to insert plan run: {e}"))?;

        // Mark running.
        conn.execute(
            "UPDATE plan_runs SET started_at = ?1 WHERE id = ?2",
            params![created, run_id],
        )
        .map_err(|e| format!("Failed to mark run started: {e}"))?;

        // Transition the plan to running.
        let _ = PlanService::set_status(plan_id, PlanStatus::Running);

        // Register the cancellation token.
        let token = RunCancellationToken::new();
        if let Ok(mut map) = RUNNING_RUNS.lock() {
            map.insert(run_id.clone(), token);
        }

        // Emit the running event with the existing chat_session_id.
        let _ = app.emit(
            PLAN_RUN_EVENT,
            PlanRunEvent {
                run_id: run_id.clone(),
                session_id: plan.session_id.clone(),
                plan_id: plan_id.to_string(),
                status: PlanRunStatus::Running,
                chat_session_id: Some(chat_session_id.to_string()),
                error: None,
            },
        );

        // Emit a typed planning event.
        if let Some(run) = Self::get_run(&run_id)? {
            Self::emit_planning_event(app, &run, PlanningEventKind::RunStarted, None);
        }

        Self::get_run(&run_id)?
            .ok_or_else(|| "Plan run not found after assignment".to_string())
    }

    /// Worktrees are enabled when the project is a git repo. Called by
    /// the dispatcher to decide whether to cap concurrency at 1.
    fn worktrees_enabled_for(project_path: &str) -> bool {
        crate::services::worktree_service::WorktreeService::is_supported(project_path)
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /// Find the next queue entry whose plan has no run yet (or only
    /// cancelled runs). Returns None when the queue is exhausted.
    fn next_pending_entry(session_id: &str) -> DbResult<Option<PlanQueueEntry>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT q.id, q.session_id, q.plan_id, q.sort_order, q.created_at
                 FROM plan_queue q
                 WHERE q.session_id = ?1
                 AND NOT EXISTS (
                     SELECT 1 FROM plan_runs r
                     WHERE r.plan_id = q.plan_id
                       AND r.session_id = q.session_id
                       AND r.status IN ('running', 'succeeded', 'pending')
                 )
                 ORDER BY q.sort_order ASC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let row = stmt
            .query_row(params![session_id], |row| {
                Ok(PlanQueueEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }


    fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanRun> {
        let steps_json: String = row.get(8)?;
        let steps_output = serde_json::from_str(&steps_json).unwrap_or_default();
        Ok(PlanRun {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            session_id: row.get(2)?,
            chat_session_id: row.get(3)?,
            workspace_path: row.get(4)?,
            status: PlanRunStatus::from_str(row.get::<_, String>(5)?.as_str()),
            runner_kind: RunnerKind::from_str(row.get::<_, String>(6)?.as_str()),
            error: row.get(7)?,
            steps_output,
            started_at: row.get(9)?,
            finished_at: row.get(10)?,
            created_at: row.get(11)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_run_status_round_trip() {
        for s in ["pending", "running", "succeeded", "failed", "cancelled", "paused", "awaiting_review"] {
            assert_eq!(PlanRunStatus::from_str(s).as_str(), s);
        }
    }

    #[test]
    fn runner_kind_round_trip() {
        assert_eq!(RunnerKind::from_str("native").as_str(), "native");
        assert_eq!(RunnerKind::from_str("omp").as_str(), "omp");
        assert_eq!(RunnerKind::from_str("omp-rpc").as_str(), "omp-rpc");
        assert_eq!(RunnerKind::from_str("unknown").as_str(), "native");
    }

    #[test]
    fn cancellation_token_signals() {
        let token = RunCancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn queue_crud_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);

        // Create a session + two plans so the FK constraints pass.
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/test', 'Test', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, status, priority, tags, ai_enhanced, created_at, updated_at)
             VALUES ('p1', 's1', 'bb-aaa', 'Plan 1', 'desc', 'ready', 50, '[]', 0, 0, 0),
                    ('p2', 's1', 'bb-bbb', 'Plan 2', 'desc', 'ready', 50, '[]', 0, 0, 0)",
            [],
        )
        .unwrap();
        drop(conn);

        // Enqueue two plans for a session.
        let e1 = PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "s1".into(),
            plan_id: "p1".into(),
        })
        .unwrap();
        let e2 = PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "s1".into(),
            plan_id: "p2".into(),
        })
        .unwrap();

        // sort_order increments.
        assert_eq!(e1.sort_order, 0);
        assert_eq!(e2.sort_order, 1);

        // List returns both in order.
        let queue = PlanRunnerService::list_queue("s1").unwrap();
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].plan_id, "p1");
        assert_eq!(queue[1].plan_id, "p2");

        // Reorder: move p2 before p1 (lower sort_order comes first).
        PlanRunnerService::reorder("s1", &e2.id, -1).unwrap();
        let queue = PlanRunnerService::list_queue("s1").unwrap();
        assert_eq!(queue[0].plan_id, "p2");
        assert_eq!(queue[1].plan_id, "p1");
        // Remove e1.
        PlanRunnerService::remove_from_queue(&e1.id).unwrap();
        let queue = PlanRunnerService::list_queue("s1").unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].plan_id, "p2");
    }

    #[test]
    fn list_runs_empty_session_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let runs = PlanRunnerService::list_runs("no-such-session").unwrap();
        assert!(runs.is_empty());
    }

    #[test]
    fn get_run_nonexistent_returns_none() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let run = PlanRunnerService::get_run("nonexistent-run-id").unwrap();
        assert!(run.is_none());
    }

    #[test]
    fn enqueue_rejects_empty_session_or_plan() {
        let result = PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "".into(),
            plan_id: "p1".into(),
        });
        assert!(result.is_err());

        let result = PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "s1".into(),
            plan_id: "".into(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn worktrees_not_supported_for_nonexistent_path() {
        // A non-git path returns false from worktrees_enabled_for.
        assert!(!PlanRunnerService::worktrees_enabled_for("/nonexistent/path/that/does/not/exist"));
    }

    #[test]
    fn assign_to_chat_rejects_nonexistent_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result = PlanRunnerService::assign_to_chat(&app, "nonexistent-plan", "nonexistent-chat");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Plan not found"));
        }
    }

    #[test]
    fn assign_to_chat_rejects_nonexistent_chat_session() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        // Seed a session + plan.
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/test', 'Test', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, status, priority, tags, ai_enhanced, created_at, updated_at)
             VALUES ('p1', 's1', 'bb-aaa', 'Plan 1', 'desc', 'ready', 50, '[]', 0, 0, 0)",
            [],
        )
        .unwrap();
        drop(conn);
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result = PlanRunnerService::assign_to_chat(&app, "p1", "nonexistent-chat");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Chat session not found"));
        }
    }

    #[test]
    fn assign_to_chat_rejects_non_ready_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/test', 'Test', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, status, priority, tags, ai_enhanced, created_at, updated_at)
             VALUES ('p1', 's1', 'bb-aaa', 'Plan 1', 'desc', 'running', 50, '[]', 0, 0, 0)",
            [],
        )
        .unwrap();
        // Seed a chat session.
        conn.execute(
            "INSERT INTO native_chat_sessions (id, project_path, title, profile_id, provider_id, model_id, effort_level, status, created_at, updated_at)
             VALUES ('c1', '/test', 'Chat', 'basebuild-native', 'basebuild-local', 'local', 'low', 'ready', 0, 0)",
            [],
        )
        .unwrap();
        drop(conn);
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result = PlanRunnerService::assign_to_chat(&app, "p1", "c1");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("ready to assign"));
        }
    }

    #[test]
    fn slugify_handles_titles() {
        assert_eq!(crate::services::worktree_service::WorktreeService::slugify("My Plan Title"), "my-plan-title");
        assert_eq!(crate::services::worktree_service::WorktreeService::slugify("  spaces  "), "spaces");
        assert_eq!(crate::services::worktree_service::WorktreeService::slugify("!!!"), "plan");
        assert_eq!(crate::services::worktree_service::WorktreeService::slugify("a-b_c"), "a-b-c");
    }
 }

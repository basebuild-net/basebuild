use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    events::PLAN_RUN_EVENT,
    models::plan::PlanStatus,
    models::plan_run::{
        EnqueuePlanRequest, ExecutionProfile, PlanQueueEntry, PlanRun, PlanRunEvent, PlanRunStatus,
        RunnerKind, StartQueueRequest,
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
/// Per-project, per-provider in-flight semaphores (`run-concurrency-limits`).
/// Keeping the configured limit beside the semaphore prevents an exhausted
/// semaphore from being mistaken for a changed limit and replaced.
#[derive(Debug)]
struct ProviderSemaphore {
    limit: usize,
    semaphore: Arc<tokio::sync::Semaphore>,
}

static PROVIDER_SEMAPHORES: std::sync::LazyLock<
    Mutex<HashMap<(String, String), ProviderSemaphore>>,
> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Per-session queue state: whether the queue is paused and the active
/// execution profile. Held in memory so the scheduler loop can read it
/// without hitting the DB on every tick.
#[derive(Debug, Default, Clone)]
struct QueueState {
    paused: bool,
    generation: String,
    profile: Option<ExecutionProfile>,
    overrides: HashMap<String, ExecutionProfile>,
}

static QUEUE_STATE: std::sync::LazyLock<Mutex<HashMap<String, QueueState>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Default)]
pub struct PlanRunnerService;

/// Outcome of applying a finish policy to a completed run.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishOutcome {
    pub run_id: String,
    pub policy: String,
    pub commit_sha: Option<String>,
    pub pr_url: Option<String>,
    pub merge_ready: bool,
    pub error: Option<String>,
}

/// Result of applying a finish policy — either an outcome or a hold (no action).
#[derive(Debug, Clone)]
pub enum FinishResult {
    /// Policy is hold or not applicable — no automated action taken.
    Hold,
    /// Policy was applied; outcome describes what happened.
    Applied(FinishOutcome),
    /// Policy could not be applied (e.g. non-git checkout); fell back to hold.
    FallbackHold(String),
}

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
            params![
                entry.id,
                entry.session_id,
                entry.plan_id,
                entry.sort_order,
                entry.created_at
            ],
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
    fn emit_planning_event<R: Runtime>(
        app: &AppHandle<R>,
        run: &PlanRun,
        kind: PlanningEventKind,
        detail: Option<String>,
    ) {
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

        let generation = gen_id();
        // Store queue state for the scheduler loop.
        if let Ok(mut states) = QUEUE_STATE.lock() {
            states.insert(
                session_id.clone(),
                QueueState {
                    paused: false,
                    generation: generation.clone(),
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
        let concurrency = Self::effective_queue_concurrency(profile.concurrency, worktrees_enabled);
        let app_clone = app.clone();
        let sid = session_id.clone();
        std::thread::spawn(move || {
            Self::dispatch_loop(app_clone, sid, concurrency, generation);
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
                let session = SessionService::get(&run.session_id).ok().flatten();
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
                        Some(
                            "Checklist incomplete — mark as complete or keep running.".to_string(),
                        ),
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
                (PlanningEventKind::RunFailed, Some("Run failed".to_string()))
            };
            Self::emit_planning_event(app, run, run_kind, run_detail);
            // Re-align nudge: if the plan finished and the schematic mtime
            // predates the run start, emit a drift-suspected notification.
            if succeeded && new_plan_status == PlanStatus::Finished {
                let session = SessionService::get(&run.session_id).ok().flatten();
                let project_path = session
                    .as_ref()
                    .map(|s| s.project_path.as_str())
                    .unwrap_or("");
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
                        let _ = crate::services::notification_service::NotificationService::deliver(
                            app,
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
            // Apply finish policy (auto-commit, PR, merge review) if configured.
            if succeeded && new_plan_status == PlanStatus::Finished {
                let _ = Self::apply_finish_policy(app, run_id);
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
        if !matches!(
            run.status,
            PlanRunStatus::AwaitingReview | PlanRunStatus::Succeeded
        ) {
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

    /// Apply the project's finish policy to a completed run and persist the
    /// outcome on the run row. Called ONCE from `complete_run` after the run
    /// transitions to `succeeded` and the plan is `Finished`. Reads go through
    /// `get_finish_outcome` — they never re-execute policy side effects.
    /// Non-git or primary-checkout hard-fallbacks to hold. Failures surface
    /// without retry.
    pub fn apply_finish_policy(app: &AppHandle, run_id: &str) -> DbResult<FinishResult> {
        let result = Self::apply_finish_policy_inner(app, run_id)?;
        Self::persist_finish_outcome(run_id, &result)?;
        Ok(result)
    }

    /// Wire/persistence JSON for a finish result. Shape matches the frontend
    /// `FinishResult` union: `{ kind: "hold" }`, `{ kind: "fallback_hold",
    /// message }`, `{ kind: "applied", outcome }`.
    pub fn finish_result_json(result: &FinishResult) -> serde_json::Value {
        match result {
            FinishResult::Hold => serde_json::json!({ "kind": "hold" }),
            FinishResult::FallbackHold(msg) => {
                serde_json::json!({ "kind": "fallback_hold", "message": msg })
            }
            FinishResult::Applied(outcome) => {
                serde_json::json!({ "kind": "applied", "outcome": outcome })
            }
        }
    }

    fn persist_finish_outcome(run_id: &str, result: &FinishResult) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let json = Self::finish_result_json(result).to_string();
        conn.execute(
            "UPDATE plan_runs SET finish_outcome = ?2 WHERE id = ?1",
            params![run_id, json],
        )
        .map_err(|e| format!("Failed to persist finish outcome: {e}"))?;
        Ok(())
    }

    /// Read the persisted finish outcome for a run. `None` when no policy has
    /// been applied (legacy runs, or runs that have not completed).
    pub fn get_finish_outcome(run_id: &str) -> DbResult<Option<serde_json::Value>> {
        let conn = StorageService::connect()?;
        let raw: Option<Option<String>> = conn
            .query_row(
                "SELECT finish_outcome FROM plan_runs WHERE id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match raw.flatten() {
            Some(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("Corrupt finish outcome: {e}")),
            None => Ok(None),
        }
    }

    fn apply_finish_policy_inner(app: &AppHandle, run_id: &str) -> DbResult<FinishResult> {
        let run = Self::get_run(run_id)?.ok_or("Run not found")?;
        let session = SessionService::get(&run.session_id)
            .ok()
            .flatten()
            .ok_or("Session not found")?;
        let project_path = &session.project_path;
        let profile =
            crate::services::plan_dependency_service::PlanDependencyService::get_launch_profile(
                project_path,
            )
            .ok()
            .flatten();
        let policy = profile
            .as_ref()
            .map(|p| p.finish_policy.as_str())
            .unwrap_or("hold");
        if policy == "hold" {
            return Ok(FinishResult::Hold);
        }
        // Determine the working directory: worktree path if set, else project root.
        let work_dir = run
            .workspace_path
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(project_path));
        // Check if the directory is a git repo. Non-git → fallback to hold.
        if !work_dir.join(".git").exists() {
            let msg = format!("Finish policy '{policy}' not applied: not a git repository.");
            let _ = crate::services::notification_service::NotificationService::deliver(
                app,
                crate::models::notification::NotificationKind::IntegrationAction,
                run_id,
                "plan_run",
                project_path,
                "Finish policy fallback",
                Some(&msg),
            );
            return Ok(FinishResult::FallbackHold(msg));
        }
        let plan = PlanService::get(&run.plan_id).ok().flatten();
        let plan_ref = plan
            .as_ref()
            .map(|p| p.reference_id.clone())
            .unwrap_or_else(|| run.plan_id.clone());
        let commit_msg = format!("Auto-commit: plan {plan_ref} completed (run {run_id})");
        let mk = |commit_sha: Option<String>,
                  pr_url: Option<String>,
                  merge_ready: bool,
                  error: Option<String>| {
            FinishOutcome {
                run_id: run_id.to_string(),
                policy: policy.to_string(),
                commit_sha,
                pr_url,
                merge_ready,
                error,
            }
        };
        let outcome = match policy {
            "auto_commit" => {
                match crate::services::git_service::GitService::commit_all(&work_dir, &commit_msg) {
                    Ok(sha) if !sha.is_empty() => mk(Some(sha), None, false, None),
                    Ok(_) => mk(
                        None,
                        None,
                        false,
                        Some("Nothing to commit — working tree clean.".to_string()),
                    ),
                    Err(e) => mk(None, None, false, Some(format!("git commit failed: {e}"))),
                }
            }
            "auto_commit_pr" => {
                match crate::services::git_service::GitService::commit_all(&work_dir, &commit_msg) {
                    Ok(sha) if sha.is_empty() => mk(
                        None,
                        None,
                        false,
                        Some("Nothing to commit — working tree clean.".to_string()),
                    ),
                    Ok(sha) => {
                        let branch =
                            crate::services::git_service::GitService::current_branch(&work_dir);
                        match branch {
                            None => mk(
                                Some(sha),
                                None,
                                false,
                                Some(
                                    "Cannot determine current branch — detached HEAD?".to_string(),
                                ),
                            ),
                            Some(b) => {
                                let pr_result = crate::services::pull_request_service::PullRequestService::create_pr(
                                    project_path,
                                    &b,
                                    &format!("Plan {plan_ref}"),
                                    &format!("Automated PR for plan {plan_ref} (run {run_id})"),
                                );
                                match pr_result {
                                    Ok(pr) if pr.success => mk(Some(sha), pr.url, false, None),
                                    Ok(pr) => mk(
                                        Some(sha),
                                        None,
                                        false,
                                        Some(format!(
                                            "PR creation failed: {}",
                                            pr.error.unwrap_or_default()
                                        )),
                                    ),
                                    Err(e) => mk(
                                        Some(sha),
                                        None,
                                        false,
                                        Some(format!("PR creation error: {e}")),
                                    ),
                                }
                            }
                        }
                    }
                    Err(e) => mk(None, None, false, Some(format!("git commit failed: {e}"))),
                }
            }
            "queue_merge_review" => {
                // Commit, then add to merge-review queue with merge-ready flag.
                let (sha, commit_err) = match crate::services::git_service::GitService::commit_all(
                    &work_dir,
                    &commit_msg,
                ) {
                    Ok(s) if !s.is_empty() => (Some(s), None),
                    Ok(_) => (
                        None,
                        Some("Nothing to commit — working tree clean.".to_string()),
                    ),
                    Err(e) => (None, Some(format!("git commit failed: {e}"))),
                };
                let _ = crate::services::plan_dependency_service::PlanDependencyService::add_to_merge_queue(
                    run_id,
                    &run.plan_id,
                    &run.session_id,
                    false,
                    &[],
                );
                mk(sha, None, true, commit_err)
            }
            _ => mk(
                None,
                None,
                false,
                Some(format!("Unknown finish policy: {policy}")),
            ),
        };
        // Emit a planning event with the outcome.
        let detail = if let Some(ref err) = outcome.error {
            format!("Finish policy '{policy}' applied with error: {err}")
        } else {
            format!("Finish policy '{policy}' applied successfully")
        };
        let _ = planning_events::emit(
            app,
            PlanningEventKind::IntegrationAction,
            &run.plan_id,
            project_path,
            Some(run.session_id.clone()),
            format!("Finish policy: {policy}"),
            Some(detail),
        );
        Ok(FinishResult::Applied(outcome))
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
        let run = Self::get_run(run_id)?.ok_or_else(|| "Plan run not found".to_string())?;
        if run.status != PlanRunStatus::Running {
            return Ok((0, 0));
        }
        let plan = PlanService::get(&run.plan_id)?.ok_or_else(|| "Plan not found".to_string())?;
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

        Self::get_run(&run_id)?.ok_or_else(|| "OMP plan run not found after creation".to_string())
    }
    // ── Dispatcher ──────────────────────────────────────────────────────

    /// Dispatch loop: pulls the next pending queue entry, provisions a
    /// session, and runs the plan. Respects pause and cancellation.
    fn dispatch_loop(app: AppHandle, session_id: String, concurrency: u32, generation: String) {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => return,
        };
        let session_semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1) as usize));

        loop {
            // A resumed queue gets a new generation. Retire the old paused
            // dispatcher before it can race the replacement.
            let queue_status = QUEUE_STATE
                .lock()
                .ok()
                .and_then(|states| {
                    states
                        .get(&session_id)
                        .map(|state| (state.generation == generation, state.paused))
                })
                .unwrap_or((false, true));
            if !queue_status.0 {
                return;
            }
            if queue_status.1 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }

            // Find the next pending queue entry that doesn't already have a
            // running/succeeded/failed plan_run.
            let next = match Self::next_pending_entry(&session_id) {
                Ok(Some(entry)) => entry,
                Ok(None) if Self::has_pending_entries(&session_id).unwrap_or(false) => {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    continue;
                }
                Ok(None) => break,
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

            let session_permit = match runtime.block_on(session_semaphore.clone().acquire_owned()) {
                Ok(permit) => permit,
                Err(_) => break,
            };

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
                let _session_permit = session_permit;
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
            project_path,
            provider_id,
        )
        .unwrap_or_default();
        let limit = entry.max_concurrency.max(1) as usize;
        if let Ok(mut map) = PROVIDER_SEMAPHORES.lock() {
            let key = (project_path.to_string(), provider_id.to_string());
            if let Some(existing) = map.get(&key) {
                if existing.limit == limit {
                    return existing.semaphore.clone();
                }
            }
            let semaphore = Arc::new(tokio::sync::Semaphore::new(limit));
            map.insert(
                key,
                ProviderSemaphore {
                    limit,
                    semaphore: semaphore.clone(),
                },
            );
            semaphore
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
        let plan = PlanService::get(&entry.plan_id)?.ok_or_else(|| "Plan not found".to_string())?;
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

        Self::get_run(&run_id)?.ok_or_else(|| "Plan run not found after execution".to_string())
    }

    /// Assign a plan to an *existing* chat session and start the run.
    /// Unlike `execute_run` (which creates a fresh chat session), this
    /// binds the run to the user-chosen `chat_session_id`, seeds opening
    /// context into it, provisions a worktree per policy, and emits the
    /// running event with the same chat session id.
    pub fn assign_to_chat<R: Runtime>(
        app: &AppHandle<R>,
        plan_id: &str,
        chat_session_id: &str,
    ) -> DbResult<PlanRun> {
        // Validate the plan exists and is ready (or running — re-assign is
        // allowed only if the prior run was cancelled).
        let plan = PlanService::get(plan_id)?.ok_or_else(|| "Plan not found".to_string())?;
        if plan.status != PlanStatus::Ready
            && plan.status != PlanStatus::Draft
            && plan.status != PlanStatus::Openspec
        {
            return Err(format!(
                "Plan must be ready to assign, but is {}.",
                plan.status.as_str()
            ));
        }

        // Validate the chat session exists.
        let chat_session =
            crate::services::native_chat_service::NativeChatService::get_session(chat_session_id)?
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
        let opening =
            crate::services::native_chat_service::NativeChatService::build_plan_opening_context(
                &plan,
                &chat_session.project_path,
            );
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
            params![
                run_id,
                plan_id,
                plan.session_id,
                chat_session_id,
                workspace_path,
                created,
                created
            ],
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

        Self::get_run(&run_id)?.ok_or_else(|| "Plan run not found after assignment".to_string())
    }

    /// Kick the agent loop for a chat session that just had a plan assigned.
    /// The assign path only seeds a *system* context message; without a user
    /// turn the agent never starts. This sends the kickoff turn on a detached
    /// thread (the loop is blocking and can run for minutes) so the assign
    /// command returns immediately. Concrete `AppHandle` because the agent
    /// loop's event surface is wry-specific; commands own that type.
    pub fn kickoff_assigned_run(app: &tauri::AppHandle, chat_session_id: &str) {
        let app = app.clone();
        let session_id = chat_session_id.to_string();
        std::thread::spawn(move || {
            let request = crate::models::native_chat::NativeChatSendRequest {
                session_id,
                content: "Begin working on the assigned plan now. Use the opening context \
                          above: if an OpenSpec change is referenced, read its proposal, \
                          design, specs, and tasks.md, then work tasks.md top to bottom and \
                          check off each task as you complete it. Report what you finished."
                    .to_string(),
                provider_id: None,
                model_id: None,
                effort_level: None,
            };
            if let Err(error) = NativeChatService::send_message(&app, request) {
                eprintln!("[plan-run] kickoff turn failed: {error}");
            }
        });
    }

    /// Worktrees are enabled when the project is a git repo. Called by
    /// the dispatcher to decide whether to cap concurrency at 1.
    fn worktrees_enabled_for(project_path: &str) -> bool {
        crate::services::worktree_service::WorktreeService::is_supported(project_path)
    }

    fn effective_queue_concurrency(requested: u32, worktrees_enabled: bool) -> u32 {
        if worktrees_enabled {
            requested.max(1)
        } else {
            1
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /// Find the next queue entry whose plan has no run yet (or only
    /// cancelled runs). Returns None when the queue is exhausted.
    fn next_pending_entry(session_id: &str) -> DbResult<Option<PlanQueueEntry>> {
        let pending = Self::pending_entries(session_id)?;
        if pending.is_empty() {
            return Ok(None);
        }
        let graph = crate::services::plan_dependency_service::PlanDependencyService::build_graph(
            session_id,
        )?;
        Ok(pending.into_iter().find(|entry| {
            graph
                .nodes
                .iter()
                .find(|node| node.plan_id == entry.plan_id)
                .is_some_and(|node| node.dispatchable)
        }))
    }

    fn has_pending_entries(session_id: &str) -> DbResult<bool> {
        Ok(!Self::pending_entries(session_id)?.is_empty())
    }

    fn pending_entries(session_id: &str) -> DbResult<Vec<PlanQueueEntry>> {
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
                 ORDER BY q.sort_order ASC",
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
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
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
    use tauri::Manager;

    #[test]
    fn plan_run_status_round_trip() {
        for s in [
            "pending",
            "running",
            "succeeded",
            "failed",
            "cancelled",
            "paused",
            "awaiting_review",
        ] {
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
    fn queue_concurrency_requires_worktree_isolation() {
        assert_eq!(PlanRunnerService::effective_queue_concurrency(0, true), 1);
        assert_eq!(PlanRunnerService::effective_queue_concurrency(4, true), 4);
        assert_eq!(PlanRunnerService::effective_queue_concurrency(4, false), 1);
    }

    #[test]
    fn exhausted_provider_semaphore_is_reused() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let first = PlanRunnerService::provider_semaphore(
            "/semaphore-regression",
            "semaphore-regression-provider",
            &runtime,
        );
        let permit = runtime
            .block_on(first.clone().acquire_owned())
            .expect("first provider permit");
        assert_eq!(first.available_permits(), 0);

        let second = PlanRunnerService::provider_semaphore(
            "/semaphore-regression",
            "semaphore-regression-provider",
            &runtime,
        );
        assert!(Arc::ptr_eq(&first, &second));
        drop(permit);
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
    fn queue_selects_ready_prerequisite_before_blocked_plan() {
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
             VALUES ('dependent', 's1', 'bb-dep', 'Dependent', 'desc', 'ready', 50, '[]', 0, 0, 0),
                    ('prerequisite', 's1', 'bb-pre', 'Prerequisite', 'desc', 'ready', 50, '[]', 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plan_dependency_meta
                (plan_id, prerequisites, affected_paths, scheduling_mode, workspace_policy, updated_at)
             VALUES ('dependent', '[\"prerequisite\"]', '[]', 'safe', 'isolated_worktrees', 0)",
            [],
        )
        .unwrap();
        drop(conn);

        PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "s1".into(),
            plan_id: "dependent".into(),
        })
        .unwrap();
        PlanRunnerService::enqueue(EnqueuePlanRequest {
            session_id: "s1".into(),
            plan_id: "prerequisite".into(),
        })
        .unwrap();

        let first = PlanRunnerService::next_pending_entry("s1")
            .unwrap()
            .expect("dispatchable prerequisite");
        assert_eq!(first.plan_id, "prerequisite");

        PlanService::set_status("prerequisite", PlanStatus::Finished).unwrap();
        let second = PlanRunnerService::next_pending_entry("s1")
            .unwrap()
            .expect("unblocked dependent");
        assert_eq!(second.plan_id, "dependent");
    }

    #[test]
    fn list_runs_empty_session_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let runs = PlanRunnerService::list_runs("no-such-session").unwrap();
        assert!(runs.is_empty());
    }

    #[test]
    fn finish_outcome_persists_and_reads_without_reapplying() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);

        // Seed session + plan + run so FK constraints pass.
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
        conn.execute(
            "INSERT INTO plan_runs (id, plan_id, session_id, status, runner_kind, steps_output, created_at)
             VALUES ('r1', 'p1', 's1', 'succeeded', 'native', '[]', 0)",
            [],
        )
        .unwrap();
        drop(conn);

        // No outcome persisted yet — read returns None (frontend maps to hold).
        assert!(PlanRunnerService::get_finish_outcome("r1")
            .unwrap()
            .is_none());

        // Persist an applied outcome; read returns the wrapped JSON verbatim.
        let applied = FinishResult::Applied(FinishOutcome {
            run_id: "r1".to_string(),
            policy: "auto_commit".to_string(),
            commit_sha: Some("abc123".to_string()),
            pr_url: None,
            merge_ready: false,
            error: None,
        });
        PlanRunnerService::persist_finish_outcome("r1", &applied).unwrap();
        let read = PlanRunnerService::get_finish_outcome("r1")
            .unwrap()
            .unwrap();
        assert_eq!(read["kind"], "applied");
        assert_eq!(read["outcome"]["commitSha"], "abc123");
        assert_eq!(read["outcome"]["policy"], "auto_commit");

        // Reading twice is a pure read — same value, no state change.
        let read2 = PlanRunnerService::get_finish_outcome("r1")
            .unwrap()
            .unwrap();
        assert_eq!(read, read2);

        // Fallback-hold persists with its message.
        let fallback = FinishResult::FallbackHold("not a git repository".to_string());
        PlanRunnerService::persist_finish_outcome("r1", &fallback).unwrap();
        let read3 = PlanRunnerService::get_finish_outcome("r1")
            .unwrap()
            .unwrap();
        assert_eq!(read3["kind"], "fallback_hold");
        assert_eq!(read3["message"], "not a git repository");
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
        assert!(!PlanRunnerService::worktrees_enabled_for(
            "/nonexistent/path/that/does/not/exist"
        ));
    }

    #[test]
    fn assign_to_chat_rejects_nonexistent_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result =
                PlanRunnerService::assign_to_chat(&app, "nonexistent-plan", "nonexistent-chat");
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
        assert_eq!(
            crate::services::worktree_service::WorktreeService::slugify("My Plan Title"),
            "my-plan-title"
        );
        assert_eq!(
            crate::services::worktree_service::WorktreeService::slugify("  spaces  "),
            "spaces"
        );
        assert_eq!(
            crate::services::worktree_service::WorktreeService::slugify("!!!"),
            "plan"
        );
        assert_eq!(
            crate::services::worktree_service::WorktreeService::slugify("a-b_c"),
            "a-b-c"
        );
    }
}

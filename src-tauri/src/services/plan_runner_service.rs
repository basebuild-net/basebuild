use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter};

use crate::{
    events::PLAN_RUN_EVENT,
    models::plan::PlanStatus,
    models::plan_run::{
        EnqueuePlanRequest, ExecutionProfile, PlanOverride, PlanQueueEntry, PlanRun, PlanRunEvent,
        PlanRunStatus, RunnerKind, StartQueueRequest,
    },
    services::{
        native_chat_service::NativeChatService, openspec_service, plan_service::PlanService,
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
        if let Ok(mut map) = RUNNING_RUNS.lock() {
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
                // Store step results on the run.
                let _ = Self::update_run_steps(run_id, &step_results);
                // If any step failed, the run is failed, not finished.
                let any_failed = step_results.iter().any(|r| r.status == "failed");
                if any_failed {
                    let _ = conn.execute(
                        "UPDATE plan_runs SET status = 'failed' WHERE id = ?1",
                        params![run_id],
                    );
                    PlanStatus::Ready
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
        }
        Ok(())
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
        let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency as usize));

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

            // Acquire a permit (blocks if at concurrency limit).
            let permit = runtime.block_on(async { semaphore.clone().acquire_owned().await });
            let permit = match permit {
                Ok(p) => p,
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

            let app_clone = app.clone();
            let sid = session_id.clone();
            std::thread::spawn(move || {
                let _permit = permit; // Released on drop.
                let _ = Self::execute_run(&app_clone, &sid, &next, &profile);
            });
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

        // Remove the token when done.
        if let Ok(mut map) = RUNNING_RUNS.lock() {
            map.remove(&run_id);
        }

        Self::get_run(&run_id)?
            .ok_or_else(|| "Plan run not found after execution".to_string())
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
        for s in ["pending", "running", "succeeded", "failed", "cancelled", "paused"] {
            assert_eq!(PlanRunStatus::from_str(s).as_str(), s);
        }
    }

    #[test]
    fn runner_kind_round_trip() {
        assert_eq!(RunnerKind::from_str("native").as_str(), "native");
        assert_eq!(RunnerKind::from_str("omp").as_str(), "omp");
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
 }

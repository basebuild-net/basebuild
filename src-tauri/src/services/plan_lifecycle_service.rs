use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, OptionalExtension, Transaction};
use tauri::{AppHandle, Emitter};

use crate::services::{
    openspec_service, plan_runner_service::PlanRunnerService, storage_service::StorageService,
};
use crate::events::NATIVE_CHAT_TRANSCRIPT_UPDATED;

type DbResult<T> = Result<T, String>;

static EVENT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatTerminalState {
    Idle,
    Interrupted,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanCompletionState {
    Succeeded,
    Failed,
    AwaitingReview,
}

#[derive(Debug, Default)]
pub struct PlanLifecycleService;

impl PlanLifecycleService {
    pub fn kickoff_started(run_id: &str, chat_session_id: Option<&str>) -> DbResult<()> {
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let Some((plan_id, from_run, from_plan)) = run_context(&tx, run_id)? else {
            return Err("Plan run not found".to_string());
        };
        if from_run == "running" && from_plan == "running" {
            return tx.commit().map_err(|error| error.to_string());
        }
        tx.execute(
            "UPDATE plan_runs
             SET status = 'running', chat_session_id = COALESCE(?1, chat_session_id),
                 started_at = COALESCE(started_at, ?2), finished_at = NULL, error = NULL
             WHERE id = ?3",
            params![chat_session_id, now_seconds(), run_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE plans SET status = 'running', updated_at = ?1 WHERE id = ?2",
            params![now_seconds(), plan_id],
        )
        .map_err(|error| error.to_string())?;
        record_event(
            &tx,
            Some(run_id),
            &plan_id,
            chat_session_id,
            "kickoff_started",
            Some(&from_run),
            Some("running"),
            Some(&from_plan),
            Some("running"),
        )?;
        tx.commit().map_err(|error| error.to_string())
    }

    pub fn kickoff_failed(run_id: &str, error: &str) -> DbResult<()> {
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        let Some((plan_id, from_run, from_plan)) = run_context(&tx, run_id)? else {
            return Err("Plan run not found".to_string());
        };
        if from_run == "failed" && from_plan == "ready" {
            return tx.commit().map_err(|value| value.to_string());
        }
        tx.execute(
            "UPDATE plan_runs
             SET status = 'failed', error = ?1, finished_at = COALESCE(finished_at, ?2)
             WHERE id = ?3",
            params![bounded_error(error), now_seconds(), run_id],
        )
        .map_err(|value| value.to_string())?;
        tx.execute(
            "UPDATE plans SET status = 'ready', updated_at = ?1 WHERE id = ?2",
            params![now_seconds(), plan_id],
        )
        .map_err(|value| value.to_string())?;
        record_event(
            &tx,
            Some(run_id),
            &plan_id,
            None,
            "kickoff_failed",
            Some(&from_run),
            Some("failed"),
            Some(&from_plan),
            Some("ready"),
        )?;
        tx.commit().map_err(|value| value.to_string())
    }

    pub fn finish_run(run_id: &str, state: PlanCompletionState) -> DbResult<()> {
        let (run_status, plan_status, event_kind, error) = match state {
            PlanCompletionState::Succeeded => ("succeeded", "finished", "run_succeeded", None),
            PlanCompletionState::Failed => ("failed", "ready", "run_failed", Some("Run failed")),
            PlanCompletionState::AwaitingReview => (
                "awaiting_review",
                "ready",
                "run_awaiting_review",
                Some("Checklist incomplete; continuation or review required"),
            ),
        };
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        let Some((plan_id, from_run, from_plan)) = run_context(&tx, run_id)? else {
            return Err("Plan run not found".to_string());
        };
        if from_run == run_status && from_plan == plan_status {
            return tx.commit().map_err(|value| value.to_string());
        }
        tx.execute(
            "UPDATE plan_runs SET status = ?1, error = ?2,
             finished_at = COALESCE(finished_at, ?3) WHERE id = ?4",
            params![run_status, error, now_seconds(), run_id],
        )
        .map_err(|value| value.to_string())?;
        tx.execute(
            "UPDATE plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![plan_status, now_seconds(), plan_id],
        )
        .map_err(|value| value.to_string())?;
        record_event(
            &tx,
            Some(run_id),
            &plan_id,
            None,
            event_kind,
            Some(&from_run),
            Some(run_status),
            Some(&from_plan),
            Some(plan_status),
        )?;
        tx.commit().map_err(|value| value.to_string())
    }

    pub fn fail_linked_chat(chat_session_id: &str, error: &str) -> DbResult<bool> {
        let conn = StorageService::connect()?;
        let run_id = conn
            .query_row(
                "SELECT id FROM plan_runs
                 WHERE chat_session_id = ?1 AND status IN ('pending','running')
                 ORDER BY created_at DESC LIMIT 1",
                params![chat_session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|value| value.to_string())?;
        match run_id {
            Some(run_id) => {
                Self::kickoff_failed(&run_id, error)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub fn chat_running(chat_session_id: &str) -> DbResult<()> {
        Self::set_chat_state(chat_session_id, "running", "chat_running")
    }

    pub fn chat_needs_input(chat_session_id: &str) -> DbResult<()> {
        Self::set_chat_state(chat_session_id, "needs_input", "chat_needs_input")
    }

    pub fn stop_chat(app: &AppHandle, chat_session_id: &str) -> DbResult<bool> {
        let agent_was_running = crate::services::agent_loop_service::cancel_run(chat_session_id);
        crate::services::agent_loop_service::cancel_pending_approvals(chat_session_id);
        let interactions = crate::services::interaction_service::InteractionService::list_pending(
            chat_session_id,
        )?;
        for interaction in &interactions {
            let _ = crate::services::agent_loop_service::cancel_interaction(&interaction.id);
            crate::services::interaction_service::InteractionService::cancel(&interaction.id)?;
        }
        let conn = StorageService::connect()?;
        let owns_run = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM plan_runs
                    WHERE chat_session_id = ?1 AND status IN ('pending','running')
                 )",
                params![chat_session_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|value| value.to_string())?;
        Self::chat_terminal(app, chat_session_id, ChatTerminalState::Cancelled)?;
        Ok(agent_was_running || owns_run || !interactions.is_empty())
    }

    pub fn chat_terminal(
        app: &AppHandle,
        chat_session_id: &str,
        state: ChatTerminalState,
    ) -> DbResult<()> {
        let mut conn = StorageService::connect()?;
        let active = conn
            .query_row(
                "SELECT r.id, r.plan_id, r.status, p.status, p.change_name, s.project_path
                 FROM plan_runs r
                 JOIN plans p ON p.id = r.plan_id
                 JOIN sessions s ON s.id = p.session_id
                 WHERE r.chat_session_id = ?1 AND r.status IN ('pending','running')
                 ORDER BY r.created_at DESC LIMIT 1",
                params![chat_session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|value| value.to_string())?;

        let chat_state = match state {
            ChatTerminalState::Idle => "idle",
            ChatTerminalState::Interrupted => "interrupted",
            ChatTerminalState::Failed => "idle",
            ChatTerminalState::Cancelled => "cancelled",
        };
        conn.execute(
            "UPDATE native_chat_sessions SET run_state = ?1, updated_at = ?2 WHERE id = ?3",
            params![chat_state, now_millis(), chat_session_id],
        )
        .map_err(|value| value.to_string())?;

        // Emit a transcript-updated event with the terminal outcome so the
        // ChatPanel clears its streaming indicator and the left-column chat
        // list settles. Without this, the UI keeps showing "streaming" with
        // the orange cursor blinker after the agent loop finishes.
        let outcome = match state {
            ChatTerminalState::Idle => "succeeded",
            ChatTerminalState::Failed => "failed",
            ChatTerminalState::Cancelled => "cancelled",
            ChatTerminalState::Interrupted => "cancelled",
        };
        let _ = app.emit(
            NATIVE_CHAT_TRANSCRIPT_UPDATED,
            serde_json::json!({ "sessionId": chat_session_id, "outcome": outcome }),
        );

        let Some((run_id, plan_id, from_run, from_plan, change_name, project_path)) = active else {
            return Ok(());
        };

        let checklist_complete = if state == ChatTerminalState::Idle {
            change_name
                .as_deref()
                .map(|name| openspec_service::read_task_progress(&project_path, name))
                .is_some_and(|(completed, total)| total > 0 && completed == total)
        } else {
            false
        };

        if checklist_complete {
            let tx = conn.transaction().map_err(|value| value.to_string())?;
            record_event(
                &tx,
                Some(&run_id),
                &plan_id,
                Some(chat_session_id),
                "chat_idle_checklist_complete",
                Some(&from_run),
                Some("running"),
                Some(&from_plan),
                Some("running"),
            )?;
            tx.commit().map_err(|value| value.to_string())?;
            return PlanRunnerService::complete_run(app, &run_id, true);
        }

        let (run_status, plan_status, event_kind, error) = match state {
            ChatTerminalState::Idle => (
                "awaiting_review",
                "ready",
                "chat_idle_needs_continuation",
                "Agent turn ended before the linked checklist was complete; continuation required",
            ),
            ChatTerminalState::Interrupted => (
                "awaiting_review",
                "ready",
                "chat_interrupted",
                "Linked chat was interrupted; continuation required",
            ),
            ChatTerminalState::Failed => (
                "failed",
                "ready",
                "chat_failed",
                "Linked chat failed to complete its turn",
            ),
            ChatTerminalState::Cancelled => (
                "cancelled",
                "ready",
                "chat_cancelled",
                "Linked chat was stopped by the user",
            ),
        };
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        tx.execute(
            "UPDATE plan_runs SET status = ?1, error = ?2,
                 finished_at = COALESCE(finished_at, ?3) WHERE id = ?4",
            params![run_status, error, now_seconds(), run_id],
        )
        .map_err(|value| value.to_string())?;
        tx.execute(
            "UPDATE plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![plan_status, now_seconds(), plan_id],
        )
        .map_err(|value| value.to_string())?;
        record_event(
            &tx,
            Some(&run_id),
            &plan_id,
            Some(chat_session_id),
            event_kind,
            Some(&from_run),
            Some(run_status),
            Some(&from_plan),
            Some(plan_status),
        )?;
        tx.commit().map_err(|value| value.to_string())
    }

    pub fn user_stop(run_id: &str, cancel_plan: bool) -> DbResult<()> {
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        let Some((plan_id, from_run, from_plan)) = run_context(&tx, run_id)? else {
            return Err("Plan run not found".to_string());
        };
        let plan_status = if cancel_plan { "cancelled" } else { "ready" };
        if from_run == "cancelled" && from_plan == plan_status {
            return tx.commit().map_err(|value| value.to_string());
        }
        tx.execute(
            "UPDATE plan_runs SET status = 'cancelled', error = 'Cancelled by user',
                 finished_at = COALESCE(finished_at, ?1) WHERE id = ?2",
            params![now_seconds(), run_id],
        )
        .map_err(|value| value.to_string())?;
        tx.execute(
            "UPDATE plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![plan_status, now_seconds(), plan_id],
        )
        .map_err(|value| value.to_string())?;
        record_event(
            &tx,
            Some(run_id),
            &plan_id,
            None,
            "user_stop",
            Some(&from_run),
            Some("cancelled"),
            Some(&from_plan),
            Some(plan_status),
        )?;
        tx.commit().map_err(|value| value.to_string())
    }

    pub fn reconcile_stale_owners(
        session_id: Option<&str>,
        project_path: Option<&str>,
    ) -> DbResult<Vec<String>> {
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        let stale = {
            let mut stmt = tx
                .prepare(
                    "SELECT r.id, r.plan_id, r.chat_session_id, r.status, p.status,
                            COALESCE(c.run_state, 'missing')
                     FROM plan_runs r
                     JOIN plans p ON p.id = r.plan_id
                     JOIN sessions s ON s.id = p.session_id
                     LEFT JOIN native_chat_sessions c ON c.id = r.chat_session_id
                     WHERE r.status = 'running'
                       AND r.runner_kind = 'native'
                       AND (?1 IS NULL OR r.session_id = ?1)
                       AND (?2 IS NULL OR s.project_path = ?2)
                       AND (r.chat_session_id IS NULL OR c.id IS NULL
                            OR c.run_state NOT IN ('running','needs_input'))",
                )
                .map_err(|value| value.to_string())?;
            let rows = stmt
                .query_map(params![session_id, project_path], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                })
                .map_err(|value| value.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|value| value.to_string())?
        };

        for (run_id, plan_id, chat_id, from_run, from_plan, chat_state) in &stale {
            let reason = if chat_state == "missing" {
                "Linked chat is unavailable".to_string()
            } else {
                format!("Linked chat was {chat_state}")
            };
            tx.execute(
                "UPDATE plan_runs SET status = 'awaiting_review',
                     error = ?1, finished_at = COALESCE(finished_at, ?2) WHERE id = ?3",
                params![reason, now_seconds(), run_id],
            )
            .map_err(|value| value.to_string())?;
            record_event(
                &tx,
                Some(run_id),
                plan_id,
                chat_id.as_deref(),
                "owner_reconciled",
                Some(from_run),
                Some("awaiting_review"),
                Some(from_plan),
                Some("ready"),
            )?;
        }
        tx.execute(
            "UPDATE plans SET status = 'ready', updated_at = ?1
             WHERE status = 'running'
               AND (?2 IS NULL OR session_id = ?2)
               AND (?3 IS NULL OR session_id IN (SELECT id FROM sessions WHERE project_path = ?3))
               AND NOT EXISTS (
                   SELECT 1 FROM plan_runs r
                   LEFT JOIN native_chat_sessions c ON c.id = r.chat_session_id
                   WHERE r.plan_id = plans.id AND r.status IN ('pending','running')
                     AND (r.runner_kind != 'native' OR c.run_state IN ('running','needs_input'))
               )",
            params![now_seconds(), session_id, project_path],
        )
        .map_err(|value| value.to_string())?;
        tx.commit().map_err(|value| value.to_string())?;
        Ok(stale.into_iter().map(|(run_id, ..)| run_id).collect())
    }

    fn set_chat_state(chat_session_id: &str, state: &str, event_kind: &str) -> DbResult<()> {
        let mut conn = StorageService::connect()?;
        let tx = conn.transaction().map_err(|value| value.to_string())?;
        let previous_chat_state = tx
            .query_row(
                "SELECT run_state FROM native_chat_sessions WHERE id = ?1",
                params![chat_session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|value| value.to_string())?;
        if previous_chat_state.as_deref() == Some(state) {
            return tx.commit().map_err(|value| value.to_string());
        }
        tx.execute(
            "UPDATE native_chat_sessions SET run_state = ?1, updated_at = ?2 WHERE id = ?3",
            params![state, now_millis(), chat_session_id],
        )
        .map_err(|value| value.to_string())?;
        let linked = tx
            .query_row(
                "SELECT r.id, r.plan_id, r.status, p.status
                 FROM plan_runs r JOIN plans p ON p.id = r.plan_id
                 WHERE r.chat_session_id = ?1 AND r.status = 'running'
                 ORDER BY r.created_at DESC LIMIT 1",
                params![chat_session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|value| value.to_string())?;
        if let Some((run_id, plan_id, run_status, plan_status)) = linked {
            record_event(
                &tx,
                Some(&run_id),
                &plan_id,
                Some(chat_session_id),
                event_kind,
                Some(&run_status),
                Some(&run_status),
                Some(&plan_status),
                Some(&plan_status),
            )?;
        }
        tx.commit().map_err(|value| value.to_string())
    }
}

fn run_context(tx: &Transaction<'_>, run_id: &str) -> DbResult<Option<(String, String, String)>> {
    tx.query_row(
        "SELECT r.plan_id, r.status, p.status
         FROM plan_runs r JOIN plans p ON p.id = r.plan_id WHERE r.id = ?1",
        params![run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|value| value.to_string())
}

fn record_event(
    tx: &Transaction<'_>,
    run_id: Option<&str>,
    plan_id: &str,
    chat_session_id: Option<&str>,
    event_kind: &str,
    from_run_status: Option<&str>,
    to_run_status: Option<&str>,
    from_plan_status: Option<&str>,
    to_plan_status: Option<&str>,
) -> DbResult<()> {
    tx.execute(
        "INSERT INTO plan_lifecycle_events
            (id, run_id, plan_id, chat_session_id, event_kind, from_run_status,
             to_run_status, from_plan_status, to_plan_status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            event_id(),
            run_id,
            plan_id,
            chat_session_id,
            event_kind,
            from_run_status,
            to_run_status,
            from_plan_status,
            to_plan_status,
            now_seconds(),
        ],
    )
    .map(|_| ())
    .map_err(|value| value.to_string())
}

fn bounded_error(value: &str) -> String {
    value.chars().take(500).collect()
}

fn event_id() -> String {
    format!(
        "ple-{}-{}",
        now_millis(),
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s-lifecycle', '/test', 'Lifecycle', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans
             (id, session_id, reference_id, title, description, status, priority, tags,
              ai_enhanced, created_at, updated_at)
             VALUES ('p-lifecycle', 's-lifecycle', 'bb-life', 'Lifecycle', 'd',
                     'ready', 50, '[]', 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO native_chat_sessions
             (id, project_path, title, profile_id, provider_id, model_id, effort_level,
              status, run_state, created_at, updated_at)
             VALUES ('c-lifecycle', '/test', 'Lifecycle chat', 'basebuild-native',
                     'basebuild-local', 'local', 'low', 'ready', 'idle', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plan_runs
             (id, plan_id, session_id, chat_session_id, status, runner_kind,
              steps_output, created_at)
             VALUES ('r-lifecycle', 'p-lifecycle', 's-lifecycle', 'c-lifecycle',
                     'pending', 'native', '[]', 0)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn needs_input_is_a_live_execution_owner() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);

        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::chat_needs_input("c-lifecycle").unwrap();
        assert!(
            PlanLifecycleService::reconcile_stale_owners(Some("s-lifecycle"), None)
                .unwrap()
                .is_empty()
        );

        let conn = StorageService::connect().unwrap();
        let states = conn
            .query_row(
                "SELECT r.status, p.status, c.run_state
                 FROM plan_runs r
                 JOIN plans p ON p.id = r.plan_id
                 JOIN native_chat_sessions c ON c.id = r.chat_session_id
                 WHERE r.id = 'r-lifecycle'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            states,
            ("running".into(), "running".into(), "needs_input".into())
        );
    }

    #[test]
    fn kickoff_failure_resets_plan_atomically_and_records_event() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);

        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::kickoff_failed("r-lifecycle", "provider unavailable").unwrap();

        let conn = StorageService::connect().unwrap();
        let states = conn
            .query_row(
                "SELECT r.status, r.error, p.status
                 FROM plan_runs r JOIN plans p ON p.id = r.plan_id
                 WHERE r.id = 'r-lifecycle'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(states.0, "failed");
        assert_eq!(states.1.as_deref(), Some("provider unavailable"));
        assert_eq!(states.2, "ready");
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plan_lifecycle_events
                 WHERE run_id = 'r-lifecycle' AND event_kind = 'kickoff_failed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events, 1);
    }

    #[test]
    fn awaiting_review_never_leaves_plan_running() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);

        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::finish_run("r-lifecycle", PlanCompletionState::AwaitingReview)
            .unwrap();

        let conn = StorageService::connect().unwrap();
        let states = conn
            .query_row(
                "SELECT r.status, p.status FROM plan_runs r
                 JOIN plans p ON p.id = r.plan_id WHERE r.id = 'r-lifecycle'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(states, ("awaiting_review".into(), "ready".into()));
    }

    #[test]
    fn completion_transition_table_records_terminal_state_once() {
        let cases = [
            (
                PlanCompletionState::Succeeded,
                "succeeded",
                "finished",
                "run_succeeded",
            ),
            (PlanCompletionState::Failed, "failed", "ready", "run_failed"),
            (
                PlanCompletionState::AwaitingReview,
                "awaiting_review",
                "ready",
                "run_awaiting_review",
            ),
        ];

        for (state, expected_run, expected_plan, expected_event) in cases {
            let dir = tempfile::TempDir::new().unwrap();
            let _guard = crate::test_util::test::lock_db(&dir);
            let conn = StorageService::connect().unwrap();
            seed(&conn);
            drop(conn);

            PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
            PlanLifecycleService::finish_run("r-lifecycle", state).unwrap();
            PlanLifecycleService::finish_run("r-lifecycle", state).unwrap();

            let conn = StorageService::connect().unwrap();
            let statuses = conn
                .query_row(
                    "SELECT r.status, p.status FROM plan_runs r
                     JOIN plans p ON p.id = r.plan_id WHERE r.id = 'r-lifecycle'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .unwrap();
            assert_eq!(statuses, (expected_run.into(), expected_plan.into()));
            let events: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM plan_lifecycle_events
                     WHERE run_id = 'r-lifecycle' AND event_kind = ?1",
                    params![expected_event],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(events, 1, "{expected_event} must be idempotent");
        }
    }

    #[test]
    fn live_chat_state_events_are_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);

        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::chat_needs_input("c-lifecycle").unwrap();
        PlanLifecycleService::chat_needs_input("c-lifecycle").unwrap();
        PlanLifecycleService::chat_running("c-lifecycle").unwrap();
        PlanLifecycleService::chat_running("c-lifecycle").unwrap();

        let conn = StorageService::connect().unwrap();
        for event_kind in ["kickoff_started", "chat_needs_input", "chat_running"] {
            let events: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM plan_lifecycle_events
                     WHERE run_id = 'r-lifecycle' AND event_kind = ?1",
                    params![event_kind],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(events, 1, "{event_kind} must be idempotent");
        }
    }

    #[test]
    fn reconciliation_preserves_missing_chat_run_for_review() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);
        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();

        let conn = StorageService::connect().unwrap();
        conn.execute(
            "UPDATE plan_runs SET chat_session_id = 'missing-chat' WHERE id = 'r-lifecycle'",
            [],
        )
        .unwrap();
        drop(conn);

        assert_eq!(
            PlanLifecycleService::reconcile_stale_owners(Some("s-lifecycle"), None).unwrap(),
            vec!["r-lifecycle".to_string()]
        );
        assert!(
            PlanLifecycleService::reconcile_stale_owners(Some("s-lifecycle"), None)
                .unwrap()
                .is_empty()
        );

        let conn = StorageService::connect().unwrap();
        let states = conn
            .query_row(
                "SELECT r.status, p.status FROM plan_runs r
                 JOIN plans p ON p.id = r.plan_id WHERE r.id = 'r-lifecycle'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(states, ("awaiting_review".into(), "ready".into()));
    }

    #[test]
    fn awaiting_review_run_can_resume_without_losing_history() {
        let dir = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        seed(&conn);
        drop(conn);

        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();
        PlanLifecycleService::finish_run("r-lifecycle", PlanCompletionState::AwaitingReview)
            .unwrap();
        PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();

        let conn = StorageService::connect().unwrap();
        let states = conn
            .query_row(
                "SELECT r.status, r.finished_at, p.status FROM plan_runs r
                 JOIN plans p ON p.id = r.plan_id WHERE r.id = 'r-lifecycle'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(states, ("running".into(), None, "running".into()));
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plan_lifecycle_events WHERE run_id = 'r-lifecycle'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events, 3);
    }

    #[test]
    fn user_stop_transition_table_preserves_or_cancels_plan() {
        for (cancel_plan, expected_plan) in [(false, "ready"), (true, "cancelled")] {
            let dir = tempfile::TempDir::new().unwrap();
            let _guard = crate::test_util::test::lock_db(&dir);
            let conn = StorageService::connect().unwrap();
            seed(&conn);
            drop(conn);
            PlanLifecycleService::kickoff_started("r-lifecycle", Some("c-lifecycle")).unwrap();

            PlanLifecycleService::user_stop("r-lifecycle", cancel_plan).unwrap();
            PlanLifecycleService::user_stop("r-lifecycle", cancel_plan).unwrap();

            let conn = StorageService::connect().unwrap();
            let states = conn
                .query_row(
                    "SELECT r.status, p.status FROM plan_runs r
                     JOIN plans p ON p.id = r.plan_id WHERE r.id = 'r-lifecycle'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .unwrap();
            assert_eq!(states, ("cancelled".into(), expected_plan.into()));
            let events: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM plan_lifecycle_events
                     WHERE run_id = 'r-lifecycle' AND event_kind = 'user_stop'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(events, 1);
        }
    }
}

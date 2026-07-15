//! Idea generation rounds.
//!
//! A round is one zero-input generation pass: the frontend starts a round,
//! delivers the generation prompt to a chat, and every idea captured while
//! the round is active (via `propose_ideas` or the pipeline fallback) is
//! tagged with the round id (`ideas.batch_id`). Rounds are persisted as
//! `pipeline_runs` rows (`kind = 'idea_round'`) so history, timestamps, and
//! the startup running→failed sweep come for free. The active-round registry
//! is in-memory: a round is a live-turn construct, and ideas keep their
//! `batch_id` regardless of registry lifetime.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::services::{native_chat_service::NativeChatService, storage_service::StorageService};

/// session_id → active round id.
static ACTIVE_ROUNDS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaRound {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    /// Ideas captured in this round, by current status.
    pub concept_count: i64,
    pub picked_count: i64,
    pub rejected_count: i64,
    pub archived_count: i64,
}

pub struct IdeaRoundService;

impl IdeaRoundService {
    /// Start a round for a session: records a running `idea_round` pipeline
    /// run and makes it the session's active round (replacing any previous
    /// active round, which is marked succeeded).
    pub fn start_round(session_id: &str, project_path: &str) -> Result<String, String> {
        let round_id = format!(
            "round-{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let now = now_seconds();
        // Close out a previous active round for this session, if any.
        let previous = {
            let mut map = ACTIVE_ROUNDS.lock().map_err(|e| e.to_string())?;
            map.insert(session_id.to_string(), round_id.clone())
        };
        if let Some(prev) = previous {
            let _ = NativeChatService::record_pipeline_run(
                &prev,
                session_id,
                project_path,
                "idea_round",
                "succeeded",
                now,
            );
        }
        NativeChatService::record_pipeline_run(
            &round_id,
            session_id,
            project_path,
            "idea_round",
            "running",
            now,
        )?;
        Ok(round_id)
    }

    /// Finish the session's active round (idempotent). Returns the finished
    /// round id when one was active.
    pub fn finish_round(session_id: &str, project_path: &str) -> Result<Option<String>, String> {
        let finished = {
            let mut map = ACTIVE_ROUNDS.lock().map_err(|e| e.to_string())?;
            map.remove(session_id)
        };
        if let Some(round_id) = &finished {
            NativeChatService::record_pipeline_run(
                round_id,
                session_id,
                project_path,
                "idea_round",
                "succeeded",
                now_seconds(),
            )?;
        }
        Ok(finished)
    }

    /// The session's active round id, if a round is running.
    pub fn active_round(session_id: &str) -> Option<String> {
        ACTIVE_ROUNDS
            .lock()
            .ok()
            .and_then(|map| map.get(session_id).cloned())
    }

    /// List a session's rounds (newest first) with per-status idea counts.
    pub fn list_rounds(session_id: &str) -> Result<Vec<IdeaRound>, String> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.session_id, r.status, r.created_at, r.completed_at,
                        COALESCE(SUM(CASE WHEN i.status = 'concept' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN i.status = 'picked' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN i.status = 'rejected' THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN i.status = 'archived' THEN 1 ELSE 0 END), 0)
                 FROM pipeline_runs r
                 LEFT JOIN ideas i ON i.batch_id = r.id
                 WHERE r.session_id = ?1 AND r.kind = 'idea_round'
                 GROUP BY r.id
                 ORDER BY r.created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok(IdeaRound {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    status: row.get(2)?,
                    created_at: row.get(3)?,
                    completed_at: row.get(4)?,
                    concept_count: row.get(5)?,
                    picked_count: row.get(6)?,
                    rejected_count: row.get(7)?,
                    archived_count: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::session_service::SessionService;

    #[test]
    fn round_lifecycle_tags_and_counts() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('rs1', '/p', 'S', 0, 0)",
            [],
        )
        .unwrap();

        let round = IdeaRoundService::start_round("rs1", "/p").unwrap();
        assert_eq!(
            IdeaRoundService::active_round("rs1").as_deref(),
            Some(round.as_str())
        );
        // No cross-session leakage.
        assert!(IdeaRoundService::active_round("other").is_none());

        let idea =
            SessionService::create_idea("rs1", "T", "D", None, "evidence", None, Some(&round))
                .unwrap();
        assert_eq!(idea.batch_id.as_deref(), Some(round.as_str()));

        let finished = IdeaRoundService::finish_round("rs1", "/p").unwrap();
        assert_eq!(finished.as_deref(), Some(round.as_str()));
        assert!(IdeaRoundService::active_round("rs1").is_none());
        // Finish again is a no-op.
        assert!(IdeaRoundService::finish_round("rs1", "/p")
            .unwrap()
            .is_none());

        let rounds = IdeaRoundService::list_rounds("rs1").unwrap();
        assert_eq!(rounds.len(), 1);
        assert_eq!(rounds[0].id, round);
        assert_eq!(rounds[0].status, "succeeded");
        assert_eq!(rounds[0].concept_count, 1);
        assert_eq!(rounds[0].picked_count, 0);
    }

    #[test]
    fn starting_a_new_round_replaces_the_active_one() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('rs2', '/p', 'S', 0, 0)",
            [],
        )
        .unwrap();

        let first = IdeaRoundService::start_round("rs2", "/p").unwrap();
        let second = IdeaRoundService::start_round("rs2", "/p").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            IdeaRoundService::active_round("rs2").as_deref(),
            Some(second.as_str())
        );

        let rounds = IdeaRoundService::list_rounds("rs2").unwrap();
        assert_eq!(rounds.len(), 2);
        // The replaced round was closed out as succeeded.
        let prev = rounds.iter().find(|r| r.id == first).unwrap();
        assert_eq!(prev.status, "succeeded");
    }
}

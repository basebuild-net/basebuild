use rusqlite::params;

use crate::{
    models::interaction::{
        InteractionStatus, PendingInteraction, Question, QuestionAnswer, ResolveInteractionRequest,
    },
    services::storage_service::StorageService,
};

type DbResult<T> = Result<T, String>;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct InteractionService;

impl InteractionService {
    /// Create a pending interaction. Called when the agent loop calls `ask_user`.
    pub fn create(
        session_id: &str,
        run_id: Option<&str>,
        questions: &[Question],
    ) -> DbResult<PendingInteraction> {
        let id = gen_id();
        let created_at = now_millis();
        let questions_json = serde_json::to_string(questions).map_err(|e| e.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO pending_interactions (id, session_id, run_id, questions_json, status, answers_json, created_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, NULL)",
            params![id, session_id, run_id, questions_json, created_at],
        )
        .map_err(|e| e.to_string())?;
        Self::get(&id)?.ok_or_else(|| "Interaction not found after insert".to_string())
    }

    /// Resolve a pending interaction with answers. Called when the user
    /// responds to a question card.
    pub fn resolve(id: &str, request: &ResolveInteractionRequest) -> DbResult<PendingInteraction> {
        let answers_json = serde_json::to_string(&request.answers).map_err(|e| e.to_string())?;
        let resolved_at = now_millis();
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE pending_interactions SET status = 'answered', answers_json = ?1, resolved_at = ?2 WHERE id = ?3 AND status = 'pending'",
            params![answers_json, resolved_at, id],
        )
        .map_err(|e| e.to_string())?;
        Self::get(id)?.ok_or_else(|| "Interaction not found after resolve".to_string())
    }

    /// Cancel a pending interaction. Called when the run is cancelled or the
    /// orphan sweep runs on startup.
    pub fn cancel(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE pending_interactions SET status = 'cancelled', resolved_at = ?1 WHERE id = ?2 AND status = 'pending'",
            params![now_millis(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Cancel all pending interactions for a session (used by the orphan sweep).
    pub fn cancel_pending_for_session(session_id: &str) -> DbResult<usize> {
        let conn = StorageService::connect()?;
        let count = conn.execute(
            "UPDATE pending_interactions SET status = 'cancelled', resolved_at = ?1 WHERE session_id = ?2 AND status = 'pending'",
            params![now_millis(), session_id],
        ).map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// List pending interactions for a session (for the frontend to render
    /// question cards).
    pub fn list_pending(session_id: &str) -> DbResult<Vec<PendingInteraction>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, run_id, questions_json, status, answers_json, created_at, resolved_at
                 FROM pending_interactions WHERE session_id = ?1 AND status = 'pending'
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], Self::row_to_interaction)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// List all interactions for a session (including answered/cancelled, for
    /// history reload).
    pub fn list_all(session_id: &str) -> DbResult<Vec<PendingInteraction>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, run_id, questions_json, status, answers_json, created_at, resolved_at
                 FROM pending_interactions WHERE session_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], Self::row_to_interaction)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get(id: &str) -> DbResult<Option<PendingInteraction>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, run_id, questions_json, status, answers_json, created_at, resolved_at
                 FROM pending_interactions WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![id], Self::row_to_interaction)
            .map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    /// Startup orphan sweep: cancel all stale pending interactions.
    /// Called alongside the existing interrupted-run sweep.
    pub fn sweep_orphans() -> DbResult<usize> {
        let conn = StorageService::connect()?;
        let count = conn.execute(
            "UPDATE pending_interactions SET status = 'cancelled', resolved_at = ?1 WHERE status = 'pending'",
            params![now_millis()],
        ).map_err(|e| e.to_string())?;
        Ok(count)
    }

    fn row_to_interaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingInteraction> {
        let questions_json: String = row.get(3)?;
        let questions: Vec<Question> = serde_json::from_str(&questions_json).unwrap_or_default();
        let status_str: String = row.get(4)?;
        let status = InteractionStatus::from_str(&status_str);
        let answers_json: Option<String> = row.get(5)?;
        let answers = answers_json.and_then(|s| serde_json::from_str(&s).ok());
        let run_id: Option<String> = row.get(2)?;
        let resolved_at: Option<i64> = row.get(7)?;
        Ok(PendingInteraction {
            id: row.get(0)?,
            session_id: row.get(1)?,
            run_id,
            questions,
            status,
            answers,
            created_at: row.get(6)?,
            resolved_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::interaction::{Question, QuestionKind, QuestionOption};

    fn sample_questions() -> Vec<Question> {
        vec![Question {
            id: "q1".into(),
            prompt: "Pick a color".into(),
            kind: QuestionKind::Options,
            options: vec![
                QuestionOption {
                    label: "Red".into(),
                    description: None,
                },
                QuestionOption {
                    label: "Blue".into(),
                    description: None,
                },
            ],
            recommended: Some(1),
            allow_free_text: false,
            detail: None,
        }]
    }

    #[test]
    fn create_and_list_pending() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction =
            InteractionService::create("sess_1", Some("run_1"), &sample_questions()).unwrap();
        assert_eq!(interaction.status, InteractionStatus::Pending);
        assert_eq!(interaction.questions.len(), 1);

        let pending = InteractionService::list_pending("sess_1").unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, interaction.id);
    }

    #[test]
    fn resolve_sets_answered() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction = InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        let request = ResolveInteractionRequest {
            answers: vec![QuestionAnswer {
                question_id: "q1".into(),
                selected: vec!["Blue".into()],
                text: None,
            }],
        };
        let resolved = InteractionService::resolve(&interaction.id, &request).unwrap();
        assert_eq!(resolved.status, InteractionStatus::Answered);
        assert!(resolved.answers.is_some());
        assert!(resolved.resolved_at.is_some());
    }

    #[test]
    fn cancel_sets_cancelled() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction = InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        InteractionService::cancel(&interaction.id).unwrap();
        let got = InteractionService::get(&interaction.id).unwrap().unwrap();
        assert_eq!(got.status, InteractionStatus::Cancelled);
    }

    #[test]
    fn sweep_orphans_cancels_all_pending() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        InteractionService::create("sess_2", None, &sample_questions()).unwrap();
        let swept = InteractionService::sweep_orphans().unwrap();
        assert_eq!(swept, 2);
        assert_eq!(InteractionService::list_pending("sess_1").unwrap().len(), 0);
        assert_eq!(InteractionService::list_pending("sess_2").unwrap().len(), 0);
    }
}

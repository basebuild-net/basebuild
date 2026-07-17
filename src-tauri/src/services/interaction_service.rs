use rusqlite::params;
use std::collections::HashSet;

use crate::{
    models::interaction::{
        InteractionStatus, PendingInteraction, Question, QuestionAnswer, QuestionKind,
        ResolveInteractionRequest,
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

const MAX_QUESTIONS: usize = 32;
const MAX_ID_BYTES: usize = 128;
const MAX_TITLE_BYTES: usize = 256;
const MAX_DESCRIPTION_BYTES: usize = 4_096;
const MAX_PROMPT_BYTES: usize = 4_096;
const MAX_DETAIL_BYTES: usize = 8_192;
const MAX_OPTIONS: usize = 20;
const MAX_OPTION_LABEL_BYTES: usize = 256;
const MAX_OPTION_DESCRIPTION_BYTES: usize = 1_024;
const MAX_ANSWER_TEXT_BYTES: usize = 32_768;

fn validate_optional_text(label: &str, value: Option<&str>, max_bytes: usize) -> DbResult<()> {
    if value.is_some_and(|text| text.len() > max_bytes) {
        return Err(format!("{label} exceeds {max_bytes} bytes"));
    }
    Ok(())
}

fn validate_questions(
    title: Option<&str>,
    description: Option<&str>,
    questions: &[Question],
) -> DbResult<()> {
    validate_optional_text("Interaction title", title, MAX_TITLE_BYTES)?;
    validate_optional_text(
        "Interaction description",
        description,
        MAX_DESCRIPTION_BYTES,
    )?;
    if questions.is_empty() {
        return Err("Interaction must contain at least one question".to_string());
    }
    if questions.len() > MAX_QUESTIONS {
        return Err(format!("Interaction exceeds {MAX_QUESTIONS} questions"));
    }

    let mut question_ids = HashSet::with_capacity(questions.len());
    let mut page_ids = HashSet::new();
    let mut current_page: Option<&str> = None;
    for question in questions {
        if question.id.trim().is_empty() || question.id.len() > MAX_ID_BYTES {
            return Err(format!(
                "Question id is empty or exceeds {MAX_ID_BYTES} bytes"
            ));
        }
        if !question_ids.insert(question.id.as_str()) {
            return Err(format!("Duplicate question id: {}", question.id));
        }
        if question.prompt.trim().is_empty() || question.prompt.len() > MAX_PROMPT_BYTES {
            return Err(format!(
                "Question {} prompt is empty or exceeds {MAX_PROMPT_BYTES} bytes",
                question.id
            ));
        }
        validate_optional_text(
            &format!("Question {} detail", question.id),
            question.detail.as_deref(),
            MAX_DETAIL_BYTES,
        )?;
        validate_optional_text(
            &format!("Question {} page title", question.id),
            question.page_title.as_deref(),
            MAX_TITLE_BYTES,
        )?;
        validate_optional_text(
            &format!("Question {} page description", question.id),
            question.page_description.as_deref(),
            MAX_DESCRIPTION_BYTES,
        )?;

        match question.page_id.as_deref() {
            Some(page_id) => {
                if page_id.trim().is_empty() || page_id.len() > MAX_ID_BYTES {
                    return Err(format!("Question {} has an invalid page id", question.id));
                }
                if current_page != Some(page_id) {
                    if !page_ids.insert(page_id) {
                        return Err(format!("Page id {page_id} is not contiguous"));
                    }
                    current_page = Some(page_id);
                }
            }
            None => {
                if question.page_title.is_some() || question.page_description.is_some() {
                    return Err(format!(
                        "Question {} has page metadata without a page id",
                        question.id
                    ));
                }
                if !page_ids.is_empty() {
                    return Err("Paged and legacy flat questions cannot be mixed".to_string());
                }
            }
        }

        if question.options.len() > MAX_OPTIONS {
            return Err(format!(
                "Question {} exceeds {MAX_OPTIONS} options",
                question.id
            ));
        }
        let mut option_labels = HashSet::with_capacity(question.options.len());
        for option in &question.options {
            if option.label.trim().is_empty() || option.label.len() > MAX_OPTION_LABEL_BYTES {
                return Err(format!(
                    "Question {} has an invalid option label",
                    question.id
                ));
            }
            if !option_labels.insert(option.label.as_str()) {
                return Err(format!(
                    "Question {} has duplicate option {}",
                    question.id, option.label
                ));
            }
            validate_optional_text(
                &format!("Question {} option description", question.id),
                option.description.as_deref(),
                MAX_OPTION_DESCRIPTION_BYTES,
            )?;
        }
        if question
            .recommended
            .is_some_and(|index| index >= question.options.len())
        {
            return Err(format!(
                "Question {} has an invalid recommended index",
                question.id
            ));
        }

        match question.kind {
            QuestionKind::Rating => {
                if !question.options.is_empty() || question.recommended.is_some() {
                    return Err(format!(
                        "Rating question {} cannot declare options or a recommendation",
                        question.id
                    ));
                }
                if let Some(scale) = &question.scale {
                    if scale.min < 0
                        || scale.max > 10
                        || scale.min >= scale.max
                        || scale.max - scale.min > 10
                    {
                        return Err(format!(
                            "Rating question {} must use an increasing 0–10 scale",
                            question.id
                        ));
                    }
                }
            }
            _ if question.scale.is_some() => {
                return Err(format!(
                    "Only rating question {} may declare a scale",
                    question.id
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_answers(
    interaction: &PendingInteraction,
    answers: &[QuestionAnswer],
    require_complete: bool,
) -> DbResult<()> {
    let mut answer_ids = HashSet::with_capacity(answers.len());
    for answer in answers {
        if !answer_ids.insert(answer.question_id.as_str()) {
            return Err(format!("Duplicate answer for {}", answer.question_id));
        }
        let question = interaction
            .questions
            .iter()
            .find(|candidate| candidate.id == answer.question_id)
            .ok_or_else(|| format!("Unknown question id: {}", answer.question_id))?;
        validate_optional_text(
            &format!("Answer {}", answer.question_id),
            answer.text.as_deref(),
            MAX_ANSWER_TEXT_BYTES,
        )?;
        if answer.selected.iter().any(|selected| {
            !question
                .options
                .iter()
                .any(|option| option.label == *selected)
        }) {
            return Err(format!(
                "Answer {} contains an unknown option",
                answer.question_id
            ));
        }
        if matches!(question.kind, QuestionKind::Options | QuestionKind::Confirm)
            && answer.selected.len() > 1
        {
            return Err(format!(
                "Answer {} accepts only one option",
                answer.question_id
            ));
        }
        if question.kind == QuestionKind::Rating {
            let scale = question.scale.as_ref();
            let min = scale.map_or(1, |value| value.min);
            let max = scale.map_or(5, |value| value.max);
            if answer.value.is_some_and(|value| value < min || value > max) {
                return Err(format!(
                    "Answer {} is outside the rating scale",
                    answer.question_id
                ));
            }
        } else if answer.value.is_some() {
            return Err(format!(
                "Only rating answer {} may contain a numeric value",
                answer.question_id
            ));
        }
    }

    if require_complete {
        for question in interaction
            .questions
            .iter()
            .filter(|question| question.required)
        {
            let answer = answers
                .iter()
                .find(|candidate| candidate.question_id == question.id)
                .ok_or_else(|| format!("Required question {} is unanswered", question.id))?;
            let present = match question.kind {
                QuestionKind::Rating => answer.value.is_some(),
                QuestionKind::Text => answer
                    .text
                    .as_deref()
                    .is_some_and(|text| !text.trim().is_empty()),
                _ => {
                    !answer.selected.is_empty()
                        || (question.allow_free_text
                            && answer
                                .text
                                .as_deref()
                                .is_some_and(|text| !text.trim().is_empty()))
                }
            };
            if !present {
                return Err(format!("Required question {} is unanswered", question.id));
            }
        }
    }
    Ok(())
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
        Self::create_with_metadata(session_id, run_id, None, None, questions)
    }

    pub fn create_with_metadata(
        session_id: &str,
        run_id: Option<&str>,
        title: Option<&str>,
        description: Option<&str>,
        questions: &[Question],
    ) -> DbResult<PendingInteraction> {
        validate_questions(title, description, questions)?;
        let id = gen_id();
        let created_at = now_millis();
        let questions_json = serde_json::to_string(questions).map_err(|e| e.to_string())?;
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO pending_interactions
             (id, session_id, run_id, title, description, questions_json, status,
              answers_json, draft_answers_json, draft_page, created_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, 0, ?7, NULL)",
            params![
                id,
                session_id,
                run_id,
                title,
                description,
                questions_json,
                created_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Self::get(&id)?.ok_or_else(|| "Interaction not found after insert".to_string())
    }

    /// Resolve a pending interaction with answers. Called when the user
    /// responds to a question card.
    pub fn resolve(id: &str, request: &ResolveInteractionRequest) -> DbResult<PendingInteraction> {
        let interaction = Self::get(id)?.ok_or_else(|| format!("Interaction not found: {id}"))?;
        if interaction.status != InteractionStatus::Pending {
            return Err(format!("Interaction {id} is already resolved"));
        }
        validate_answers(&interaction, &request.answers, true)?;
        let answers_json = serde_json::to_string(&request.answers).map_err(|e| e.to_string())?;
        let resolved_at = now_millis();
        let conn = StorageService::connect()?;
        let changed = conn
            .execute(
                "UPDATE pending_interactions
                 SET status = 'answered', answers_json = ?1,
                     draft_answers_json = NULL, resolved_at = ?2
                 WHERE id = ?3 AND status = 'pending'",
                params![answers_json, resolved_at, id],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err(format!("Interaction {id} is already resolved"));
        }
        Self::get(id)?.ok_or_else(|| "Interaction not found after resolve".to_string())
    }
    /// Persist incomplete answers and page navigation without resolving the
    /// interaction or touching the parked agent loop.
    pub fn save_draft(
        id: &str,
        answers: &[QuestionAnswer],
        current_page: usize,
    ) -> DbResult<PendingInteraction> {
        let interaction = Self::get(id)?.ok_or_else(|| format!("Interaction not found: {id}"))?;
        if interaction.status != InteractionStatus::Pending {
            return Err(format!("Interaction {id} is already resolved"));
        }
        validate_answers(&interaction, answers, false)?;
        let page_count = interaction
            .questions
            .iter()
            .filter_map(|question| question.page_id.as_deref())
            .collect::<HashSet<_>>()
            .len()
            .max(1);
        if current_page >= page_count {
            return Err(format!(
                "Draft page {current_page} is outside {page_count} questionnaire pages"
            ));
        }
        let draft_json = serde_json::to_string(answers).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        let changed = conn
            .execute(
                "UPDATE pending_interactions
                 SET draft_answers_json = ?1, draft_page = ?2
                 WHERE id = ?3 AND status = 'pending'",
                params![draft_json, current_page as i64, id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(format!("Interaction {id} is already resolved"));
        }
        Self::get(id)?.ok_or_else(|| "Interaction not found after draft save".to_string())
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
                "SELECT id, session_id, run_id, title, description, questions_json,
                        status, answers_json, draft_answers_json, draft_page,
                        created_at, resolved_at
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
                "SELECT id, session_id, run_id, title, description, questions_json,
                        status, answers_json, draft_answers_json, draft_page,
                        created_at, resolved_at
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
                "SELECT id, session_id, run_id, title, description, questions_json,
                        status, answers_json, draft_answers_json, draft_page,
                        created_at, resolved_at
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
        let questions_json: String = row.get(5)?;
        let questions: Vec<Question> = serde_json::from_str(&questions_json).unwrap_or_default();
        let status_str: String = row.get(6)?;
        let answers_json: Option<String> = row.get(7)?;
        let draft_answers_json: Option<String> = row.get(8)?;
        Ok(PendingInteraction {
            id: row.get(0)?,
            session_id: row.get(1)?,
            run_id: row.get(2)?,
            title: row.get(3)?,
            description: row.get(4)?,
            questions,
            status: InteractionStatus::from_str(&status_str),
            answers: answers_json.and_then(|value| serde_json::from_str(&value).ok()),
            draft_answers: draft_answers_json.and_then(|value| serde_json::from_str(&value).ok()),
            current_page: row.get::<_, i64>(9)?.max(0) as usize,
            created_at: row.get(10)?,
            resolved_at: row.get(11)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::interaction::{Question, QuestionKind, QuestionOption, RatingScale};

    fn sample_questions() -> Vec<Question> {
        vec![Question {
            id: "q1".into(),
            prompt: "Pick a color".into(),
            kind: QuestionKind::Options,
            page_id: None,
            page_title: None,
            page_description: None,
            required: false,
            multiline: false,
            scale: None,
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
    fn rejects_malformed_questions_before_persistence() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);

        let mut duplicate = sample_questions();
        duplicate.push(duplicate[0].clone());
        assert!(InteractionService::create("sess_1", None, &duplicate)
            .unwrap_err()
            .contains("Duplicate question id"));

        let mut invalid_recommendation = sample_questions();
        invalid_recommendation[0].recommended = Some(9);
        assert!(
            InteractionService::create("sess_1", None, &invalid_recommendation)
                .unwrap_err()
                .contains("recommended index")
        );

        let mut invalid_rating = sample_questions();
        invalid_rating[0].kind = QuestionKind::Rating;
        invalid_rating[0].options.clear();
        invalid_rating[0].recommended = None;
        invalid_rating[0].scale = Some(RatingScale {
            min: 5,
            max: 1,
            low_label: None,
            high_label: None,
            style: None,
        });
        assert!(InteractionService::create("sess_1", None, &invalid_rating)
            .unwrap_err()
            .contains("increasing"));

        let mut oversized = sample_questions();
        oversized[0].prompt = "x".repeat(MAX_PROMPT_BYTES + 1);
        assert!(InteractionService::create("sess_1", None, &oversized)
            .unwrap_err()
            .contains("prompt"));
        assert!(InteractionService::list_pending("sess_1")
            .unwrap()
            .is_empty());
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
    fn repeated_draft_save_keeps_interaction_pending() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction = InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        let draft = vec![QuestionAnswer {
            question_id: "q1".into(),
            selected: vec!["Blue".into()],
            text: None,
            value: None,
        }];

        InteractionService::save_draft(&interaction.id, &draft, 0).unwrap();
        let saved = InteractionService::save_draft(&interaction.id, &draft, 0).unwrap();

        assert_eq!(saved.status, InteractionStatus::Pending);
        assert!(saved.answers.is_none());
        assert_eq!(saved.draft_answers.unwrap()[0].selected, vec!["Blue"]);
        assert!(saved.resolved_at.is_none());
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
                value: None,
            }],
        };
        let resolved = InteractionService::resolve(&interaction.id, &request).unwrap();
        assert_eq!(resolved.status, InteractionStatus::Answered);
        assert!(resolved.answers.is_some());
        assert!(resolved.resolved_at.is_some());
    }

    #[test]
    fn failed_resolution_preserves_draft_and_valid_retry_succeeds() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction = InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        let draft = vec![QuestionAnswer {
            question_id: "q1".into(),
            selected: vec!["Blue".into()],
            text: None,
            value: None,
        }];
        InteractionService::save_draft(&interaction.id, &draft, 0).unwrap();
        let invalid = ResolveInteractionRequest {
            answers: vec![QuestionAnswer {
                question_id: "q1".into(),
                selected: vec!["Unknown".into()],
                text: None,
                value: None,
            }],
        };
        assert!(InteractionService::resolve(&interaction.id, &invalid).is_err());
        let pending = InteractionService::get(&interaction.id).unwrap().unwrap();
        assert_eq!(pending.status, InteractionStatus::Pending);
        assert_eq!(pending.draft_answers.unwrap()[0].selected, vec!["Blue"]);

        let resolved = InteractionService::resolve(
            &interaction.id,
            &ResolveInteractionRequest { answers: draft },
        )
        .unwrap();
        assert_eq!(resolved.status, InteractionStatus::Answered);
    }

    #[test]
    fn duplicate_resolution_is_rejected_without_overwriting_answers() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let interaction = InteractionService::create("sess_1", None, &sample_questions()).unwrap();
        let first = ResolveInteractionRequest {
            answers: vec![QuestionAnswer {
                question_id: "q1".into(),
                selected: vec!["Blue".into()],
                text: None,
                value: None,
            }],
        };
        InteractionService::resolve(&interaction.id, &first).unwrap();
        let second = ResolveInteractionRequest {
            answers: vec![QuestionAnswer {
                question_id: "q1".into(),
                selected: vec!["Red".into()],
                text: None,
                value: None,
            }],
        };
        assert!(InteractionService::resolve(&interaction.id, &second)
            .unwrap_err()
            .contains("already resolved"));
        let stored = InteractionService::get(&interaction.id).unwrap().unwrap();
        let answers = stored.answers.unwrap().to_string();
        assert!(answers.contains("Blue"));
        assert!(!answers.contains("Red"));
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

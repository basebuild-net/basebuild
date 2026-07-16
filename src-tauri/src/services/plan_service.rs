use rusqlite::params;

use crate::{
    models::{
        plan::{NewPlan, Plan, PlanFocusContext, PlanStatus},
        planning_assessment::PlanAssessment,
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

fn gen_reference_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut n = ts;
    let mut s = String::with_capacity(6);
    for _ in 0..6 {
        s.push(ALPHABET[(n % ALPHABET.len() as u128) as usize] as char);
        n /= ALPHABET.len() as u128;
    }
    format!("bb-{s}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct PlanService;

impl PlanService {
    pub fn create(session_id: &str, plan: &NewPlan) -> DbResult<Plan> {
        let id = gen_id();
        let reference_id = gen_reference_id();
        let created = now();
        let priority = plan.priority.unwrap_or(50);
        let tags_json = serde_json::to_string(&plan.tags).unwrap_or_else(|_| "[]".to_string());

        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO plans (
                id, session_id, reference_id, title, description, goal, status,
                priority, tags, ai_enhanced, context, idea_id, change_name,
                assessment_json, created_at, updated_at, finished_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                id,
                session_id,
                reference_id,
                plan.title,
                plan.description,
                plan.goal,
                plan.status.as_str(),
                priority,
                tags_json,
                false,
                None::<String>,
                plan.idea_id,
                None::<String>,
                None::<String>,
                created,
                created,
                None::<i64>,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(Plan {
            id,
            session_id: session_id.to_string(),
            reference_id,
            title: plan.title.clone(),
            description: plan.description.clone(),
            goal: plan.goal.clone(),
            status: plan.status,
            priority,
            tags: plan.tags.clone(),
            ai_enhanced: false,
            context: None,
            idea_id: plan.idea_id.clone(),
            change_name: None,
            assessment: None,
            created_at: created,
            updated_at: created,
            finished_at: None,
        })
    }

    pub fn list(session_id: &str) -> DbResult<Vec<Plan>> {
        crate::services::plan_runner_service::PlanRunnerService::reconcile_stale_owners(
            Some(session_id),
            None,
        )?;
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, reference_id, title, description, goal, status,
                        priority, tags, ai_enhanced, context, idea_id, change_name,
                        assessment_json, created_at, updated_at, finished_at
                 FROM plans
                 WHERE session_id = ?1
                   AND NOT EXISTS (
                       SELECT 1 FROM plan_archives WHERE plan_archives.plan_id = plans.id
                   )
                 ORDER BY created_at DESC, rowid DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![session_id], row_to_plan)
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn list_for_project(project_path: &str) -> DbResult<Vec<Plan>> {
        crate::services::plan_runner_service::PlanRunnerService::reconcile_stale_owners(
            None,
            Some(project_path),
        )?;
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, reference_id, title, description, goal, status,
                        priority, tags, ai_enhanced, context, idea_id, change_name,
                        assessment_json, created_at, updated_at, finished_at
                 FROM plans
                 WHERE session_id IN (
                   SELECT id FROM sessions WHERE project_path = ?1
                   UNION
                   SELECT id FROM native_chat_sessions WHERE project_path = ?1
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM plan_archives WHERE plan_archives.plan_id = plans.id
                 )
                 ORDER BY created_at DESC, rowid DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], row_to_plan)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get(id: &str) -> DbResult<Option<Plan>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, reference_id, title, description, goal, status,
                        priority, tags, ai_enhanced, context, idea_id, change_name,
                        assessment_json, created_at, updated_at, finished_at
                 FROM plans WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query_map(params![id], row_to_plan)
            .map_err(|e| e.to_string())?;

        rows.next().transpose().map_err(|e| e.to_string())
    }

    pub fn update(id: &str, patch: &NewPlan) -> DbResult<Plan> {
        let conn = StorageService::connect()?;
        let existing = Self::get(id)?.ok_or("Plan not found")?;
        let updated = now();
        let tags_json = serde_json::to_string(&patch.tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "UPDATE plans SET
                title = ?1, description = ?2, goal = ?3, status = ?4,
                priority = ?5, tags = ?6, updated_at = ?7
             WHERE id = ?8",
            params![
                patch.title,
                patch.description,
                patch.goal,
                patch.status.as_str(),
                patch.priority.unwrap_or(existing.priority),
                tags_json,
                updated,
                id,
            ],
        )
        .map_err(|e| e.to_string())?;

        Self::get(id)?.ok_or("Plan not found after update".to_string())
    }

    pub fn set_status(id: &str, status: PlanStatus) -> DbResult<Plan> {
        let conn = StorageService::connect()?;
        let finished_at = if status == PlanStatus::Finished {
            Some(now())
        } else {
            None::<i64>
        };

        conn.execute(
            "UPDATE plans SET status = ?1, updated_at = ?2, finished_at = ?3 WHERE id = ?4",
            params![status.as_str(), now(), finished_at, id],
        )
        .map_err(|e| e.to_string())?;

        Self::get(id)?.ok_or("Plan not found".to_string())
    }

    pub fn set_context(id: &str, context: &PlanFocusContext) -> DbResult<Plan> {
        let conn = StorageService::connect()?;
        let context_json = serde_json::to_string(context).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "UPDATE plans SET context = ?1, updated_at = ?2 WHERE id = ?3",
            params![context_json, now(), id],
        )
        .map_err(|e| e.to_string())?;

        Self::get(id)?.ok_or("Plan not found".to_string())
    }

    /// Link a plan to a generated OpenSpec change directory. Used by the
    /// openspec pipeline stage after artifacts are written atomically.
    pub fn set_change_name(id: &str, change_name: &str) -> DbResult<Plan> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE plans SET change_name = ?1, updated_at = ?2 WHERE id = ?3",
            params![change_name, now(), id],
        )
        .map_err(|e| e.to_string())?;
        Self::get(id)?.ok_or("Plan not found".to_string())
    }

    pub fn delete(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM plans WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Promote a batch of ideas to plans in one call. Per-idea errors are
    /// captured so partial success is reported. Returns the created plans and
    /// a list of per-idea errors (idea_id, error message).
    pub fn batch_promote_ideas(
        session_id: &str,
        idea_ids: &[String],
    ) -> DbResult<(Vec<Plan>, Vec<(String, String)>)> {
        let mut created = Vec::new();
        let mut errors = Vec::new();
        for idea_id in idea_ids {
            // Load the idea to get its title/description.
            let idea = match crate::services::session_service::SessionService::get_idea(idea_id) {
                Ok(Some(i)) => i,
                Ok(None) => {
                    errors.push((idea_id.clone(), "Idea not found".to_string()));
                    continue;
                }
                Err(e) => {
                    errors.push((idea_id.clone(), e));
                    continue;
                }
            };
            // Create the plan from the idea.
            let new_plan = NewPlan {
                title: idea.title.clone(),
                description: idea.description.clone(),
                goal: Some(idea.description.clone()),
                status: crate::models::plan::PlanStatus::Draft,
                priority: Some(50),
                tags: vec![],
                idea_id: Some(idea.id.clone()),
            };
            match Self::create(session_id, &new_plan) {
                Ok(plan) => {
                    // Mark the idea as picked.
                    let _ = crate::services::session_service::SessionService::update_idea_status(
                        &idea.id,
                        crate::models::idea::IdeaStatus::Picked,
                    );
                    created.push(plan);
                }
                Err(e) => {
                    errors.push((idea_id.clone(), e));
                }
            }
        }
        // Note: planning event emission is the caller's responsibility (the
        // command layer has the AppHandle). Per-idea plan_created events are
        // emitted by the command layer after each successful promote.
        Ok((created, errors))
    }
    pub fn save_assessment(id: &str, assessment: &PlanAssessment) -> DbResult<()> {
        assessment.validate()?;
        let assessment_json =
            serde_json::to_string(assessment).map_err(|error| error.to_string())?;
        let conn = StorageService::connect()?;
        let changed = conn
            .execute(
                "UPDATE plans SET assessment_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![assessment_json, now(), id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("Plan not found".to_string());
        }
        Ok(())
    }

    pub fn mark_assessment_stale_if_fingerprint_changed(
        id: &str,
        artifact_fingerprint: &str,
    ) -> DbResult<bool> {
        let Some(plan) = Self::get(id)? else {
            return Err("Plan not found".to_string());
        };
        let Some(mut assessment) = plan.assessment else {
            return Ok(false);
        };
        if assessment.artifact_fingerprint == artifact_fingerprint || assessment.stale {
            return Ok(false);
        }
        assessment.stale = true;
        Self::save_assessment(id, &assessment)?;
        Ok(true)
    }
}

/// Map a rusqlite row (in the column order used by `list`/`get`) to a `Plan`.
/// Centralized so both read paths stay in sync with the schema.
fn row_to_plan(row: &rusqlite::Row<'_>) -> rusqlite::Result<Plan> {
    let status_str: String = row.get(6)?;
    let tags_json: String = row.get(8)?;
    let context_json: Option<String> = row.get(10)?;
    let assessment_json: Option<String> = row.get(13)?;
    Ok(Plan {
        id: row.get(0)?,
        session_id: row.get(1)?,
        reference_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        goal: row.get(5)?,
        status: PlanStatus::from_str(&status_str),
        priority: row.get(7)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        ai_enhanced: row.get(9)?,
        context: context_json.and_then(|json| serde_json::from_str(&json).ok()),
        idea_id: row.get(11)?,
        change_name: row.get(12)?,
        assessment: assessment_json.and_then(|json| serde_json::from_str(&json).ok()),
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        finished_at: row.get(16)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::session_service::SessionService;

    fn draft(title: &str) -> NewPlan {
        NewPlan {
            title: title.to_string(),
            description: String::new(),
            goal: None,
            status: PlanStatus::Draft,
            priority: None,
            tags: Vec::new(),
            idea_id: None,
        }
    }

    #[test]
    fn project_list_keeps_newest_plans_first_and_excludes_archived() {
        let directory = tempfile::TempDir::new().unwrap();
        let _guard = crate::test_util::test::lock_db(&directory);
        let first = SessionService::create_session("/shared-project", "First").unwrap();
        let second = SessionService::create_session("/shared-project", "Second").unwrap();
        let other = SessionService::create_session("/other-project", "Other").unwrap();

        PlanService::create(&first.id, &draft("First plan")).unwrap();
        let archived = PlanService::create(&second.id, &draft("Archived plan")).unwrap();
        PlanService::create(&second.id, &draft("Second plan")).unwrap();
        PlanService::create(&other.id, &draft("Other plan")).unwrap();
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO plan_archives (plan_id, archived_at) VALUES (?1, 1)",
            params![archived.id],
        )
        .unwrap();

        let plans = PlanService::list_for_project("/shared-project").unwrap();
        assert_eq!(
            plans
                .iter()
                .map(|plan| plan.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Second plan", "First plan"]
        );
    }
}

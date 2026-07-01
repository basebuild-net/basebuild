use std::path::Path;

use rusqlite::params;

use crate::{
    models::plan::{NewPlan, Plan, PlanFocusContext, PlanStatus},
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
                priority, tags, ai_enhanced, context, created_at, updated_at, finished_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
            created_at: created,
            updated_at: created,
            finished_at: None,
        })
    }

    pub fn list(session_id: &str) -> DbResult<Vec<Plan>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, reference_id, title, description, goal, status,
                        priority, tags, ai_enhanced, context, created_at, updated_at, finished_at
                 FROM plans WHERE session_id = ?1 ORDER BY priority DESC, updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![session_id], |row| {
            let status_str: String = row.get(6)?;
            let tags_json: String = row.get(8)?;
            let context_json: Option<String> = row.get(10)?;
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
                context: context_json
                    .and_then(|j| serde_json::from_str(&j).ok()),
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                finished_at: row.get(13)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get(id: &str) -> DbResult<Option<Plan>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, reference_id, title, description, goal, status,
                        priority, tags, ai_enhanced, context, created_at, updated_at, finished_at
                 FROM plans WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![id], |row| {
            let status_str: String = row.get(6)?;
            let tags_json: String = row.get(8)?;
            let context_json: Option<String> = row.get(10)?;
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
                context: context_json
                    .and_then(|j| serde_json::from_str(&j).ok()),
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                finished_at: row.get(13)?,
            })
        }).map_err(|e| e.to_string())?;

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

    pub fn delete(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM plans WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_all_for_project(project_path: &Path) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let session_ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM sessions WHERE project_path = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![project_path.to_string_lossy()], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for sid in &session_ids {
            conn.execute("DELETE FROM plans WHERE session_id = ?1", params![sid])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

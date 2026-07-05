//! Structured plan proposal capture for generate-plans runs.
//!
//! Proposals are persisted per session + run as `plan_proposals` rows. The
//! agent loop's `propose_plans` tool captures them; the UI renders them as
//! selectable cards. Accepted proposals create a draft plan and link
//! `plan_id`. Dismissed proposals persist (append-only across runs).

use rusqlite::{params, OptionalExtension};

use crate::{
    models::plan::{NewPlan, PlanStatus},
    models::plan_proposal::{PlanProposal, PlanProposalInput, ProposalState},
    services::{plan_service::PlanService, storage_service::StorageService},
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

#[derive(Debug, Default)]
pub struct PlanProposalService;

impl PlanProposalService {
    /// Capture a proposal from the agent loop's `propose_plans` tool.
    /// Append-only: each call inserts a new row in the `proposed` state.
    pub fn capture(input: PlanProposalInput) -> DbResult<PlanProposal> {
        if input.title.trim().is_empty() {
            return Err("Proposal title is required.".to_string());
        }
        let id = gen_id();
        let created = now();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO plan_proposals
                (id, session_id, run_id, title, description, goal, suggested_change_name, state, plan_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)",
            params![
                id,
                input.session_id,
                input.run_id,
                input.title,
                input.description,
                input.goal,
                input.suggested_change_name,
                ProposalState::Proposed.as_str(),
                created,
            ],
        )
        .map_err(|e| format!("Failed to capture plan proposal: {e}"))?;
        Self::get(&id)?.ok_or_else(|| "Captured proposal not found".to_string())
    }

    /// List all proposals for a session, oldest first (stable order for UI).
    /// Includes accepted, dismissed, and pending proposals — reloads with the
    /// session across restarts and regenerations.
    pub fn list_for_session(session_id: &str) -> DbResult<Vec<PlanProposal>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, run_id, title, description, goal, suggested_change_name,
                        state, plan_id, created_at
                 FROM plan_proposals WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], row_to_proposal)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Accept a proposal: create a draft plan carrying the proposal's title,
    /// description, and goal, link the proposal to it, and mark it `accepted`.
    /// The draft plan is visible in the Plans panel immediately.
    pub fn accept(proposal_id: &str) -> DbResult<PlanProposal> {
        let proposal = Self::get(proposal_id)?
            .ok_or_else(|| format!("Proposal '{}' not found", proposal_id))?;
        if proposal.state != ProposalState::Proposed.as_str() {
            return Err(format!(
                "Proposal '{}' is already '{}'; cannot accept.",
                proposal_id, proposal.state
            ));
        }
        let plan = PlanService::create(
            &proposal.session_id,
            &NewPlan {
                title: proposal.title.clone(),
                description: proposal.description.clone(),
                goal: Some(proposal.goal.clone()),
                status: PlanStatus::Draft,
                priority: Some(50),
                tags: vec![],
                idea_id: None,
            },
        )?;
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE plan_proposals SET state = ?1, plan_id = ?2 WHERE id = ?3",
            params![ProposalState::Accepted.as_str(), plan.id, proposal_id],
        )
        .map_err(|e| e.to_string())?;
        Self::get(proposal_id)?
            .ok_or_else(|| "Accepted proposal not found after update".to_string())
    }

    /// Dismiss a proposal: mark it `dismissed`. Persists so it survives
    /// restarts and regenerations (append-only).
    pub fn dismiss(proposal_id: &str) -> DbResult<PlanProposal> {
        let proposal = Self::get(proposal_id)?
            .ok_or_else(|| format!("Proposal '{}' not found", proposal_id))?;
        if proposal.state != ProposalState::Proposed.as_str() {
            return Err(format!(
                "Proposal '{}' is already '{}'; cannot dismiss.",
                proposal_id, proposal.state
            ));
        }
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE plan_proposals SET state = ?1 WHERE id = ?2",
            params![ProposalState::Dismissed.as_str(), proposal_id],
        )
        .map_err(|e| e.to_string())?;
        Self::get(proposal_id)?
            .ok_or_else(|| "Dismissed proposal not found after update".to_string())
    }

    /// Get a single proposal by id.
    pub fn get(proposal_id: &str) -> DbResult<Option<PlanProposal>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, session_id, run_id, title, description, goal, suggested_change_name,
                    state, plan_id, created_at
             FROM plan_proposals WHERE id = ?1",
            params![proposal_id],
            row_to_proposal,
        )
        .optional()
        .map_err(|e| e.to_string())
    }
}

fn row_to_proposal(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanProposal> {
    Ok(PlanProposal {
        id: row.get(0)?,
        session_id: row.get(1)?,
        run_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        goal: row.get(5)?,
        suggested_change_name: row.get(6)?,
        state: row.get(7)?,
        plan_id: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test::lock_db;

    fn seed_session(project_path: &str) -> String {
        let session =
            crate::services::session_service::SessionService::create_session(project_path, "test")
                .unwrap();
        session.id
    }

    #[test]
    fn capture_persists_proposal_in_proposed_state() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session_id = seed_session("/test/proposal-capture");
        let proposal = PlanProposalService::capture(PlanProposalInput {
            session_id: session_id.clone(),
            run_id: None,
            title: "Add rate limiting".to_string(),
            description: "Per-IP token bucket".to_string(),
            goal: "Stabilize API under load".to_string(),
            suggested_change_name: "rate-limiting".to_string(),
        })
        .unwrap();
        assert_eq!(proposal.state, "proposed");
        assert!(proposal.plan_id.is_none());
        let listed = PlanProposalService::list_for_session(&session_id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, proposal.id);
    }

    #[test]
    fn accept_creates_draft_plan_and_links() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session_id = seed_session("/test/proposal-accept");
        let proposal = PlanProposalService::capture(PlanProposalInput {
            session_id: session_id.clone(),
            run_id: None,
            title: "Health check".to_string(),
            description: "GET /health".to_string(),
            goal: "Observability".to_string(),
            suggested_change_name: "health-check".to_string(),
        })
        .unwrap();
        let accepted = PlanProposalService::accept(&proposal.id).unwrap();
        assert_eq!(accepted.state, "accepted");
        let plan_id = accepted.plan_id.expect("plan_id linked");
        let plan = PlanService::get(&plan_id).unwrap().expect("plan exists");
        assert_eq!(plan.title, "Health check");
        assert_eq!(plan.goal.as_deref(), Some("Observability"));
        assert_eq!(plan.status, PlanStatus::Draft);
    }

    #[test]
    fn dismiss_persists_without_creating_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session_id = seed_session("/test/proposal-dismiss");
        let proposal = PlanProposalService::capture(PlanProposalInput {
            session_id,
            run_id: None,
            title: "Bad idea".to_string(),
            description: "".to_string(),
            goal: "".to_string(),
            suggested_change_name: "bad-idea".to_string(),
        })
        .unwrap();
        let dismissed = PlanProposalService::dismiss(&proposal.id).unwrap();
        assert_eq!(dismissed.state, "dismissed");
        assert!(dismissed.plan_id.is_none());
    }

    #[test]
    fn list_is_append_only_across_runs() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session_id = seed_session("/test/proposal-append");
        for i in 0..3 {
            PlanProposalService::capture(PlanProposalInput {
                session_id: session_id.clone(),
                run_id: Some(format!("run-{i}")),
                title: format!("Plan {i}"),
                description: "".to_string(),
                goal: "".to_string(),
                suggested_change_name: format!("plan-{i}"),
            })
            .unwrap();
        }
        let listed = PlanProposalService::list_for_session(&session_id).unwrap();
        assert_eq!(listed.len(), 3);
        // Stable order: oldest first.
        assert_eq!(listed[0].title, "Plan 0");
        assert_eq!(listed[2].title, "Plan 2");
    }

    #[test]
    fn accept_is_idempotent_reject() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = lock_db(&dir);
        let session_id = seed_session("/test/proposal-double-accept");
        let proposal = PlanProposalService::capture(PlanProposalInput {
            session_id,
            run_id: None,
            title: "Once".to_string(),
            description: "".to_string(),
            goal: "".to_string(),
            suggested_change_name: "once".to_string(),
        })
        .unwrap();
        PlanProposalService::accept(&proposal.id).unwrap();
        let second = PlanProposalService::accept(&proposal.id);
        assert!(second.is_err(), "second accept should fail");
    }
}

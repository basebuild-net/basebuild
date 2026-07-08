use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension};

use crate::{
    models::plan::{Plan, PlanStatus},
    models::plan_dependency::{
        CoordinationEvent, DependencyGraph, DependencyNode, FileClaim, LaunchProfile,
        MergeReviewEntry, SetDependenciesRequest, ValidationResult,
    },
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

const VALID_SCHEDULING_MODES: [&str; 2] = ["safe", "yolo"];
const VALID_WORKSPACE_POLICIES: [&str; 2] = ["isolated_worktrees", "sequential_primary"];
const VALID_EVENT_KINDS: [&str; 6] = ["progress", "blocker", "claim", "release", "artifact", "completion"];
const VALID_MERGE_DECISIONS: [&str; 3] = ["approved", "rejected", "merged"];
const VALID_CLAIM_ACTIONS: [&str; 2] = ["claim", "release"];

/// Reject change names that could escape the openspec/changes directory.
fn validate_change_name(name: &str) -> DbResult<()> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
    {
        Err(format!("Invalid change name: '{name}'"))
    } else {
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct PlanDependencyService;

impl PlanDependencyService {
    // ── Dependencies CRUD ──────────────────────────────────────────────

    /// Set/update dependency metadata for a plan. Merges with existing:
    /// omitted fields preserve the current value.
    pub fn set_dependencies(req: &SetDependenciesRequest) -> DbResult<Plan> {
        let plan = PlanService::get(&req.plan_id)?
            .ok_or("Plan not found")?;
        if let Some(mode) = &req.scheduling_mode {
            if !VALID_SCHEDULING_MODES.contains(&mode.as_str()) {
                return Err(format!("Invalid scheduling_mode: '{mode}'"));
            }
        }
        if let Some(policy) = &req.workspace_policy {
            if !VALID_WORKSPACE_POLICIES.contains(&policy.as_str()) {
                return Err(format!("Invalid workspace_policy: '{policy}'"));
            }
        }
        let conn = StorageService::connect()?;

        let prerequisites_json =
            serde_json::to_string(&req.prerequisites).unwrap_or_else(|_| "[]".to_string());
        let affected_paths_json =
            serde_json::to_string(&req.affected_paths).unwrap_or_else(|_| "[]".to_string());
        let priority = req.priority.unwrap_or(plan.priority);
        let scheduling_mode = req
            .scheduling_mode
            .clone()
            .unwrap_or_else(|| Self::get_scheduling_mode(&conn, &req.plan_id));
        let workspace_policy = req
            .workspace_policy
            .clone()
            .unwrap_or_else(|| Self::get_workspace_policy(&conn, &req.plan_id));

        conn.execute(
            "UPDATE plans SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            params![priority, now(), req.plan_id],
        )
        .map_err(|e| e.to_string())?;

        // Upsert dependency metadata.
        conn.execute(
            "INSERT INTO plan_dependency_meta (
                plan_id, prerequisites, affected_paths, scheduling_mode, workspace_policy, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(plan_id) DO UPDATE SET
                prerequisites = excluded.prerequisites,
                affected_paths = excluded.affected_paths,
                scheduling_mode = excluded.scheduling_mode,
                workspace_policy = excluded.workspace_policy,
                updated_at = excluded.updated_at",
            params![
                req.plan_id,
                prerequisites_json,
                affected_paths_json,
                scheduling_mode,
                workspace_policy,
                now(),
            ],
        )
        .map_err(|e| format!("Failed to set dependencies: {e}"))?;

        PlanService::get(&req.plan_id)?.ok_or("Plan not found after update".to_string())
    }

    /// Get dependency metadata for a plan.
    pub fn get_dependencies(plan_id: &str) -> DbResult<crate::models::plan_dependency::PlanDependencies> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT plan_id, prerequisites, affected_paths, scheduling_mode, workspace_policy
             FROM plan_dependency_meta WHERE plan_id = ?1",
            params![plan_id],
            |row| {
                let prereqs_json: String = row.get(1)?;
                let paths_json: String = row.get(2)?;
                let scheduling: String = row.get(3)?;
                let workspace: String = row.get(4)?;
                Ok(crate::models::plan_dependency::PlanDependencies {
                    plan_id: row.get(0)?,
                    prerequisites: serde_json::from_str(&prereqs_json).unwrap_or_default(),
                    affected_paths: serde_json::from_str(&paths_json).unwrap_or_default(),
                    priority: 0,
                    scheduling_mode: scheduling,
                    workspace_policy: workspace,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .map(|mut d| {
            // Fill priority from the plan row.
            if let Ok(Some(plan)) = PlanService::get(plan_id) {
                d.priority = plan.priority;
            }
            d
        })
        .ok_or_else(|| "Dependencies not found".to_string())
    }

    fn get_scheduling_mode(conn: &rusqlite::Connection, plan_id: &str) -> String {
        conn.query_row(
            "SELECT scheduling_mode FROM plan_dependency_meta WHERE plan_id = ?1",
            params![plan_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "safe".to_string())
    }

    fn get_workspace_policy(conn: &rusqlite::Connection, plan_id: &str) -> String {
        conn.query_row(
            "SELECT workspace_policy FROM plan_dependency_meta WHERE plan_id = ?1",
            params![plan_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "isolated_worktrees".to_string())
    }

    // ── Dependency Graph ───────────────────────────────────────────────

    /// Build the full dependency graph for a session: nodes for each plan,
    /// readiness state, collisions, and cycle detection.
    pub fn build_graph(session_id: &str) -> DbResult<DependencyGraph> {
        let plans = PlanService::list(session_id)?;
        let conn = StorageService::connect()?;

        // Load all dependency metadata for these plans.
        let mut deps_map: HashMap<String, crate::models::plan_dependency::PlanDependencies> = HashMap::new();
        for plan in &plans {
            if let Ok(d) = Self::get_dependencies(&plan.id) {
                deps_map.insert(plan.id.clone(), d);
            }
        }

        // Load active file claims for collision inference.
        let active_claims = Self::list_active_claims_internal(&conn, session_id)?;

        // Build path → plan_id map from affected_paths and active claims.
        let mut path_to_plans: HashMap<String, HashSet<String>> = HashMap::new();
        for plan in &plans {
            if let Some(d) = deps_map.get(&plan.id) {
                for path in &d.affected_paths {
                    path_to_plans
                        .entry(path.clone())
                        .or_default()
                        .insert(plan.id.clone());
                }
            }
        }
        for claim in &active_claims {
            path_to_plans
                .entry(claim.path.clone())
                .or_default()
                .insert(claim.plan_id.clone());
        }

        // Detect cycles using DFS.
        let cycles = Self::detect_cycles(&plans, &deps_map);

        // Build nodes.
        let mut nodes = Vec::new();
        for plan in &plans {
            let deps = deps_map.get(&plan.id);
            let prerequisites = deps
                .map(|d| d.prerequisites.clone())
                .unwrap_or_default();
            let affected_paths = deps
                .map(|d| d.affected_paths.clone())
                .unwrap_or_default();
            let scheduling_mode = deps
                .map(|d| d.scheduling_mode.clone())
                .unwrap_or_else(|| "safe".to_string());

            // Compute collisions: plans that share affected paths.
            let mut collisions = Vec::new();
            for path in &affected_paths {
                if let Some(plans_for_path) = path_to_plans.get(path) {
                    for other_id in plans_for_path {
                        if other_id != &plan.id && !collisions.contains(other_id) {
                            collisions.push(other_id.clone());
                        }
                    }
                }
            }

            // Compute readiness.
            let (readiness, block_reason, dispatchable) =
                Self::compute_readiness(plan, &prerequisites, &collisions, &plans, &scheduling_mode);

            nodes.push(DependencyNode {
                plan_id: plan.id.clone(),
                reference_id: plan.reference_id.clone(),
                title: plan.title.clone(),
                status: plan.status.as_str().to_string(),
                priority: plan.priority,
                prerequisites,
                affected_paths,
                readiness,
                block_reason,
                collisions,
                dispatchable,
                yolo_confirmed: scheduling_mode == "yolo",
            });
        }

        // Sort by priority descending.
        nodes.sort_by(|a, b| b.priority.cmp(&a.priority));

        Ok(DependencyGraph {
            session_id: session_id.to_string(),
            nodes,
            cycles,
        })
    }

    /// Compute readiness for a plan based on prerequisites and collisions.
    fn compute_readiness(
        plan: &Plan,
        prerequisites: &[String],
        collisions: &[String],
        all_plans: &[Plan],
        scheduling_mode: &str,
    ) -> (String, Option<String>, bool) {
        // Terminal states take precedence.
        if plan.status == PlanStatus::Finished {
            return ("finished".to_string(), None, false);
        }
        if plan.status == PlanStatus::Cancelled {
            return ("cancelled".to_string(), None, false);
        }
        if plan.status == PlanStatus::Running {
            return ("running".to_string(), None, false);
        }

        // Check prerequisites: all must be finished.
        let unmet: Vec<String> = prerequisites
            .iter()
            .filter(|pid| {
                if let Some(p) = all_plans.iter().find(|p| &p.id == *pid) {
                    p.status != PlanStatus::Finished
                } else {
                    true // Prerequisite plan not found → unmet.
                }
            })
            .cloned()
            .collect();

        if !unmet.is_empty() {
            let reason = format!(
                "Waiting on prerequisites: {}",
                unmet.join(", ")
            );
            return ("blocked".to_string(), Some(reason), false);
        }

        // Check collisions: in safe mode, conflicting plans can't run simultaneously.
        if scheduling_mode != "yolo" && !collisions.is_empty() {
            // Check if any collision is currently running.
            let running_collisions: Vec<String> = collisions
                .iter()
                .filter(|pid| {
                    if let Some(p) = all_plans.iter().find(|p| &p.id == *pid) {
                        p.status == PlanStatus::Running
                    } else {
                        false
                    }
                })
                .cloned()
                .collect();

            if !running_collisions.is_empty() {
                let reason = format!(
                    "File collision with running plan(s): {}",
                    running_collisions.join(", ")
                );
                return ("blocked".to_string(), Some(reason), false);
            }
        }

        // Ready to dispatch.
        ("ready".to_string(), None, true)
    }

    /// Detect cycles in the prerequisite graph using DFS.
    fn detect_cycles(
        plans: &[Plan],
        deps_map: &HashMap<String, crate::models::plan_dependency::PlanDependencies>,
    ) -> Vec<Vec<String>> {
        let mut visited = HashSet::new();
        let mut rec_stack = Vec::new();
        let mut in_stack = HashSet::new();
        let mut cycles = Vec::new();

        fn dfs(
            plan_id: &str,
            deps_map: &HashMap<String, crate::models::plan_dependency::PlanDependencies>,
            visited: &mut HashSet<String>,
            rec_stack: &mut Vec<String>,
            in_stack: &mut HashSet<String>,
            cycles: &mut Vec<Vec<String>>,
        ) {
            if in_stack.contains(plan_id) {
                // Found a cycle: extract from rec_stack.
                if let Some(start) = rec_stack.iter().position(|id| id == plan_id) {
                    let cycle: Vec<String> = rec_stack[start..].to_vec();
                    if !cycle.is_empty() {
                        cycles.push(cycle);
                    }
                }
                return;
            }
            if visited.contains(plan_id) {
                return;
            }
            visited.insert(plan_id.to_string());
            in_stack.insert(plan_id.to_string());
            rec_stack.push(plan_id.to_string());

            if let Some(deps) = deps_map.get(plan_id) {
                for prereq in &deps.prerequisites {
                    dfs(
                        prereq,
                        deps_map,
                        visited,
                        rec_stack,
                        in_stack,
                        cycles,
                    );
                }
            }

            rec_stack.pop();
            in_stack.remove(plan_id);
        }

        for plan in plans {
            dfs(
                &plan.id,
                deps_map,
                &mut visited,
                &mut rec_stack,
                &mut in_stack,
                &mut cycles,
            );
        }

        cycles
    }

    // ── Validation ─────────────────────────────────────────────────────

    /// Validate that a plan is ready for dispatch: check artifact
    /// completeness, dependency cycles, and status.
    pub fn validate_readiness(plan_id: &str) -> DbResult<ValidationResult> {
        let plan = PlanService::get(plan_id)?
            .ok_or("Plan not found")?;
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Status must be ready (or openspec with artifacts).
        if plan.status != PlanStatus::Ready && plan.status != PlanStatus::Openspec {
            errors.push(format!(
                "Plan status is {} — must be ready or openspec to dispatch.",
                plan.status.as_str()
            ));
        }

        // Check for cycles.
        let session_id = &plan.session_id;
        let graph = Self::build_graph(session_id)?;
        for cycle in &graph.cycles {
            if cycle.contains(&plan.id) {
                errors.push(format!(
                    "Dependency cycle detected: {} → {}. Remove the cycle before dispatch.",
                    cycle.join(" → "),
                    cycle.first().unwrap_or(&plan.id)
                ));
            }
        }

        // Check prerequisites are finished.
        if let Ok(deps) = Self::get_dependencies(plan_id) {
            for prereq_id in &deps.prerequisites {
                match PlanService::get(prereq_id) {
                    Ok(Some(p)) => {
                        if p.status != PlanStatus::Finished {
                            errors.push(format!(
                                "Prerequisite '{}' is not finished (current: {}).",
                                p.title,
                                p.status.as_str()
                            ));
                        }
                    }
                    Ok(None) => {
                        errors.push(format!("Prerequisite plan {} not found.", prereq_id));
                    }
                    Err(e) => {
                        warnings.push(format!("Could not load prerequisite {}: {}", prereq_id, e));
                    }
                }
            }

            // Warn on collisions.
            if let Some(node) = graph.nodes.iter().find(|n| n.plan_id == plan.id) {
                if !node.collisions.is_empty() {
                    warnings.push(format!(
                        "File collisions with plan(s): {}",
                        node.collisions.join(", ")
                    ));
                }
            }
        }

        // Check OpenSpec artifacts exist if change_name is set.
        if let Some(change_name) = &plan.change_name {
            if let Err(e) = validate_change_name(change_name) {
                errors.push(e);
            } else {
            let session = crate::services::session_service::SessionService::get(&plan.session_id)
                .ok()
                .flatten();
            if let Some(s) = session {
                let change_dir = std::path::Path::new(&s.project_path)
                    .join("openspec/changes")
                    .join(change_name);
                if !change_dir.exists() {
                    warnings.push(format!(
                        "Change directory '{}' not found — artifacts may not be generated yet.",
                        change_name
                    ));
                } else {
                    // Check for tasks.md.
                    let tasks_path = change_dir.join("tasks.md");
                    if !tasks_path.exists() {
                        warnings.push(format!(
                            "tasks.md not found in change '{}' — validation incomplete.",
                            change_name
                        ));
                    }
                }
            }
            }
        }

        let valid = errors.is_empty();
        Ok(ValidationResult {
            plan_id: plan_id.to_string(),
            valid,
            errors,
            warnings,
        })
    }

    // ── File Claims ────────────────────────────────────────────────────

    /// Set file claims for a run. Action is "claim" or "release".
    pub fn set_file_claims(
        run_id: &str,
        plan_id: &str,
        session_id: &str,
        paths: &[String],
        action: &str,
    ) -> DbResult<()> {
        if !VALID_CLAIM_ACTIONS.contains(&action) {
            return Err(format!("Invalid claim action: '{action}'"));
        }
        let conn = StorageService::connect()?;
        let ts = now();
        for path in paths {
            let id = gen_id();
            if action == "release" {
                // Mark existing claims as released.
                conn.execute(
                    "UPDATE plan_file_claims SET released_at = ?1
                     WHERE run_id = ?2 AND plan_id = ?3 AND path = ?4 AND released_at IS NULL",
                    params![ts, run_id, plan_id, path],
                )
                .map_err(|e| format!("Failed to release claim: {e}"))?;
            } else {
                conn.execute(
                    "INSERT INTO plan_file_claims (id, run_id, plan_id, session_id, path, action, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, run_id, plan_id, session_id, path, action, ts],
                )
                .map_err(|e| format!("Failed to insert claim: {e}"))?;
            }
        }
        Ok(())
    }

    /// List all file claims for a session (including released).
    pub fn list_file_claims(session_id: &str) -> DbResult<Vec<FileClaim>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, run_id, plan_id, session_id, path, action, created_at, released_at
                 FROM plan_file_claims WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(FileClaim {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    session_id: row.get(3)?,
                    path: row.get(4)?,
                    action: row.get(5)?,
                    created_at: row.get(6)?,
                    released_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// List only active (unreleased) claims for a session.
    fn list_active_claims_internal(
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> DbResult<Vec<FileClaim>> {
        let mut stmt = conn
            .prepare(
                "SELECT id, run_id, plan_id, session_id, path, action, created_at, released_at
                 FROM plan_file_claims WHERE session_id = ?1 AND released_at IS NULL
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(FileClaim {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    plan_id: row.get(2)?,
                    session_id: row.get(3)?,
                    path: row.get(4)?,
                    action: row.get(5)?,
                    created_at: row.get(6)?,
                    released_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    // ── Coordination Events ────────────────────────────────────────────

    /// Publish a coordination event to the append-only ledger.
    pub fn publish_event(
        session_id: &str,
        run_id: &str,
        plan_id: &str,
        kind: &str,
        payload: &str,
    ) -> DbResult<CoordinationEvent> {
        if !VALID_EVENT_KINDS.contains(&kind) {
            return Err(format!("Invalid event kind: '{kind}'"));
        }
        let conn = StorageService::connect()?;
        let id = gen_id();
        let ts = now();
        conn.execute(
            "INSERT INTO plan_coordination_events (id, session_id, run_id, plan_id, kind, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, run_id, plan_id, kind, payload, ts],
        )
        .map_err(|e| format!("Failed to publish coordination event: {e}"))?;
        Ok(CoordinationEvent {
            id,
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            plan_id: plan_id.to_string(),
            kind: kind.to_string(),
            payload: payload.to_string(),
            created_at: ts,
        })
    }

    /// List coordination events for a session, optionally since a timestamp.
    pub fn list_events(session_id: &str, since: Option<i64>) -> DbResult<Vec<CoordinationEvent>> {
        let conn = StorageService::connect()?;
        let mut stmt = if since.is_some() {
            conn.prepare(
                "SELECT id, session_id, run_id, plan_id, kind, payload, created_at
                 FROM plan_coordination_events WHERE session_id = ?1 AND created_at > ?2
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?
        } else {
            conn.prepare(
                "SELECT id, session_id, run_id, plan_id, kind, payload, created_at
                 FROM plan_coordination_events WHERE session_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?
        };
        let rows = if let Some(since_ts) = since {
            stmt.query_map(params![session_id, since_ts], Self::map_event)
                .map_err(|e| e.to_string())?
        } else {
            stmt.query_map(params![session_id], Self::map_event)
                .map_err(|e| e.to_string())?
        };
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoordinationEvent> {
        Ok(CoordinationEvent {
            id: row.get(0)?,
            session_id: row.get(1)?,
            run_id: row.get(2)?,
            plan_id: row.get(3)?,
            kind: row.get(4)?,
            payload: row.get(5)?,
            created_at: row.get(6)?,
        })
    }

    // ── Launch Profile ─────────────────────────────────────────────────

    /// Save a launch profile for a project.
    pub fn set_launch_profile(profile: &LaunchProfile) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO plan_launch_profiles (project_path, engine, provider_id, model_id,
             effort_level, skill_id, worker_count, workspace_policy, scheduling_mode, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(project_path) DO UPDATE SET
                engine = excluded.engine,
                provider_id = excluded.provider_id,
                model_id = excluded.model_id,
                effort_level = excluded.effort_level,
                skill_id = excluded.skill_id,
                worker_count = excluded.worker_count,
                workspace_policy = excluded.workspace_policy,
                scheduling_mode = excluded.scheduling_mode,
                updated_at = excluded.updated_at",
            params![
                profile.project_path,
                profile.engine,
                profile.provider_id,
                profile.model_id,
                profile.effort_level,
                profile.skill_id,
                profile.worker_count,
                profile.workspace_policy,
                profile.scheduling_mode,
                now(),
            ],
        )
        .map_err(|e| format!("Failed to save launch profile: {e}"))?;
        Ok(())
    }

    /// Get the launch profile for a project.
    pub fn get_launch_profile(project_path: &str) -> DbResult<Option<LaunchProfile>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT project_path, engine, provider_id, model_id, effort_level, skill_id,
             worker_count, workspace_policy, scheduling_mode, updated_at
             FROM plan_launch_profiles WHERE project_path = ?1",
            params![project_path],
            |row| {
                Ok(LaunchProfile {
                    project_path: row.get(0)?,
                    engine: row.get(1)?,
                    provider_id: row.get(2)?,
                    model_id: row.get(3)?,
                    effort_level: row.get(4)?,
                    skill_id: row.get(5)?,
                    worker_count: row.get(6)?,
                    workspace_policy: row.get(7)?,
                    scheduling_mode: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    // ── Merge Review Queue ─────────────────────────────────────────────

    /// Add a completed run to the merge-review queue.
    pub fn add_to_merge_queue(
        run_id: &str,
        plan_id: &str,
        session_id: &str,
        collision_review_required: bool,
        overlapping_plans: &[String],
    ) -> DbResult<MergeReviewEntry> {
        let conn = StorageService::connect()?;
        let id = gen_id();
        let ts = now();
        let overlapping_json =
            serde_json::to_string(overlapping_plans).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO plan_merge_queue (id, run_id, plan_id, session_id, status,
             collision_review_required, overlapping_plans, created_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7)",
            params![
                id,
                run_id,
                plan_id,
                session_id,
                collision_review_required as i32,
                overlapping_json,
                ts,
            ],
        )
        .map_err(|e| format!("Failed to add to merge queue: {e}"))?;
        Self::get_merge_entry(&id)
    }

    /// List merge-review queue entries for a session.
    pub fn list_merge_queue(session_id: &str) -> DbResult<Vec<MergeReviewEntry>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, run_id, plan_id, session_id, status, collision_review_required,
                 overlapping_plans, reviewed_at, created_at
                 FROM plan_merge_queue WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], Self::map_merge_entry)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Review a merge queue entry: approve or reject.
    pub fn review_merge_entry(entry_id: &str, decision: &str) -> DbResult<MergeReviewEntry> {
        if !VALID_MERGE_DECISIONS.contains(&decision) {
            return Err(format!("Invalid merge decision: '{decision}'"));
        }
        let existing = Self::get_merge_entry(entry_id)?;
        // Reject transitions from terminal states.
        if existing.status == "merged" {
            return Err("Cannot review an already-merged entry".to_string());
        }
        if existing.status == decision {
            return Err(format!("Entry is already '{decision}'"));
        }
        let conn = StorageService::connect()?;
        let ts = now();
        conn.execute(
            "UPDATE plan_merge_queue SET status = ?1, reviewed_at = ?2 WHERE id = ?3",
            params![decision, ts, entry_id],
        )
        .map_err(|e| format!("Failed to review merge entry: {e}"))?;
        Self::get_merge_entry(entry_id)
    }

    fn get_merge_entry(entry_id: &str) -> DbResult<MergeReviewEntry> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, run_id, plan_id, session_id, status, collision_review_required,
             overlapping_plans, reviewed_at, created_at
             FROM plan_merge_queue WHERE id = ?1",
            params![entry_id],
            Self::map_merge_entry,
        )
        .map_err(|e| e.to_string())
    }

    fn map_merge_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MergeReviewEntry> {
        let collision_review: i32 = row.get(5)?;
        let overlapping_json: String = row.get(6)?;
        Ok(MergeReviewEntry {
            id: row.get(0)?,
            run_id: row.get(1)?,
            plan_id: row.get(2)?,
            session_id: row.get(3)?,
            status: row.get(4)?,
            collision_review_required: collision_review != 0,
            overlapping_plans: serde_json::from_str(&overlapping_json).unwrap_or_default(),
            reviewed_at: row.get(7)?,
            created_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::plan::{NewPlan, PlanStatus};
    use crate::services::session_service::SessionService;
    use crate::test_util::test::isolated_home;

    fn make_session(project_path: &str) -> String {
        let session = SessionService::create_session(project_path, "test")
            .expect("create session");
        session.id
    }

    fn make_plan(session_id: &str, title: &str, status: PlanStatus) -> String {
        let plan = PlanService::create(
            session_id,
            &NewPlan {
                title: title.to_string(),
                description: "test plan".to_string(),
                goal: None,
                status,
                priority: Some(50),
                tags: vec![],
                idea_id: None,
            },
        )
        .expect("create plan");
        plan.id
    }

    #[test]
    fn test_set_and_get_dependencies() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_id = make_plan(&session_id, "Plan A", PlanStatus::Ready);

        let req = SetDependenciesRequest {
            plan_id: plan_id.clone(),
            prerequisites: vec!["plan-b".to_string()],
            affected_paths: vec!["src/main.rs".to_string()],
            priority: Some(80),
            scheduling_mode: Some("yolo".to_string()),
            workspace_policy: Some("sequential_primary".to_string()),
        };
        let updated = PlanDependencyService::set_dependencies(&req).expect("set deps");
        assert_eq!(updated.priority, 80);

        let deps = PlanDependencyService::get_dependencies(&plan_id).expect("get deps");
        assert_eq!(deps.prerequisites, vec!["plan-b"]);
        assert_eq!(deps.affected_paths, vec!["src/main.rs"]);
        assert_eq!(deps.scheduling_mode, "yolo");
        assert_eq!(deps.workspace_policy, "sequential_primary");
    }

    #[test]
    fn test_dependency_graph_ready_plan() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let _plan_a = make_plan(&session_id, "Plan A", PlanStatus::Ready);

        let graph = PlanDependencyService::build_graph(&session_id).expect("build graph");
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.nodes[0].readiness, "ready");
        assert!(graph.nodes[0].dispatchable);
        assert!(graph.cycles.is_empty());
    }

    #[test]
    fn test_dependency_graph_blocked_by_prerequisite() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_a = make_plan(&session_id, "Plan A", PlanStatus::Ready);
        let plan_b = make_plan(&session_id, "Plan B", PlanStatus::Ready);

        // B depends on A, A is not finished → B is blocked.
        PlanDependencyService::set_dependencies(&SetDependenciesRequest {
            plan_id: plan_b.clone(),
            prerequisites: vec![plan_a.clone()],
            affected_paths: vec![],
            priority: None,
            scheduling_mode: None,
            workspace_policy: None,
        })
        .expect("set deps");

        let graph = PlanDependencyService::build_graph(&session_id).expect("build graph");
        let node_b = graph.nodes.iter().find(|n| n.plan_id == plan_b).expect("node b");
        assert_eq!(node_b.readiness, "blocked");
        assert!(!node_b.dispatchable);
        assert!(node_b.block_reason.as_ref().unwrap().contains("prerequisites"));
    }

    #[test]
    fn test_dependency_graph_collision_detection() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_a = make_plan(&session_id, "Plan A", PlanStatus::Ready);
        let plan_b = make_plan(&session_id, "Plan B", PlanStatus::Ready);

        // Both plans affect the same file.
        for pid in [&plan_a, &plan_b] {
            PlanDependencyService::set_dependencies(&SetDependenciesRequest {
                plan_id: pid.clone(),
                prerequisites: vec![],
                affected_paths: vec!["src/main.rs".to_string()],
                priority: None,
                scheduling_mode: None,
                workspace_policy: None,
            })
            .expect("set deps");
        }

        let graph = PlanDependencyService::build_graph(&session_id).expect("build graph");
        let node_a = graph.nodes.iter().find(|n| n.plan_id == plan_a).expect("node a");
        assert!(node_a.collisions.contains(&plan_b));
    }

    #[test]
    fn test_dependency_graph_cycle_detection() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_a = make_plan(&session_id, "Plan A", PlanStatus::Ready);
        let plan_b = make_plan(&session_id, "Plan B", PlanStatus::Ready);

        // A → B → A cycle.
        PlanDependencyService::set_dependencies(&SetDependenciesRequest {
            plan_id: plan_a.clone(),
            prerequisites: vec![plan_b.clone()],
            affected_paths: vec![],
            priority: None,
            scheduling_mode: None,
            workspace_policy: None,
        })
        .expect("set deps");
        PlanDependencyService::set_dependencies(&SetDependenciesRequest {
            plan_id: plan_b.clone(),
            prerequisites: vec![plan_a.clone()],
            affected_paths: vec![],
            priority: None,
            scheduling_mode: None,
            workspace_policy: None,
        })
        .expect("set deps");

        let graph = PlanDependencyService::build_graph(&session_id).expect("build graph");
        assert!(!graph.cycles.is_empty());
    }

    #[test]
    fn test_file_claims_claim_and_release() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_id = make_plan(&session_id, "Plan A", PlanStatus::Running);

        PlanDependencyService::set_file_claims(
            "run-1",
            &plan_id,
            &session_id,
            &["src/a.rs".to_string(), "src/b.rs".to_string()],
            "claim",
        )
        .expect("claim");

        let claims = PlanDependencyService::list_file_claims(&session_id).expect("list claims");
        assert_eq!(claims.len(), 2);
        assert!(claims.iter().all(|c| c.released_at.is_none()));

        PlanDependencyService::set_file_claims(
            "run-1",
            &plan_id,
            &session_id,
            &["src/a.rs".to_string()],
            "release",
        )
        .expect("release");

        let claims = PlanDependencyService::list_file_claims(&session_id).expect("list claims");
        let a_claim = claims.iter().find(|c| c.path == "src/a.rs").expect("a claim");
        assert!(a_claim.released_at.is_some());
        let b_claim = claims.iter().find(|c| c.path == "src/b.rs").expect("b claim");
        assert!(b_claim.released_at.is_none());
    }

    #[test]
    fn test_coordination_event_publish_and_list() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_id = make_plan(&session_id, "Plan A", PlanStatus::Running);

        let event = PlanDependencyService::publish_event(
            &session_id,
            "run-1",
            &plan_id,
            "progress",
            r#"{"percent":50}"#,
        )
        .expect("publish");
        assert_eq!(event.kind, "progress");

        let events = PlanDependencyService::list_events(&session_id, None).expect("list events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "progress");
    }

    #[test]
    fn test_launch_profile_set_and_get() {
        let (_dir, _guard) = isolated_home();
        let profile = LaunchProfile {
            project_path: "/test/project".to_string(),
            engine: "openspec".to_string(),
            provider_id: "omp".to_string(),
            model_id: "glm-5".to_string(),
            effort_level: Some("high".to_string()),
            skill_id: Some("basebuild-project-schematic".to_string()),
            worker_count: 4,
            workspace_policy: "isolated_worktrees".to_string(),
            scheduling_mode: "safe".to_string(),
            updated_at: 0,
        };
        PlanDependencyService::set_launch_profile(&profile).expect("set profile");

        let got = PlanDependencyService::get_launch_profile("/test/project")
            .expect("get profile")
            .expect("profile exists");
        assert_eq!(got.worker_count, 4);
        assert_eq!(got.engine, "openspec");
        assert_eq!(got.workspace_policy, "isolated_worktrees");
    }

    #[test]
    fn test_merge_queue_add_list_and_review() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_id = make_plan(&session_id, "Plan A", PlanStatus::Finished);

        let entry = PlanDependencyService::add_to_merge_queue(
            "run-1",
            &plan_id,
            &session_id,
            true,
            &["plan-b".to_string()],
        )
        .expect("add to merge queue");
        assert_eq!(entry.status, "pending");
        assert!(entry.collision_review_required);

        let queue = PlanDependencyService::list_merge_queue(&session_id).expect("list queue");
        assert_eq!(queue.len(), 1);

        let reviewed = PlanDependencyService::review_merge_entry(&entry.id, "approved")
            .expect("review");
        assert_eq!(reviewed.status, "approved");
        assert!(reviewed.reviewed_at.is_some());
    }

    #[test]
    fn test_validate_readiness_ready_plan() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_id = make_plan(&session_id, "Plan A", PlanStatus::Ready);

        let result = PlanDependencyService::validate_readiness(&plan_id).expect("validate");
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_readiness_blocked_by_unfinished_prerequisite() {
        let (_dir, _guard) = isolated_home();
        let session_id = make_session("/test/project");
        let plan_a = make_plan(&session_id, "Plan A", PlanStatus::Ready);
        let plan_b = make_plan(&session_id, "Plan B", PlanStatus::Ready);

        PlanDependencyService::set_dependencies(&SetDependenciesRequest {
            plan_id: plan_b.clone(),
            prerequisites: vec![plan_a.clone()],
            affected_paths: vec![],
            priority: None,
            scheduling_mode: None,
            workspace_policy: None,
        })
        .expect("set deps");

        let result = PlanDependencyService::validate_readiness(&plan_b).expect("validate");
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("Prerequisite")));
    }
}

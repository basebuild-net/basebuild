use serde::{Deserialize, Serialize};

/// Per-plan dependency metadata: prerequisites, declared affected paths,
/// priority, and scheduling mode. Stored as additive columns on the plans
/// table (prerequisites/affected_paths as JSON arrays).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanDependencies {
    pub plan_id: String,
    /// Plan IDs that must reach `finished` before this plan can dispatch.
    #[serde(default)]
    pub prerequisites: Vec<String>,
    /// Declared file paths this plan expects to modify. Used for overlap
    /// inference and collision detection.
    #[serde(default)]
    pub affected_paths: Vec<String>,
    /// Higher number = higher priority. Default 50.
    #[serde(default)]
    pub priority: u8,
    /// `"safe"` (default) or `"yolo"`. YOLO allows conflicting plans to run
    /// after explicit confirmation, but marks them for mandatory merge review.
    #[serde(default = "default_scheduling_mode")]
    pub scheduling_mode: String,
    /// Workspace policy: `"isolated_worktrees"` or `"sequential_primary"`.
    #[serde(default = "default_workspace_policy")]
    pub workspace_policy: String,
}

fn default_scheduling_mode() -> String {
    "safe".to_string()
}

fn default_workspace_policy() -> String {
    "isolated_worktrees".to_string()
}

/// Node in the dependency graph: a plan with its readiness state and
/// collision info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyNode {
    pub plan_id: String,
    pub reference_id: String,
    pub title: String,
    pub status: String,
    pub priority: u8,
    pub prerequisites: Vec<String>,
    pub affected_paths: Vec<String>,
    /// `"ready"`, `"blocked"`, `"running"`, `"finished"`, `"cancelled"`.
    pub readiness: String,
    /// Human-readable reason if blocked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_reason: Option<String>,
    /// Plan IDs that overlap on affected paths.
    #[serde(default)]
    pub collisions: Vec<String>,
    /// Whether this plan is currently dispatchable under safe scheduling.
    pub dispatchable: bool,
    /// Whether YOLO override was confirmed for this plan.
    #[serde(default)]
    pub yolo_confirmed: bool,
}

/// The full dependency graph for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyGraph {
    pub session_id: String,
    pub nodes: Vec<DependencyNode>,
    /// Cycles detected as lists of plan IDs forming a cycle.
    #[serde(default)]
    pub cycles: Vec<Vec<String>>,
}

/// Result of validating a plan's readiness for dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub plan_id: String,
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// A file claim published by a running worker. Claims are append-only;
/// releases set `released_at`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileClaim {
    pub id: String,
    pub run_id: String,
    pub plan_id: String,
    pub session_id: String,
    pub path: String,
    /// `"claim"` or `"release"`.
    pub action: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub released_at: Option<i64>,
}

/// Coordination event published to the append-only ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationEvent {
    pub id: String,
    pub session_id: String,
    pub run_id: String,
    pub plan_id: String,
    /// `"progress"`, `"blocker"`, `"claim"`, `"release"`, `"artifact"`, `"completion"`.
    pub kind: String,
    /// JSON payload with event-specific data.
    pub payload: String,
    pub created_at: i64,
}

/// Launch profile: engine, provider/model/effort, skill, worker count,
/// workspace policy, and scheduling mode. Saved per-project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProfile {
    pub project_path: String,
    /// `"openspec"` or `"native"`.
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    /// Number of parallel workers requested.
    #[serde(default = "default_worker_count")]
    pub worker_count: u32,
    /// `"isolated_worktrees"` or `"sequential_primary"`.
    #[serde(default = "default_workspace_policy")]
    pub workspace_policy: String,
    /// `"safe"` or `"yolo"`.
    #[serde(default = "default_scheduling_mode")]
    pub scheduling_mode: String,
    pub updated_at: i64,
}

fn default_engine() -> String {
    "openspec".to_string()
}

fn default_worker_count() -> u32 {
    1
}

/// Merge-review queue entry: a completed run awaiting review/integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReviewEntry {
    pub id: String,
    pub run_id: String,
    pub plan_id: String,
    pub session_id: String,
    /// `"pending"`, `"approved"`, `"rejected"`, `"merged"`.
    pub status: String,
    /// Whether YOLO collision review is required.
    #[serde(default)]
    pub collision_review_required: bool,
    /// Overlapping plan IDs that need review.
    #[serde(default)]
    pub overlapping_plans: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewed_at: Option<i64>,
    pub created_at: i64,
}

/// Request to set dependencies on a plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDependenciesRequest {
    pub plan_id: String,
    #[serde(default)]
    pub prerequisites: Vec<String>,
    #[serde(default)]
    pub affected_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduling_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_policy: Option<String>,
}

/// Request to publish a coordination event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishEventRequest {
    pub session_id: String,
    pub run_id: String,
    pub plan_id: String,
    pub kind: String,
    #[serde(default)]
    pub payload: String,
}

/// Request to set file claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFileClaimRequest {
    pub run_id: String,
    pub plan_id: String,
    pub session_id: String,
    pub paths: Vec<String>,
    /// `"claim"` or `"release"`.
    pub action: String,
}

/// Request to assign a plan with a launch profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignWithProfileRequest {
    pub plan_id: String,
    pub chat_session_id: String,
    pub profile: LaunchProfile,
}

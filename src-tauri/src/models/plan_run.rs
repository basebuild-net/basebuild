use serde::{Deserialize, Serialize};

/// A queued plan entry: links a plan to a session's queue with an ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanQueueEntry {
    pub id: String,
    pub session_id: String,
    pub plan_id: String,
    pub sort_order: i64,
    pub created_at: i64,
}

/// Execution profile: `N × provider/model[/effort]`. Drives the tokio
/// semaphore size for parallel plan runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionProfile {
    /// Concurrency (number of parallel runs). Default 1.
    pub concurrency: u32,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
}

/// A plan run: one execution attempt of a plan through the native harness
/// or OMP runner. Linked to a plan and (for native runs) a chat session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRun {
    pub id: String,
    pub plan_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub status: PlanRunStatus,
    pub runner_kind: RunnerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps_output: Vec<PlanRunStepOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanRunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Paused,
}

impl PlanRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanRunStatus::Pending => "pending",
            PlanRunStatus::Running => "running",
            PlanRunStatus::Succeeded => "succeeded",
            PlanRunStatus::Failed => "failed",
            PlanRunStatus::Cancelled => "cancelled",
            PlanRunStatus::Paused => "paused",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => PlanRunStatus::Running,
            "succeeded" => PlanRunStatus::Succeeded,
            "failed" => PlanRunStatus::Failed,
            "cancelled" => PlanRunStatus::Cancelled,
            "paused" => PlanRunStatus::Paused,
            _ => PlanRunStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunnerKind {
    Native,
    Omp,
}

impl RunnerKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunnerKind::Native => "native",
            RunnerKind::Omp => "omp",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "omp" => RunnerKind::Omp,
            _ => RunnerKind::Native,
        }
    }
}

/// Per-step output from a final-touches step (populated by phase 8).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRunStepOutput {
    pub step_id: String,
    pub kind: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Request to enqueue a plan into a session's queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueuePlanRequest {
    pub session_id: String,
    pub plan_id: String,
}

/// Request to start the queue: resolves the execution profile and begins
/// dispatching runs up to the concurrency limit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQueueRequest {
    pub session_id: String,
    pub profile: ExecutionProfile,
    /// Optional per-run plan override; if present, overrides the profile's
    /// provider/model for this specific plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_overrides: Option<Vec<PlanOverride>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanOverride {
    pub plan_id: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
}

/// Event payload emitted on the `plan_run://` channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRunEvent {
    pub run_id: String,
    pub session_id: String,
    pub plan_id: String,
    pub status: PlanRunStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Openspec,
    Ready,
    Running,
    Finished,
    Cancelled,
}

impl PlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanStatus::Draft => "draft",
            PlanStatus::Openspec => "openspec",
            PlanStatus::Ready => "ready",
            PlanStatus::Running => "running",
            PlanStatus::Finished => "finished",
            PlanStatus::Cancelled => "cancelled",
        }
    }

    /// Parse a plan status string. Lenient for one release: accepts the legacy
    /// values `waiting` and `in_progress` (mapped to `Ready`/`Running`) so
    /// downgraders and stale callers do not crash. Unknown strings fall back
    /// to `Draft`, matching the previous behavior.
    pub fn from_str(s: &str) -> Self {
        match s {
            "openspec" => PlanStatus::Openspec,
            "ready" | "waiting" => PlanStatus::Ready,
            "running" | "in_progress" => PlanStatus::Running,
            "finished" => PlanStatus::Finished,
            "cancelled" => PlanStatus::Cancelled,
            _ => PlanStatus::Draft,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub session_id: String,
    pub reference_id: String,
    pub title: String,
    pub description: String,
    pub goal: Option<String>,
    pub status: PlanStatus,
    pub priority: u8,
    pub tags: Vec<String>,
    pub ai_enhanced: bool,
    pub context: Option<PlanFocusContext>,
    /// Linked idea id when this plan was promoted from an idea. Null for
    /// manually-created plans. Idea progress is derived at read time from
    /// this plan, never mirrored onto the idea row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idea_id: Option<String>,
    /// OpenSpec change name (kebab-case) once this plan has generated
    /// artifacts. Stored on the plan so the change path can be derived without
    /// parsing reference ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFocusContext {
    pub notes: String,
    pub files: Vec<String>,
    pub terminal_output_tail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPlan {
    pub title: String,
    pub description: String,
    pub goal: Option<String>,
    pub status: PlanStatus,
    pub priority: Option<u8>,
    pub tags: Vec<String>,
    /// Optional idea linkage when promoting an idea into a draft plan.
    #[serde(default)]
    pub idea_id: Option<String>,
}

/// Result of a batch-promote operation: created plans and per-idea errors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPromoteResult {
    pub created: Vec<Plan>,
    pub errors: Vec<BatchPromoteError>,
}

/// A per-idea error in a batch-promote operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPromoteError {
    pub idea_id: String,
    pub error: String,
}

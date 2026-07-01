use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Openspec,
    Waiting,
    InProgress,
    Finished,
    Cancelled,
}

impl PlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanStatus::Draft => "draft",
            PlanStatus::Openspec => "openspec",
            PlanStatus::Waiting => "waiting",
            PlanStatus::InProgress => "in_progress",
            PlanStatus::Finished => "finished",
            PlanStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "openspec" => PlanStatus::Openspec,
            "waiting" => PlanStatus::Waiting,
            "in_progress" => PlanStatus::InProgress,
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
}

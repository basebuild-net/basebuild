use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaCategory {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    pub id: String,
    pub session_id: String,
    pub category_id: Option<String>,
    pub title: String,
    pub description: String,
    pub status: IdeaStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IdeaStatus {
    Concept,
    PlanReady,
    InProgress,
    Finished,
    Paused,
    Cancelled,
}

impl IdeaStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            IdeaStatus::Concept => "concept",
            IdeaStatus::PlanReady => "plan_ready",
            IdeaStatus::InProgress => "in_progress",
            IdeaStatus::Finished => "finished",
            IdeaStatus::Paused => "paused",
            IdeaStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "plan_ready" => IdeaStatus::PlanReady,
            "in_progress" => IdeaStatus::InProgress,
            "finished" => IdeaStatus::Finished,
            "paused" => IdeaStatus::Paused,
            "cancelled" => IdeaStatus::Cancelled,
            _ => IdeaStatus::Concept,
        }
    }
}

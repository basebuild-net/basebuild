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
#[serde(rename_all = "snake_case")]
pub enum IdeaStatus {
    Concept,
    Picked,
    Archived,
}

impl IdeaStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            IdeaStatus::Concept => "concept",
            IdeaStatus::Picked => "picked",
            IdeaStatus::Archived => "archived",
        }
    }

    /// Parse an idea status string. Lenient for one release: accepts the legacy
    // camelCase/snake_case values and collapses them into the new triad
    // (planReady/plan_ready/inProgress/in_progress/finished → picked;
    // paused/cancelled → archived; concept → concept). Unknown strings fall
    // back to `Concept`.
    pub fn from_str(s: &str) -> Self {
        match s {
            "picked" | "planReady" | "plan_ready" | "inProgress" | "in_progress" | "finished" => {
                IdeaStatus::Picked
            }
            "archived" | "paused" | "cancelled" => IdeaStatus::Archived,
            _ => IdeaStatus::Concept,
        }
    }
}

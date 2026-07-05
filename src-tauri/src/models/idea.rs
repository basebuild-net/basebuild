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
pub struct Idea {
    pub id: String,
    pub session_id: String,
    pub category_id: Option<String>,
    pub title: String,
    pub description: String,
    pub status: IdeaStatus,
    /// Concrete evidence (real files, functions, observed gaps) justifying the
    /// idea. Required by the capture tool; persisted for display and audit.
    pub grounding: String,
    /// Optional schematic element the idea serves (Vision / End goal / Current
    /// priority). When empty, the UI flags the idea "outside current focus".
    pub anchor: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdeaStatus {
    Concept,
    Picked,
    Rejected,
    Archived,
}
impl IdeaStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            IdeaStatus::Concept => "concept",
            IdeaStatus::Picked => "picked",
            IdeaStatus::Rejected => "rejected",
            IdeaStatus::Archived => "archived",
        }
    }

    /// Parse an idea status string. Lenient for one release: accepts the legacy
    // camelCase/snake_case values and collapses them into the current set
    // (planReady/plan_ready/inProgress/in_progress/finished → picked;
    // paused/cancelled → archived; concept → concept). Unknown strings fall
    // back to `Concept`.
    pub fn from_str(s: &str) -> Self {
        match s {
            "picked" | "planReady" | "plan_ready" | "inProgress" | "in_progress" | "finished" => {
                IdeaStatus::Picked
            }
            "rejected" => IdeaStatus::Rejected,
            "archived" | "paused" | "cancelled" => IdeaStatus::Archived,
            _ => IdeaStatus::Concept,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejected_round_trips() {
        assert_eq!(IdeaStatus::Rejected.as_str(), "rejected");
        assert_eq!(IdeaStatus::from_str("rejected"), IdeaStatus::Rejected);
    }

    #[test]
    fn unknown_falls_back_to_concept() {
        assert_eq!(IdeaStatus::from_str("nonsense"), IdeaStatus::Concept);
        assert_eq!(IdeaStatus::from_str(""), IdeaStatus::Concept);
    }

    #[test]
    fn legacy_values_collapse() {
        assert_eq!(IdeaStatus::from_str("planReady"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("in_progress"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("finished"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("paused"), IdeaStatus::Archived);
        assert_eq!(IdeaStatus::from_str("cancelled"), IdeaStatus::Archived);
    }
}

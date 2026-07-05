use serde::{Deserialize, Serialize};

/// Selection state of a plan proposal captured during a generate-plans run.
///
/// - `proposed`: returned by the model, awaiting user decision
/// - `accepted`: user accepted; linked `plan_id` becomes a draft plan
/// - `dismissed`: user explicitly rejected; persists across regenerations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalState {
    Proposed,
    Accepted,
    Dismissed,
}

impl ProposalState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "proposed" => Some(Self::Proposed),
            "accepted" => Some(Self::Accepted),
            "dismissed" => Some(Self::Dismissed),
            _ => None,
        }
    }
}

/// A structured plan proposal captured from a generate-plans run. Stored per
/// session + run; reloads with the session. Accepting creates a draft plan and
/// links `plan_id`. Dismissed proposals persist (append-only across runs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProposal {
    pub id: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub title: String,
    pub description: String,
    pub goal: String,
    pub suggested_change_name: String,
    pub state: String,
    pub plan_id: Option<String>,
    pub created_at: i64,
}

/// Payload for capturing a proposal from the agent loop's `propose_plans` tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProposalInput {
    pub session_id: String,
    pub run_id: Option<String>,
    pub title: String,
    pub description: String,
    pub goal: String,
    pub suggested_change_name: String,
}

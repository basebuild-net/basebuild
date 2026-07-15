use serde::{Deserialize, Serialize};

/// Kind of pipeline stage. Each maps to a distinct AI generation step in the
/// idea→plan lifecycle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStageKind {
    GenerateCategories,
    GenerateIdeas,
    EnhanceIdea,
    GenerateOpenspec,
}

impl PipelineStageKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineStageKind::GenerateCategories => "generate_categories",
            PipelineStageKind::GenerateIdeas => "generate_ideas",
            PipelineStageKind::EnhanceIdea => "enhance_idea",
            PipelineStageKind::GenerateOpenspec => "generate_openspec",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "generate_categories" => Some(PipelineStageKind::GenerateCategories),
            "generate_ideas" => Some(PipelineStageKind::GenerateIdeas),
            "enhance_idea" => Some(PipelineStageKind::EnhanceIdea),
            "generate_openspec" => Some(PipelineStageKind::GenerateOpenspec),
            _ => None,
        }
    }
}

/// Status of a pipeline stage run. Mirrors the lifecycle recorded in the
/// `pipeline_runs` table.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PipelineRunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl PipelineRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineRunStatus::Pending => "pending",
            PipelineRunStatus::Running => "running",
            PipelineRunStatus::Succeeded => "succeeded",
            PipelineRunStatus::Failed => "failed",
            PipelineRunStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => PipelineRunStatus::Running,
            "succeeded" => PipelineRunStatus::Succeeded,
            "failed" => PipelineRunStatus::Failed,
            "cancelled" => PipelineRunStatus::Cancelled,
            _ => PipelineRunStatus::Pending,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            PipelineRunStatus::Succeeded | PipelineRunStatus::Failed | PipelineRunStatus::Cancelled
        )
    }
}

/// A recorded pipeline stage run. Every AI stage (generate categories,
/// generate ideas, enhance idea, generate openspec) writes one of these rows
/// before executing and updates it on completion/failure/cancellation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRun {
    pub id: String,
    pub session_id: String,
    pub project_path: String,
    pub kind: String,
    pub idea_id: Option<String>,
    pub plan_id: Option<String>,
    pub input_summary: String,
    pub session_chat_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
    /// JSON array of output references (e.g. created idea ids, change path).
    pub output_refs: Vec<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    /// Provider the stage runs with (resolved from the project chat default).
    /// None for legacy rows and stages that fail before model resolution.
    pub provider_id: Option<String>,
    /// Model the stage runs with. None as above.
    pub model_id: Option<String>,
}

/// Request to start a pipeline stage. The `kind` field selects which stage
/// runs; other fields provide context the stage needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStartRequest {
    pub session_id: String,
    pub project_path: String,
    pub kind: String,
    pub idea_id: Option<String>,
    pub plan_id: Option<String>,
    /// Optional freeform input for the stage (e.g. a category hint for idea
    /// generation, or an idea description for enhancement).
    pub input: Option<String>,
    /// Optional chat session id to stream output into.
    pub chat_session_id: Option<String>,
}

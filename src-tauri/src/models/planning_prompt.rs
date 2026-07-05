use serde::{Deserialize, Serialize};

/// Keys for the editable planning system prompts. Stored as rows in
/// `planning_prompts`; absence means "use the compiled default".
pub const CHAT_SYSTEM: &str = "chat_system";
pub const IDEA_GENERATION: &str = "idea_generation";
pub const PLAN_GENERATION: &str = "plan_generation";
pub const CATEGORY_GENERATION: &str = "category_generation";

/// A planning prompt entry returned to the UI: the effective value (override
/// if saved, otherwise the compiled default), the compiled default, and whether
/// the user has saved an override.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningPromptEntry {
    pub key: String,
    pub value: String,
    pub default: String,
    pub is_modified: bool,
}

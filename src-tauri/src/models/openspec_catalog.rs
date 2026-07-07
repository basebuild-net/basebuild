use serde::{Deserialize, Serialize};

/// A single task line parsed from a `tasks.md` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredTask {
    /// 1-indexed line number in the source file (for toggle operations).
    pub line: u32,
    /// Whether the checkbox is currently checked.
    pub checked: bool,
    /// Optional task id (e.g. "1.1", "2.3") parsed from the line prefix.
    /// May be absent for tasks without explicit ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The task text (after the checkbox marker).
    pub text: String,
}

/// A phase (## heading) with its tasks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPhase {
    /// Phase name (the `## ` heading text).
    pub name: String,
    /// 1-indexed line number of the heading.
    pub line: u32,
    /// Tasks under this phase.
    pub tasks: Vec<StructuredTask>,
}

/// The full structured parse of a `tasks.md` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredTasks {
    pub phases: Vec<TaskPhase>,
    /// Total task count across all phases.
    pub total: u32,
    /// Completed task count across all phases.
    pub completed: u32,
}

/// A change directory entry in `openspec/changes/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCatalogEntry {
    /// The change directory name (kebab-case).
    pub name: String,
    /// Whether `proposal.md` exists.
    pub has_proposal: bool,
    /// Whether `design.md` exists.
    pub has_design: bool,
    /// Whether `tasks.md` exists.
    pub has_tasks: bool,
    /// Whether `specs/` directory exists and is non-empty.
    pub has_specs: bool,
    /// Completed/total task count from `tasks.md` (0/0 if absent).
    pub completed: u32,
    pub total: u32,
    /// The reference id of the linked plan, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_plan_reference_id: Option<String>,
    /// Whether the change is in the archive directory.
    pub archived: bool,
    /// Created timestamp from `.openspec.yaml` if parseable, else 0.
    pub created_at: i64,
}

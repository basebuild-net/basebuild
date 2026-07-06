use serde::{Deserialize, Serialize};

use crate::models::plan::PlanStatus;

/// A candidate external plan detected in the project (e.g. an unexecuted
/// OpenSpec change folder) that can be imported into a `.basebuild` plan
/// record. Detection only — no writes happen until the user confirms.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanImportCandidate {
    /// Change slug (kebab-case folder name under `openspec/changes/`).
    pub slug: String,
    /// Title parsed from the proposal's `# Proposal: <Title>` heading, or a
    /// fallback when the proposal is unparseable.
    pub title: String,
    /// Relative source path, e.g. `openspec/changes/<slug>/`.
    pub external: String,
    /// Detected engine — `openspec` for OpenSpec changes.
    pub engine: String,
    /// Derived status: `openspec`/`planned` when artifacts are complete;
    /// `running`/`finished` when `tasks.md` progress implies it.
    pub derived_status: PlanStatus,
    /// Parsed `tasks.md` progress. `(0, 0)` when no `tasks.md` is present.
    pub completed: u32,
    pub total: u32,
    /// Non-fatal detection warning (e.g. missing proposal title); the
    /// candidate is still offered but the warning is surfaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Result of importing a single candidate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanImportResult {
    pub slug: String,
    /// Path to the written `.basebuild/plans/<slug>/plan.md`, relative to
    /// the project root.
    pub plan_path: String,
    pub status: PlanStatus,
    /// Skipped (already linked) — no file written.
    pub skipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

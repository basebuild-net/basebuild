use crate::models::plan_import::{PlanImportCandidate, PlanImportResult};
use crate::services::plan_import_service;

/// Detect importable external plans in the project's `openspec/changes/`
/// directory. Returns candidates not already linked to a `.basebuild` plan
/// record. Does not modify anything on disk.
#[tauri::command]
pub fn plan_import_detect(project_path: String) -> Result<Vec<PlanImportCandidate>, String> {
    Ok(plan_import_service::detect_candidates(&project_path))
}

/// Import confirmed candidates by writing `.basebuild/plans/<slug>/plan.md`
/// records. Only candidates from the current detection pass are imported;
/// already-linked sources are skipped (idempotent). Each candidate is
/// imported independently — a failure on one does not abort the rest.
#[tauri::command]
pub fn plan_import_apply(
    project_path: String,
    slugs: Vec<String>,
) -> Result<Vec<PlanImportResult>, String> {
    Ok(plan_import_service::import_candidates(&project_path, &slugs))
}

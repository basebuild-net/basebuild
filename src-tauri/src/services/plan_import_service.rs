use std::fs;
use std::path::Path;

use crate::{
    models::plan::PlanStatus,
    models::plan_import::{PlanImportCandidate, PlanImportResult},
    services::openspec_service::{changes_dir, parse_task_progress},
};

/// Scan the project's `openspec/changes/` directory for change folders that
/// are not already linked to a `.basebuild` plan record, and return them as
/// import candidates. Never modifies anything on disk.
///
/// Dedupe key: the `external` path stored in existing `.basebuild/plans/*/plan.md`
/// frontmatter. A change folder already referenced by any plan record is skipped.
pub fn detect_candidates(project_path: &str) -> Vec<PlanImportCandidate> {
    let changes = changes_dir(project_path);
    let mut candidates = Vec::new();

    let entries = match fs::read_dir(&changes) {
        Ok(e) => e,
        Err(_) => return candidates, // no openspec/changes/ — nothing to import
    };

    let linked = linked_externals(project_path);

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip the archive directory — those are completed changes, not import
        // candidates.
        if slug == "archive" {
            continue;
        }

        let external = format!("openspec/changes/{slug}/");

        // Dedupe: skip change folders already linked to a .basebuild plan.
        if linked.iter().any(|l| l == &external) {
            continue;
        }

        let candidate = build_candidate(&path, &slug, &external);
        candidates.push(candidate);
    }

    candidates
}

/// Import a list of confirmed candidates by writing `.basebuild/plans/<slug>/plan.md`
/// records per the planning-file-schema. Idempotent: candidates already linked
/// (re-checked here) are skipped without error. Returns one result per candidate.
pub fn import_candidates(project_path: &str, slugs: &[String]) -> Vec<PlanImportResult> {
    let candidates = detect_candidates(project_path);
    let wanted: std::collections::HashSet<&str> = slugs.iter().map(|s| s.as_str()).collect();
    let mut results = Vec::new();

    for candidate in candidates {
        if !wanted.contains(candidate.slug.as_str()) {
            continue;
        }
        let result = import_one(project_path, &candidate);
        results.push(result);
    }
    results
}

fn build_candidate(change_path: &Path, slug: &str, external: &str) -> PlanImportCandidate {
    let proposal_path = change_path.join("proposal.md");
    let tasks_path = change_path.join("tasks.md");

    // Parse title from `# Proposal: <Title>` heading. Fall back to the slug
    // when the proposal is missing or unparseable, with a warning.
    let (title, title_warning) = match fs::read_to_string(&proposal_path) {
        Ok(content) => match parse_proposal_title(&content) {
            Some(t) => (t, None),
            None => (
                slug.to_string(),
                Some("Could not parse proposal title; used slug as fallback".to_string()),
            ),
        },
        Err(_) => (
            slug.to_string(),
            Some("Missing proposal.md; used slug as fallback".to_string()),
        ),
    };

    // Parse task progress to derive status.
    let (completed, total) = match fs::read_to_string(&tasks_path) {
        Ok(content) => parse_task_progress(&content),
        Err(_) => (0, 0),
    };

    let derived_status = derive_status(completed, total);

    PlanImportCandidate {
        slug: slug.to_string(),
        title,
        external: external.to_string(),
        engine: "openspec".to_string(),
        derived_status,
        completed,
        total,
        warning: title_warning,
    }
}

/// Derive a plan status conservatively from task progress:
/// - No tasks → `openspec` (artifacts complete, not yet started).
/// - Some tasks done, but not all → `running`.
/// - All tasks done → `finished`.
///
/// Note: this maps to the current app status vocabulary. When `plan-status-rename`
/// lands, `openspec` here becomes `planned`.
fn derive_status(completed: u32, total: u32) -> PlanStatus {
    if total == 0 {
        return PlanStatus::Openspec;
    }
    if completed == 0 {
        return PlanStatus::Openspec;
    }
    if completed >= total {
        return PlanStatus::Finished;
    }
    PlanStatus::Running
}

/// Parse the title from a proposal's first `# Proposal: <Title>` heading.
fn parse_proposal_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# Proposal:") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

/// Write a single `.basebuild/plans/<slug>/plan.md` record for an imported
/// candidate. Per planning-file-schema: YAML frontmatter with `title`,
/// `status`, `created`, `ideas` (empty), `engine`, and `external`. No
/// `tasks.md` — the external engine owns its own task list.
fn import_one(project_path: &str, candidate: &PlanImportCandidate) -> PlanImportResult {
    let plans_dir = Path::new(project_path)
        .join(".basebuild")
        .join("plans")
        .join(&candidate.slug);

    // Idempotent guard: if the record already exists, skip without overwriting.
    let plan_md = plans_dir.join("plan.md");
    if plan_md.exists() {
        return PlanImportResult {
            slug: candidate.slug.clone(),
            plan_path: format!(".basebuild/plans/{}/plan.md", candidate.slug),
            status: candidate.derived_status,
            skipped: true,
            warning: Some("Already imported — skipped".to_string()),
        };
    }

    // Ensure the plans directory exists.
    if let Err(e) = fs::create_dir_all(&plans_dir) {
        return PlanImportResult {
            slug: candidate.slug.clone(),
            plan_path: String::new(),
            status: candidate.derived_status,
            skipped: true,
            warning: Some(format!("Failed to create plan directory: {e}")),
        };
    }

    let created = current_date();
    let content = format_plan_md(candidate, &created);

    if let Err(e) = fs::write(&plan_md, &content) {
        return PlanImportResult {
            slug: candidate.slug.clone(),
            plan_path: String::new(),
            status: candidate.derived_status,
            skipped: true,
            warning: Some(format!("Failed to write plan.md: {e}")),
        };
    }

    PlanImportResult {
        slug: candidate.slug.clone(),
        plan_path: format!(".basebuild/plans/{}/plan.md", candidate.slug),
        status: candidate.derived_status,
        skipped: false,
        warning: candidate.warning.clone(),
    }
}

/// Format the `plan.md` content per planning-file-schema: YAML frontmatter
/// with `title`, `status`, `created`, `ideas`, `engine`, `external`; followed
/// by a body section pointing at the external artifacts.
fn format_plan_md(candidate: &PlanImportCandidate, created: &str) -> String {
    let ideas = if candidate.slug.is_empty() {
        "[]".to_string()
    } else {
        "[]".to_string()
    };
    format!(
        "---\ntitle: {title}\nstatus: {status}\ncreated: {created}\nideas: {ideas}\nengine: {engine}\nexternal: {external}\n---\n\n# {title}\n\nImported from `{external}`.\n\nThe external engine owns the task list and design artifacts. See the linked change directory for details.\n",
        title = candidate.title,
        status = candidate.derived_status.as_str(),
        created = created,
        engine = candidate.engine,
        external = candidate.external,
    )
}

/// Collect all `external` paths from existing `.basebuild/plans/*/plan.md`
/// frontmatter, so detection can skip already-linked sources.
fn linked_externals(project_path: &str) -> Vec<String> {
    let plans_dir = Path::new(project_path).join(".basebuild").join("plans");
    let mut externals = Vec::new();

    let entries = match fs::read_dir(&plans_dir) {
        Ok(e) => e,
        Err(_) => return externals,
    };

    for entry in entries.flatten() {
        let plan_md = entry.path().join("plan.md");
        if let Ok(content) = fs::read_to_string(&plan_md) {
            if let Some(ext) = parse_frontmatter_field(&content, "external") {
                externals.push(ext);
            }
        }
    }
    externals
}

/// Parse a top-level YAML frontmatter field value (simple `key: value` only).
/// Returns the trimmed value. This is a minimal parser sufficient for the
/// `external` field — it does not handle nested structures.
fn parse_frontmatter_field(content: &str, key: &str) -> Option<String> {
    let lines = content.lines();
    let mut in_frontmatter = false;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            in_frontmatter = !in_frontmatter;
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix(&format!("{key}:")) {
            let value = rest.trim();
            // Strip surrounding quotes if present.
            let value = value.trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn current_date() -> String {
    // Use a simple ISO date. Avoids pulling in chrono for one string.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default();
    days_to_iso_date(secs / 86400)
}

/// Convert a day count (since 1970-01-01) to a `YYYY-MM-DD` string.
/// Algorithm: Howard Hinnant's civil_from_days.
fn days_to_iso_date(days: i64) -> String {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_change_dir(project: &Path, slug: &str, proposal: Option<&str>, tasks: Option<&str>) {
        let dir = project.join("openspec").join("changes").join(slug);
        fs::create_dir_all(&dir).unwrap();
        if let Some(p) = proposal {
            fs::write(dir.join("proposal.md"), p).unwrap();
        }
        if let Some(t) = tasks {
            fs::write(dir.join("tasks.md"), t).unwrap();
        }
    }

    fn make_linked_plan(project: &Path, slug: &str, external: &str) {
        let dir = project.join(".basebuild").join("plans").join(slug);
        fs::create_dir_all(&dir).unwrap();
        let content = format!(
            "---\ntitle: Test\nstatus: openspec\ncreated: 2026-01-01\nideas: []\nengine: openspec\nexternal: {external}\n---\n\n# Test\n",
        );
        fs::write(dir.join("plan.md"), content).unwrap();
    }

    #[test]
    fn parse_proposal_title_extracts_first_heading() {
        let content = "# Proposal: My Great Plan\n\n## Why\n...";
        assert_eq!(parse_proposal_title(content), Some("My Great Plan".to_string()));
    }

    #[test]
    fn parse_proposal_title_returns_none_when_missing() {
        assert!(parse_proposal_title("# Not a proposal\n").is_none());
        assert!(parse_proposal_title("").is_none());
    }

    #[test]
    fn derive_status_no_tasks_is_openspec() {
        assert_eq!(derive_status(0, 0), PlanStatus::Openspec);
    }

    #[test]
    fn derive_status_all_done_is_finished() {
        assert_eq!(derive_status(5, 5), PlanStatus::Finished);
    }

    #[test]
    fn derive_status_in_progress_is_running() {
        assert_eq!(derive_status(2, 5), PlanStatus::Running);
    }

    #[test]
    fn derive_status_zero_done_is_openspec() {
        assert_eq!(derive_status(0, 5), PlanStatus::Openspec);
    }

    #[test]
    fn detect_candidates_finds_unlinked_changes() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-detect-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        make_change_dir(
            &tmp,
            "add-dark-mode",
            Some("# Proposal: Add Dark Mode\n"),
            Some("# Tasks\n- [ ] 1.1 Task\n- [x] 1.2 Task\n"),
        );

        let candidates = detect_candidates(&tmp.to_string_lossy());
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].slug, "add-dark-mode");
        assert_eq!(candidates[0].title, "Add Dark Mode");
        assert_eq!(candidates[0].engine, "openspec");
        assert_eq!(candidates[0].external, "openspec/changes/add-dark-mode/");
        assert_eq!(candidates[0].completed, 1);
        assert_eq!(candidates[0].total, 2);
        assert_eq!(candidates[0].derived_status, PlanStatus::Running);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_candidates_skips_already_linked() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-linked-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        make_change_dir(
            &tmp,
            "add-dark-mode",
            Some("# Proposal: Add Dark Mode\n"),
            Some("# Tasks\n- [ ] 1.1 Task\n"),
        );
        make_linked_plan(&tmp, "add-dark-mode", "openspec/changes/add-dark-mode/");

        let candidates = detect_candidates(&tmp.to_string_lossy());
        assert_eq!(candidates.len(), 0, "already-linked change should be skipped");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_candidates_skips_archive_dir() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-archive-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        // archive dir has subfolders but should be skipped entirely
        let archive = tmp.join("openspec").join("changes").join("archive");
        fs::create_dir_all(&archive.join("old-change")).unwrap();
        make_change_dir(
            &tmp,
            "real-change",
            Some("# Proposal: Real Change\n"),
            None,
        );

        let candidates = detect_candidates(&tmp.to_string_lossy());
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].slug, "real-change");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_candidates_handles_missing_proposal() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-noprop-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        // Change dir with no proposal.md — should still appear with a warning.
        make_change_dir(&tmp, "no-proposal", None, None);

        let candidates = detect_candidates(&tmp.to_string_lossy());
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].slug, "no-proposal");
        assert_eq!(candidates[0].title, "no-proposal"); // fell back to slug
        assert!(candidates[0].warning.is_some());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_candidates_empty_when_no_changes_dir() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-empty-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        let candidates = detect_candidates(&tmp.to_string_lossy());
        assert!(candidates.is_empty());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn import_candidates_writes_plan_md() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-write-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        make_change_dir(
            &tmp,
            "add-dark-mode",
            Some("# Proposal: Add Dark Mode\n"),
            Some("# Tasks\n- [ ] 1.1 Task\n"),
        );

        let results = import_candidates(
            &tmp.to_string_lossy(),
            &["add-dark-mode".to_string()],
        );
        assert_eq!(results.len(), 1);
        assert!(!results[0].skipped, "should not be skipped");
        assert_eq!(results[0].slug, "add-dark-mode");
        assert_eq!(
            results[0].plan_path,
            ".basebuild/plans/add-dark-mode/plan.md"
        );

        // Verify the file exists and has the right frontmatter.
        let plan_md = tmp
            .join(".basebuild")
            .join("plans")
            .join("add-dark-mode")
            .join("plan.md");
        assert!(plan_md.exists(), "plan.md should exist");

        let content = fs::read_to_string(&plan_md).unwrap();
        assert!(content.contains("title: Add Dark Mode"));
        assert!(content.contains("engine: openspec"));
        assert!(content.contains("external: openspec/changes/add-dark-mode/"));
        assert!(!content.contains("tasks.md")); // no duplicate task list reference

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn import_candidates_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-plan-import-idempotent-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        make_change_dir(
            &tmp,
            "add-dark-mode",
            Some("# Proposal: Add Dark Mode\n"),
            Some("# Tasks\n- [ ] 1.1 Task\n"),
        );

        let slugs = vec!["add-dark-mode".to_string()];

        // First import: writes.
        let results1 = import_candidates(&tmp.to_string_lossy(), &slugs);
        assert_eq!(results1.len(), 1);
        assert!(!results1[0].skipped);

        // Second import: skipped (already linked — detect_candidates excludes it).
        let results2 = import_candidates(&tmp.to_string_lossy(), &slugs);
        assert_eq!(results2.len(), 0, "re-import should find no candidates");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn parse_frontmatter_field_extracts_value() {
        let content = "---\ntitle: Test\nexternal: openspec/changes/foo/\n---\n\n# Test\n";
        assert_eq!(
            parse_frontmatter_field(content, "external"),
            Some("openspec/changes/foo/".to_string())
        );
    }

    #[test]
    fn parse_frontmatter_field_returns_none_when_missing() {
        let content = "---\ntitle: Test\n---\n\n# Test\n";
        assert!(parse_frontmatter_field(content, "external").is_none());
    }

    #[test]
    fn days_to_iso_date_known_value() {
        // 1970-01-01 is day 0.
        assert_eq!(days_to_iso_date(0), "1970-01-01");
        // 2026-01-01 is 20454 days after 1970-01-01.
        assert_eq!(days_to_iso_date(20454), "2026-01-01");
    }
}

use std::path::{Path, PathBuf};

use rusqlite::params;

use crate::{models::plan::Plan, services::storage_service::StorageService};

type DbResult<T> = Result<T, String>;

/// Derive a kebab-case change name from a plan title. Falls back to
/// "untitled-change" for empty/whitespace-only titles.
pub fn derive_change_name(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return "untitled-change".to_string();
    }
    let kebab: String = trimmed
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else if c == ' ' || c == '_' || c == '-' {
                '-'
            } else {
                '\0'
            }
        })
        .collect::<String>()
        .replace('\0', "");
    // Collapse multiple dashes and trim leading/trailing dashes.
    let collapsed = kebab
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if collapsed.is_empty() {
        "untitled-change".to_string()
    } else {
        collapsed
    }
}

/// Resolve a unique change name for a plan, appending a numeric suffix (-2,
/// -3, …) if the derived name already exists in the project's
/// `openspec/changes/` directory.
pub fn resolve_unique_change_name(project_path: &str, title: &str) -> String {
    let base = derive_change_name(title);
    let changes_dir = changes_dir(project_path);
    if !changes_dir.exists() {
        return base;
    }
    let mut candidate = base.clone();
    let mut suffix = 2u32;
    while changes_dir.join(&candidate).exists() {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

/// The `openspec/changes/` directory for a project.
fn changes_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join("openspec").join("changes")
}

/// The change directory for a specific change name.
pub fn change_dir(project_path: &str, change_name: &str) -> PathBuf {
    changes_dir(project_path).join(change_name)
}

/// Write OpenSpec artifacts atomically. Writes all files to a temp directory
/// first, then renames it to the final location. This ensures no partial
/// change directory is left if a write fails midway.
///
/// Files: `proposal.md`, `specs/<capability>/spec.md`, `design.md`,
/// `tasks.md`, `.openspec.yaml`.
pub fn write_artifacts_atomic(
    project_path: &str,
    change_name: &str,
    proposal: &str,
    specs: &[(String, String)], // (capability, spec_content)
    design: Option<&str>,
    tasks: &str,
) -> Result<PathBuf, String> {
    let final_dir = change_dir(project_path, change_name);
    let parent = final_dir
        .parent()
        .ok_or_else(|| "Cannot resolve changes directory".to_string())?;

    // Create the parent changes/ dir if it doesn't exist.
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create changes directory: {e}"))?;

    // Write to a temp directory first, then rename — atomic on the same
    // filesystem.
    let temp_dir = parent.join(format!(".{change_name}.tmp"));
    // Clean up any stale temp dir from a previous failed attempt.
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    // Write proposal.md
    std::fs::write(temp_dir.join("proposal.md"), proposal)
        .map_err(|e| format!("Failed to write proposal.md: {e}"))?;

    // Write specs/<capability>/spec.md
    for (capability, content) in specs {
        let spec_dir = temp_dir.join("specs").join(capability);
        std::fs::create_dir_all(&spec_dir)
            .map_err(|e| format!("Failed to create spec dir for {capability}: {e}"))?;
        std::fs::write(spec_dir.join("spec.md"), content)
            .map_err(|e| format!("Failed to write spec.md for {capability}: {e}"))?;
    }

    // Write design.md (optional)
    if let Some(design_content) = design {
        std::fs::write(temp_dir.join("design.md"), design_content)
            .map_err(|e| format!("Failed to write design.md: {e}"))?;
    }

    // Write tasks.md
    std::fs::write(temp_dir.join("tasks.md"), tasks)
        .map_err(|e| format!("Failed to write tasks.md: {e}"))?;

    // Write .openspec.yaml stamp
    let yaml = format!("change: {change_name}\n");
    std::fs::write(temp_dir.join(".openspec.yaml"), yaml)
        .map_err(|e| format!("Failed to write .openspec.yaml: {e}"))?;

    // Atomic rename: temp_dir → final_dir. On Windows, the target must not
    // exist (we already ensured uniqueness via resolve_unique_change_name).
    std::fs::rename(&temp_dir, &final_dir)
        .map_err(|e| {
            // Clean up the temp dir on rename failure.
            let _ = std::fs::remove_dir_all(&temp_dir);
            format!("Failed to finalize change directory: {e}")
        })?;

    Ok(final_dir)
}

/// Parse the completed/total checkbox counts from a `tasks.md` string.
/// Recognizes both `- [x]` and `- [ ]` checkbox syntax.
pub fn parse_task_progress(tasks_content: &str) -> (u32, u32) {
    let mut completed = 0u32;
    let mut total = 0u32;
    for line in tasks_content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
            completed += 1;
            total += 1;
        } else if trimmed.starts_with("- [ ]") {
            total += 1;
        }
    }
    (completed, total)
}

/// Read the tasks.md for a plan's linked change and parse progress.
/// Returns (completed, total) or (0, 0) if the file doesn't exist.
pub fn read_task_progress(project_path: &str, change_name: &str) -> (u32, u32) {
    let tasks_path = change_dir(project_path, change_name).join("tasks.md");
    match std::fs::read_to_string(&tasks_path) {
        Ok(content) => parse_task_progress(&content),
        Err(_) => (0, 0),
    }
}

/// Link a plan to its generated OpenSpec change directory. Updates the
/// `change_name` column on the plan row.
pub fn link_plan_to_change(plan_id: &str, change_name: &str) -> DbResult<()> {
    let conn = StorageService::connect()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default();
    conn.execute(
        "UPDATE plans SET change_name = ?1, updated_at = ?2 WHERE id = ?3",
        params![change_name, now, plan_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the plan linked to a change (for navigation from the file viewer).
pub fn find_plan_by_change(change_name: &str) -> DbResult<Option<Plan>> {
    let conn = StorageService::connect()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, reference_id, title, description, goal, status,
                    priority, tags, ai_enhanced, context, idea_id, change_name,
                    created_at, updated_at, finished_at
             FROM plans WHERE change_name = ?1 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![change_name], |row| {
            let status_str: String = row.get(6)?;
            let tags_json: String = row.get(8)?;
            let context_json: Option<String> = row.get(10)?;
            Ok(Plan {
                id: row.get(0)?,
                session_id: row.get(1)?,
                reference_id: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                goal: row.get(5)?,
                status: crate::models::plan::PlanStatus::from_str(&status_str),
                priority: row.get(7)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                ai_enhanced: row.get(9)?,
                context: context_json.and_then(|j| serde_json::from_str(&j).ok()),
                idea_id: row.get(11)?,
                change_name: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                finished_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.next()
        .transpose()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_change_name_kebab_cases_titles() {
        assert_eq!(derive_change_name("Add Dark Mode"), "add-dark-mode");
        assert_eq!(derive_change_name("Fix SSL & Auth"), "fix-ssl-auth");
        assert_eq!(derive_change_name("  Multiple   Spaces  "), "multiple-spaces");
        assert_eq!(derive_change_name("API_v2 Refactor"), "api-v2-refactor");
        assert_eq!(derive_change_name(""), "untitled-change");
        assert_eq!(derive_change_name("   "), "untitled-change");
        assert_eq!(derive_change_name("---"), "untitled-change");
    }

    #[test]
    fn parse_task_progress_counts_checkboxes() {
        let tasks = r#"# Tasks: Test

## 1. Phase One

- [x] 1.1 First task
- [x] 1.2 Second task
- [ ] 1.3 Third task

## 2. Phase Two

- [ ] 2.1 Fourth task
- [x] 2.2 Fifth task
"#;
        let (completed, total) = parse_task_progress(tasks);
        assert_eq!(completed, 3);
        assert_eq!(total, 5);
    }

    #[test]
    fn parse_task_progress_handles_empty_and_no_checkboxes() {
        assert_eq!(parse_task_progress(""), (0, 0));
        assert_eq!(parse_task_progress("# Just a heading\n\nNo checkboxes here."), (0, 0));
    }

    #[test]
    fn parse_task_progress_handles_uppercase_x() {
        let tasks = "- [X] Done\n- [ ] Todo\n- [x] Also done";
        let (completed, total) = parse_task_progress(tasks);
        assert_eq!(completed, 2);
        assert_eq!(total, 3);
    }

    #[test]
    fn write_artifacts_atomic_writes_all_files() {
        // Use a temp directory as the project path.
        let tmp = std::env::temp_dir().join(format!(
            "bb-openspec-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let project_path = tmp.to_string_lossy().to_string();

        let specs = vec![("test-capability".to_string(), "## ADDED Requirements\n...".to_string())];
        let result = write_artifacts_atomic(
            &project_path,
            "test-change",
            "# Proposal: Test",
            &specs,
            Some("# Design: Test"),
            "# Tasks: Test\n- [x] 1.1 Task",
        );
        assert!(result.is_ok(), "write_artifacts_atomic failed: {:?}", result);

        let change_dir = change_dir(&project_path, "test-change");
        assert!(change_dir.exists(), "change dir exists");
        assert!(change_dir.join("proposal.md").exists(), "proposal.md exists");
        assert!(change_dir.join("specs/test-capability/spec.md").exists(), "spec.md exists");
        assert!(change_dir.join("design.md").exists(), "design.md exists");
        assert!(change_dir.join("tasks.md").exists(), "tasks.md exists");
        assert!(change_dir.join(".openspec.yaml").exists(), ".openspec.yaml exists");

        let (completed, total) = read_task_progress(&project_path, "test-change");
        assert_eq!(completed, 1);
        assert_eq!(total, 1);

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_unique_change_name_appends_suffix_on_collision() {
        let tmp = std::env::temp_dir().join(format!(
            "bb-openspec-collision-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let project_path = tmp.to_string_lossy().to_string();

        // First "test-change" is unique.
        assert_eq!(resolve_unique_change_name(&project_path, "Test Change"), "test-change");

        // Create the first change dir.
        let specs: Vec<(String, String)> = vec![];
        write_artifacts_atomic(&project_path, "test-change", "# Proposal", &specs, None, "# Tasks")
            .unwrap();

        // Second "test-change" collision gets -2 suffix.
        assert_eq!(resolve_unique_change_name(&project_path, "Test Change"), "test-change-2");

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

use std::path::{Path, PathBuf};

use rusqlite::params;

use crate::{
    models::openspec_catalog::{
        ChangeCatalogEntry, StructuredTask, StructuredTasks, TaskPhase,
    },
    models::plan::Plan,
    services::storage_service::StorageService,
};

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
pub fn changes_dir(project_path: &str) -> PathBuf {
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

/// Unlink a plan from its change directory. Clears the `change_name` column.
/// Refuses if the linked plan is in a running/ready status (active run).
pub fn unlink_plan_from_change(plan_id: &str) -> DbResult<()> {
    let conn = StorageService::connect()?;
    // Check current plan status before unlinking.
    let status_str: Option<String> = conn
        .query_row(
            "SELECT status FROM plans WHERE id = ?1",
            params![plan_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(status) = status_str {
        let plan_status = crate::models::plan::PlanStatus::from_str(&status);
        if matches!(
            plan_status,
            crate::models::plan::PlanStatus::Running
                | crate::models::plan::PlanStatus::Ready
        ) {
            return Err(format!(
                "Cannot unlink: plan is {status} (must be finished, cancelled, draft, or openspec)."
            ));
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default();
    conn.execute(
        "UPDATE plans SET change_name = NULL, updated_at = ?1 WHERE id = ?2",
        params![now, plan_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Link a change to a plan (by plan id). Refuses if another plan is already
/// linked to this change (double-link guard).
pub fn link_change_to_plan(change_name: &str, plan_id: &str) -> DbResult<()> {
    // Check for double-link: is another plan already linked to this change?
    if let Some(existing) = find_plan_by_change(change_name)? {
        if existing.id != plan_id {
            return Err(format!(
                "Change '{change_name}' is already linked to plan {} ({})",
                existing.reference_id, existing.id
            ));
        }
    }
    link_plan_to_change(plan_id, change_name)
}

/// Re-parse a change's tasks.md and emit a TaskProgressChanged event if the
/// progress has changed since the last known counts. Used by the liveness
/// poller and the post-write hook.
pub fn refresh_task_progress(
    app: &tauri::AppHandle,
    project_path: &str,
    change_name: &str,
    last_completed: u32,
    last_total: u32,
) -> DbResult<bool> {
    let (completed, total) = read_task_progress(project_path, change_name);
    if completed == last_completed && total == last_total {
        return Ok(false);
    }
    let _ = crate::services::planning_events::emit(
        app,
        crate::models::planning_event::PlanningEventKind::TaskProgressChanged,
        change_name,
        project_path,
        None,
        &format!("{change_name}/tasks.md"),
        Some(format!("{completed}/{total}")),
    );
    Ok(true)
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

/// Parse a `tasks.md` string into structured phases + tasks with line
/// offsets. Lossless: only reads headings (`## `) and checkbox lines
/// (`- [ ]` / `- [x]`); all other content is ignored. Line numbers are
/// 1-indexed for toggle operations.
pub fn parse_tasks_structured(content: &str) -> StructuredTasks {
    let mut phases: Vec<TaskPhase> = Vec::new();
    let mut current: Option<TaskPhase> = None;
    let mut total = 0u32;
    let mut completed = 0u32;

    for (idx, line) in content.lines().enumerate() {
        let line_no = (idx + 1) as u32;
        let trimmed = line.trim_start();

        // Phase heading: `## Title`
        if let Some(rest) = trimmed.strip_prefix("## ") {
            if let Some(phase) = current.take() {
                phases.push(phase);
            }
            current = Some(TaskPhase {
                name: rest.trim().to_string(),
                line: line_no,
                tasks: Vec::new(),
            });
            continue;
        }

        // Task line: `- [x] text` or `- [ ] text` (with optional id)
        let (checked, rest) = if let Some(r) = trimmed.strip_prefix("- [x]") {
            (true, r)
        } else if let Some(r) = trimmed.strip_prefix("- [X]") {
            (true, r)
        } else if let Some(r) = trimmed.strip_prefix("- [ ]") {
            (false, r)
        } else {
            continue;
        };

        let rest = rest.trim_start();
        let (id, text) = parse_task_id(rest);

        total += 1;
        if checked {
            completed += 1;
        }

        let task = StructuredTask {
            line: line_no,
            checked,
            id,
            text,
        };

        match &mut current {
            Some(phase) => phase.tasks.push(task),
            None => {
                current = Some(TaskPhase {
                    name: "Tasks".to_string(),
                    line: 0,
                    tasks: vec![task],
                });
            }
        }
    }

    if let Some(phase) = current.take() {
        phases.push(phase);
    }

    StructuredTasks {
        phases,
        total,
        completed,
    }
}

/// Parse an optional task id prefix like "1.1 " or "2.3 " from the task
/// text. Returns (id, remaining_text).
fn parse_task_id(text: &str) -> (Option<String>, String) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 || i >= bytes.len() || bytes[i] != b'.' {
        return (None, text.to_string());
    }
    i += 1;
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return (None, text.to_string());
    }
    if i < bytes.len() && !bytes[i].is_ascii_whitespace() {
        return (None, text.to_string());
    }
    let id = text[..i].to_string();
    let remaining = text[i..].trim_start().to_string();
    (Some(id), remaining)
}

/// Enumerate all changes in `openspec/changes/` (and the archive directory).
/// Tolerant of malformed changes — a missing `proposal.md` or unparseable
/// `.openspec.yaml` degrades to defaults, not an error.
pub fn list_changes(project_path: &str) -> DbResult<Vec<ChangeCatalogEntry>> {
    let changes_dir = changes_dir(project_path);
    let archive_dir = changes_dir.join("archive");

    let mut entries = Vec::new();

    if changes_dir.exists() {
        for entry in std::fs::read_dir(&changes_dir).map_err(|e| format!("Failed to read changes dir: {e}"))? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "archive" {
                continue;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            entries.push(catalog_entry(&path, &name, false, project_path));
        }
    }

    if archive_dir.exists() {
        for entry in std::fs::read_dir(&archive_dir).map_err(|e| format!("Failed to read archive dir: {e}"))? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            entries.push(catalog_entry(&path, &name, true, project_path));
        }
    }

    entries.sort_by(|a, b| match (a.archived, b.archived) {
        (false, true) => std::cmp::Ordering::Less,
        (true, false) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(entries)
}

fn catalog_entry(path: &Path, name: &str, archived: bool, project_path: &str) -> ChangeCatalogEntry {
    let has_proposal = path.join("proposal.md").exists();
    let has_design = path.join("design.md").exists();
    let has_tasks = path.join("tasks.md").exists();
    let has_specs = path
        .join("specs")
        .is_dir()
        && std::fs::read_dir(path.join("specs"))
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);

    let (completed, total) = if has_tasks {
        read_task_progress(project_path, name)
    } else {
        (0, 0)
    };

    let linked_plan_reference_id =
        find_plan_by_change(name).ok().flatten().map(|p| p.reference_id);

    let created_at = parse_openspec_created_at(path);

    ChangeCatalogEntry {
        name: name.to_string(),
        has_proposal,
        has_design,
        has_tasks,
        has_specs,
        completed,
        total,
        linked_plan_reference_id,
        archived,
        created_at,
    }
}

fn parse_openspec_created_at(path: &Path) -> i64 {
    let yaml_path = path.join(".openspec.yaml");
    let content = match std::fs::read_to_string(&yaml_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("created:") {
            let val = rest.trim().trim_matches(|c| c == '"' || c == '\'');
            if let Ok(secs) = val.parse::<i64>() {
                return secs;
            }
            // YYYY-MM-DD format: best-effort parse to epoch via a simple split.
            return parse_date_to_epoch(val);
        }
    }
    0
}

/// Best-effort parse of a `YYYY-MM-DD` date string to epoch seconds (UTC).
/// Returns 0 on any parse failure.
fn parse_date_to_epoch(val: &str) -> i64 {
    let parts: Vec<&str> = val.split('-').collect();
    if parts.len() != 3 {
        return 0;
    }
    let year: i64 = parts[0].parse().unwrap_or(0);
    let month: i64 = parts[1].parse().unwrap_or(0);
    let day: i64 = parts[2].parse().unwrap_or(0);
    if year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 {
        return 0;
    }
    // Days since 1970-01-01 (UTC). Ignores leap years for simplicity —
    // this is a best-effort sort key, not a precision timestamp.
    let years_since_epoch = year - 1970;
    let days_in_months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut day_of_year: i64 = day;
    for m in 0..(month as usize - 1) {
        day_of_year += days_in_months[m];
    }
    years_since_epoch * 365 * 86400 + (day_of_year - 1) * 86400
}

/// Format the current local date as `YYYY-MM-DD` using std-only.
fn current_date_string() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Convert epoch seconds to YYYY-MM-DD (UTC). Simple division.
    let days = secs / 86400;
    let mut year = 1970i64;
    let mut remaining = days;
    loop {
        let year_days = if is_leap_year(year) { 366 } else { 365 };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        year += 1;
    }
    let days_in_months = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1usize;
    for &dim in &days_in_months {
        if remaining < dim {
            break;
        }
        remaining -= dim;
        month += 1;
    }
    let day = remaining + 1;
    format!("{year:04}-{month:02}-{day:02}")
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Toggle the checkbox on a specific line of a change's `tasks.md`.
/// Canonicalizes the path under `openspec/changes/` (no traversal), verifies
/// the line content matches the expected state before writing, and rewrites
/// atomically via temp + rename. Emits a `TaskProgressChanged` event.
pub fn toggle_task(
    app: &tauri::AppHandle,
    project_path: &str,
    change_name: &str,
    line_no: u32,
    make_checked: bool,
) -> DbResult<()> {
    if change_name.contains('/') || change_name.contains('\\') || change_name.contains("..") {
        return Err("Invalid change name.".to_string());
    }

    let tasks_path = change_dir(project_path, change_name).join("tasks.md");
    let content = std::fs::read_to_string(&tasks_path)
        .map_err(|e| format!("Failed to read tasks.md: {e}"))?;

    let lines: Vec<&str> = content.lines().collect();
    let idx = line_no as usize;
    if idx == 0 || idx > lines.len() {
        return Err(format!("Line {line_no} is out of range (1..={}).", lines.len()));
    }

    let target = lines[idx - 1];
    let (old_marker, new_marker) = if make_checked {
        ("- [ ]", "- [x]")
    } else {
        ("- [x]", "- [ ]")
    };

    let trimmed = target.trim_start();
    let leading_ws_len = target.len() - trimmed.len();
    if !trimmed.starts_with(old_marker) {
        if trimmed.starts_with(new_marker) {
            return Ok(());
        }
        return Err(format!("Line {line_no} is not a {old_marker} checkbox."));
    }

    let leading_ws = &target[..leading_ws_len];
    let rest = &trimmed[old_marker.len()..];
    let new_line = format!("{leading_ws}{new_marker}{rest}");

    let mut new_lines = lines.clone();
    new_lines[idx - 1] = &new_line;
    let new_content = new_lines.join("\n");
    let new_content = if content.ends_with('\n') {
        format!("{new_content}\n")
    } else {
        new_content
    };

    let tmp_path = tasks_path.with_extension("md.tmp");
    std::fs::write(&tmp_path, &new_content)
        .map_err(|e| format!("Failed to write temp tasks.md: {e}"))?;
    std::fs::rename(&tmp_path, &tasks_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to rename tasks.md: {e}")
    })?;

    let (completed, total) = parse_task_progress(&new_content);
    let _ = crate::services::planning_events::emit(
        app,
        crate::models::planning_event::PlanningEventKind::TaskProgressChanged,
        change_name,
        project_path,
        None,
        &format!("{change_name}/tasks.md"),
        Some(format!("{completed}/{total}")),
    );

    Ok(())
}

/// Archive a change by moving its directory to `openspec/changes/archive/`.
/// Refuses if the linked plan is in a non-terminal status. The archive
/// directory is created if it doesn't exist.
pub fn archive_change(project_path: &str, change_name: &str) -> DbResult<()> {
    if change_name.contains('/') || change_name.contains('\\') || change_name.contains("..") {
        return Err("Invalid change name.".to_string());
    }

    if let Some(plan) = find_plan_by_change(change_name)? {
        let status = plan.status;
        if !matches!(
            status,
            crate::models::plan::PlanStatus::Finished | crate::models::plan::PlanStatus::Cancelled
        ) {
            return Err(format!(
                "Cannot archive: linked plan {} is {} (must be finished or cancelled).",
                plan.reference_id,
                status.as_str()
            ));
        }
    }

    let src = change_dir(project_path, change_name);
    if !src.exists() {
        return Err(format!("Change directory not found: {change_name}"));
    }

    let archive_dir = changes_dir(project_path).join("archive");
    std::fs::create_dir_all(&archive_dir)
        .map_err(|e| format!("Failed to create archive dir: {e}"))?;

    let date = current_date_string();
    let archived_name = format!("{date}-{change_name}");
    let dest = archive_dir.join(&archived_name);

    std::fs::rename(&src, &dest)
        .map_err(|e| format!("Failed to move change to archive: {e}"))?;

    Ok(())
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

    #[test]
    fn parse_tasks_structured_basic() {
        let content = "# Tasks: foo\n\n## Phase 1\n\n- [ ] 1.1 First task\n- [x] 1.2 Second task\n\n## Phase 2\n\n- [ ] 2.1 Third task\n";
        let parsed = parse_tasks_structured(content);
        assert_eq!(parsed.phases.len(), 2);
        assert_eq!(parsed.phases[0].name, "Phase 1");
        assert_eq!(parsed.phases[0].tasks.len(), 2);
        assert_eq!(parsed.phases[0].tasks[0].id.as_deref(), Some("1.1"));
        assert_eq!(parsed.phases[0].tasks[0].text, "First task");
        assert!(!parsed.phases[0].tasks[0].checked);
        assert!(parsed.phases[0].tasks[1].checked);
        assert_eq!(parsed.phases[1].tasks.len(), 1);
        assert_eq!(parsed.total, 3);
        assert_eq!(parsed.completed, 1);
    }

    #[test]
    fn parse_tasks_structured_empty() {
        let parsed = parse_tasks_structured("");
        assert!(parsed.phases.is_empty());
        assert_eq!(parsed.total, 0);
    }

    #[test]
    fn parse_tasks_structured_tasks_without_heading() {
        let content = "- [ ] task one\n- [x] task two\n";
        let parsed = parse_tasks_structured(content);
        assert_eq!(parsed.phases.len(), 1);
        assert_eq!(parsed.phases[0].name, "Tasks");
        assert_eq!(parsed.total, 2);
        assert_eq!(parsed.completed, 1);
    }

    #[test]
    fn parse_task_id_no_id() {
        let (id, text) = parse_task_id("just some text");
        assert!(id.is_none());
        assert_eq!(text, "just some text");
    }

    #[test]
    fn parse_task_id_with_id() {
        let (id, text) = parse_task_id("1.1 Do the thing");
        assert_eq!(id.as_deref(), Some("1.1"));
        assert_eq!(text, "Do the thing");
    }

    #[test]
    fn toggle_task_rejects_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        #[cfg(not(target_os = "windows"))]
        {
            let app = tauri::test::mock_app().app_handle().clone();
            let result = toggle_task(&app, "/test", "../escape", 1, true);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Invalid change name"));
        }
    }

    #[test]
    fn archive_change_rejects_traversal() {
        let result = archive_change("/test", "../escape");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid change name"));
    }

    #[test]
    fn archive_change_rejects_missing_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let result = archive_change(dir.path().to_str().unwrap(), "nonexistent-change");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Change directory not found"));
    }

    #[test]
    fn link_change_to_plan_rejects_double_link() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        // Create two plans and a change.
        let conn = crate::services::storage_service::StorageService::connect().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('sess-1', '/test', 'Test', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, goal, status, priority, tags, ai_enhanced, context, idea_id, change_name, created_at, updated_at, finished_at)
             VALUES ('plan-a', 'sess-1', 'PLAN-001', 'Plan A', '', '', 'draft', 1, '[]', 0, NULL, NULL, 'test-change', ?1, ?1, NULL)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, goal, status, priority, tags, ai_enhanced, context, idea_id, change_name, created_at, updated_at, finished_at)
             VALUES ('plan-b', 'sess-1', 'PLAN-002', 'Plan B', '', '', 'draft', 1, '[]', 0, NULL, NULL, NULL, ?1, ?1, NULL)",
            params![now],
        ).unwrap();
        drop(conn);

        // Linking plan-b to a change already linked to plan-a should fail.
        let result = link_change_to_plan("test-change", "plan-b");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already linked"), "Expected double-link error, got: {err}");
    }

    #[test]
    fn unlink_plan_from_change_rejects_active_plan() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = crate::services::storage_service::StorageService::connect().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('sess-1', '/test', 'Test', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, goal, status, priority, tags, ai_enhanced, context, idea_id, change_name, created_at, updated_at, finished_at)
             VALUES ('plan-run', 'sess-1', 'PLAN-003', 'Running Plan', '', '', 'running', 1, '[]', 0, NULL, NULL, 'test-change', ?1, ?1, NULL)",
            params![now],
        ).unwrap();
        drop(conn);

        let result = unlink_plan_from_change("plan-run");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Cannot unlink"), "Expected active-plan rejection, got: {err}");
    }
}

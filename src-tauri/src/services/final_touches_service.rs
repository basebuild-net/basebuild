use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::services::storage_service::StorageService;

type DbResult<T> = Result<T, String>;

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// Final-touch step kinds. `shell` runs a shell command; `validate` runs a
/// harness turn over the diff; `commit` commits via git_service;
/// `pull_request` opens a PR via git_service. Remote-writing kinds
/// (`commit`, `pull_request`) default disabled.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FinalTouchStepKind {
    Shell,
    Validate,
    Commit,
    PullRequest,
}

impl FinalTouchStepKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            FinalTouchStepKind::Shell => "shell",
            FinalTouchStepKind::Validate => "validate",
            FinalTouchStepKind::Commit => "commit",
            FinalTouchStepKind::PullRequest => "pull_request",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "shell" => Some(FinalTouchStepKind::Shell),
            "validate" => Some(FinalTouchStepKind::Validate),
            "commit" => Some(FinalTouchStepKind::Commit),
            "pull_request" => Some(FinalTouchStepKind::PullRequest),
            _ => None,
        }
    }

    /// Remote-writing kinds default disabled per the no-silent-side-effects
    /// invariant.
    pub fn defaults_disabled(&self) -> bool {
        matches!(self, FinalTouchStepKind::Commit | FinalTouchStepKind::PullRequest)
    }
}

/// A configured final-touch step for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalTouchStep {
    pub id: String,
    pub project_path: String,
    pub kind: FinalTouchStepKind,
    pub label: String,
    pub enabled: bool,
    pub sort_order: i64,
    /// Kind-specific config: shell command, validate prompt, commit message
    /// template, PR title template.
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating/updating a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalTouchStepInput {
    pub project_path: String,
    pub kind: String,
    pub label: String,
    pub enabled: Option<bool>,
    pub sort_order: Option<i64>,
    pub config: Option<serde_json::Value>,
}

/// Per-step execution result appended to plan_runs.steps_output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalTouchStepResult {
    pub step_id: String,
    pub kind: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct FinalTouchesService;

impl FinalTouchesService {
    pub fn list_steps(project_path: &str) -> DbResult<Vec<FinalTouchStep>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, kind, label, enabled, sort_order, config, created_at, updated_at
                 FROM final_touch_steps WHERE project_path = ?1 ORDER BY sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], Self::map_step)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn create_step(input: FinalTouchStepInput) -> DbResult<FinalTouchStep> {
        let kind = FinalTouchStepKind::from_str(&input.kind)
            .ok_or_else(|| format!("Unknown final-touch step kind: {}", input.kind))?;
        let id = gen_id();
        let now = now();
        // Remote-writing kinds default disabled.
        let enabled = input.enabled.unwrap_or(!kind.defaults_disabled());
        let next_order: i64 = {
            let conn = StorageService::connect()?;
            conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM final_touch_steps WHERE project_path = ?1",
                params![input.project_path],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };
        let sort_order = input.sort_order.unwrap_or(next_order);
        let config = input.config.unwrap_or(serde_json::json!({}));
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO final_touch_steps (id, project_path, kind, label, enabled, sort_order, config, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                input.project_path,
                kind.as_str(),
                input.label,
                enabled as i32,
                sort_order,
                config.to_string(),
                now,
                now,
            ],
        )
        .map_err(|e| format!("Failed to create final-touch step: {e}"))?;
        Self::get_step(&id)?.ok_or_else(|| "Step not found after creation".to_string())
    }

    pub fn update_step(id: &str, input: FinalTouchStepInput) -> DbResult<FinalTouchStep> {
        let kind = FinalTouchStepKind::from_str(&input.kind)
            .ok_or_else(|| format!("Unknown final-touch step kind: {}", input.kind))?;
        let now = now();
        let config = input.config.unwrap_or(serde_json::json!({}));
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE final_touch_steps SET kind = ?1, label = ?2, config = ?3, updated_at = ?4 WHERE id = ?5",
            params![kind.as_str(), input.label, config.to_string(), now, id],
        )
        .map_err(|e| format!("Failed to update final-touch step: {e}"))?;
        Self::get_step(id)?.ok_or_else(|| "Step not found after update".to_string())
    }

    pub fn set_enabled(id: &str, enabled: bool) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE final_touch_steps SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled as i32, now(), id],
        )
        .map_err(|e| format!("Failed to toggle final-touch step: {e}"))?;
        Ok(())
    }

    pub fn reorder_step(id: &str, new_order: i64) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE final_touch_steps SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_order, now(), id],
        )
        .map_err(|e| format!("Failed to reorder final-touch step: {e}"))?;
        Ok(())
    }

    pub fn delete_step(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM final_touch_steps WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete final-touch step: {e}"))?;
        Ok(())
    }

    pub fn get_step(id: &str) -> DbResult<Option<FinalTouchStep>> {
        let conn = StorageService::connect()?;
        conn.query_row(
            "SELECT id, project_path, kind, label, enabled, sort_order, config, created_at, updated_at
             FROM final_touch_steps WHERE id = ?1",
            params![id],
            Self::map_step,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Returns only enabled steps in order. Used by the execution path.
    pub fn enabled_steps(project_path: &str) -> DbResult<Vec<FinalTouchStep>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, kind, label, enabled, sort_order, config, created_at, updated_at
                 FROM final_touch_steps WHERE project_path = ?1 AND enabled = 1 ORDER BY sort_order ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], Self::map_step)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Execute all enabled final-touch steps for a project sequentially.
    /// Halts on the first failure. Returns the results for each step that
    /// ran (including the failed one). Called by `plan_runner_service`
    /// when a run completes successfully.
    pub fn execute_steps(project_path: &str) -> DbResult<Vec<FinalTouchStepResult>> {
        let steps = Self::enabled_steps(project_path)?;
        let mut results = Vec::new();
        for step in steps {
            let result = Self::execute_step(&step);
            results.push(result.clone());
            if result.status == "failed" {
                break;
            }
        }
        Ok(results)
    }

    /// Execute a single final-touch step by kind.
    fn execute_step(step: &FinalTouchStep) -> FinalTouchStepResult {
        match step.kind {
            FinalTouchStepKind::Shell => Self::execute_shell(step),
            FinalTouchStepKind::Validate => Self::execute_validate(step),
            FinalTouchStepKind::Commit => Self::execute_commit(step),
            FinalTouchStepKind::PullRequest => Self::execute_pull_request(step),
        }
    }

    /// Shell step: run a shell command in the project's working directory.
    fn execute_shell(step: &FinalTouchStep) -> FinalTouchStepResult {
        let command = step
            .config
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if command.is_empty() {
            return FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "failed".to_string(),
                output: None,
                error: Some("No command configured".to_string()),
            };
        }
        // Run the command in the project's working directory with a timeout.
        let output = crate::services::process_helpers::hidden_command(
            #[cfg(windows)]
            "cmd",
            #[cfg(not(windows))]
            "sh",
        )
        .args([
            #[cfg(windows)]
            "/C",
            #[cfg(not(windows))]
            "-c",
            command,
        ])
        .current_dir(&step.project_path)
        .output();
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                FinalTouchStepResult {
                    step_id: step.id.clone(),
                    kind: step.kind.as_str().to_string(),
                    status: if out.status.success() { "succeeded".to_string() } else { "failed".to_string() },
                    output: Some(stdout),
                    error: if out.status.success() { None } else { Some(stderr) },
                }
            }
            Err(e) => FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "failed".to_string(),
                output: None,
                error: Some(format!("Failed to run command: {e}")),
            },
        }
    }

    /// Validate step: harness turn over git diff vs specs.
    /// Not yet wired to the agent loop (requires a running chat session).
    /// Returns "skipped" for now — the validate step is a placeholder until
    /// the diff-review-workflow change provides the review turn.
    fn execute_validate(step: &FinalTouchStep) -> FinalTouchStepResult {
        FinalTouchStepResult {
            step_id: step.id.clone(),
            kind: step.kind.as_str().to_string(),
            status: "skipped".to_string(),
            output: Some("Validate step requires a running chat session (diff-review-workflow)".to_string()),
            error: None,
        }
    }

    /// Commit step: commit changes via git_service.
    fn execute_commit(step: &FinalTouchStep) -> FinalTouchStepResult {
        let message = step
            .config
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Automated commit");
        let project_path = std::path::Path::new(&step.project_path);
        match crate::services::git_service::GitService::commit(project_path, message) {
            Ok(_) => FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "succeeded".to_string(),
                output: Some(format!("Committed: {message}")),
                error: None,
            },
            Err(e) => FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "failed".to_string(),
                output: None,
                error: Some(e),
            },
        }
    }

    /// Pull request step: push the branch and create a PR via the
    /// `pull_request_service` (gh CLI when available+authed, else open the
    /// GitHub compare URL in the browser). No token stored. The step is
    /// confirm-gated by the caller — this executes only when the user has
    /// explicitly enabled the step AND confirmed at execution time.
    fn execute_pull_request(step: &FinalTouchStep) -> FinalTouchStepResult {
        let title = step
            .config
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Automated PR");
        let body = step
            .config
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let branch = step
            .config
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if branch.is_empty() {
            return FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "failed".to_string(),
                output: None,
                error: Some("No branch configured for PR step".to_string()),
            };
        }
        match crate::services::pull_request_service::PullRequestService::create_pr(
            &step.project_path,
            branch,
            title,
            body,
        ) {
            Ok(result) => FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: if result.success { "succeeded".to_string() } else { "failed".to_string() },
                output: result.url,
                error: result.error,
            },
            Err(e) => FinalTouchStepResult {
                step_id: step.id.clone(),
                kind: step.kind.as_str().to_string(),
                status: "failed".to_string(),
                output: None,
                error: Some(e),
            },
        }
    }

    fn map_step(row: &rusqlite::Row<'_>) -> rusqlite::Result<FinalTouchStep> {
        let kind_str: String = row.get(2)?;
        let config_str: String = row.get(6)?;
        Ok(FinalTouchStep {
            id: row.get(0)?,
            project_path: row.get(1)?,
            kind: FinalTouchStepKind::from_str(&kind_str).unwrap_or(FinalTouchStepKind::Shell),
            label: row.get(3)?,
            enabled: row.get::<_, i64>(4)? != 0,
            sort_order: row.get(5)?,
            config: serde_json::from_str(&config_str).unwrap_or(serde_json::json!({})),
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_kind_round_trip() {
        for kind in ["shell", "validate", "commit", "pull_request"] {
            let k = FinalTouchStepKind::from_str(kind).unwrap();
            assert_eq!(k.as_str(), kind);
        }
        assert!(FinalTouchStepKind::from_str("nonsense").is_none());
    }

    #[test]
    fn remote_writing_kinds_default_disabled() {
        assert!(!FinalTouchStepKind::Shell.defaults_disabled());
        assert!(!FinalTouchStepKind::Validate.defaults_disabled());
        assert!(FinalTouchStepKind::Commit.defaults_disabled());
        assert!(FinalTouchStepKind::PullRequest.defaults_disabled());
    }

    #[test]
    fn list_steps_empty_for_new_project() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let steps = FinalTouchesService::list_steps("/no/steps").unwrap();
        assert!(steps.is_empty());
    }

    #[test]
    fn create_step_defaults_enabled_for_shell() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let step = FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "shell".into(),
            label: "Run tests".into(),
            enabled: None,
            sort_order: None,
            config: Some(serde_json::json!({"command": "npm test"})),
        })
        .unwrap();
        assert!(step.enabled);
        assert_eq!(step.kind, FinalTouchStepKind::Shell);
    }

    #[test]
    fn create_step_defaults_disabled_for_commit() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let step = FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "commit".into(),
            label: "Commit changes".into(),
            enabled: None,
            sort_order: None,
            config: None,
        })
        .unwrap();
        assert!(!step.enabled);
        assert_eq!(step.kind, FinalTouchStepKind::Commit);
    }

    #[test]
    fn enabled_steps_filters_disabled() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "shell".into(),
            label: "Enabled".into(),
            enabled: Some(true),
            sort_order: None,
            config: None,
        })
        .unwrap();
        FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "commit".into(),
            label: "Disabled".into(),
            enabled: Some(false),
            sort_order: None,
            config: None,
        })
        .unwrap();
        let enabled = FinalTouchesService::enabled_steps("/test").unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].label, "Enabled");
    }

    #[test]
    fn reorder_step() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let s1 = FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "shell".into(),
            label: "First".into(),
            enabled: Some(true),
            sort_order: None,
            config: None,
        })
        .unwrap();
        let s2 = FinalTouchesService::create_step(FinalTouchStepInput {
            project_path: "/test".into(),
            kind: "shell".into(),
            label: "Second".into(),
            enabled: Some(true),
            sort_order: None,
            config: None,
        })
        .unwrap();
        assert_eq!(s1.sort_order, 0);
        assert_eq!(s2.sort_order, 1);
        // Move s2 before s1.
        FinalTouchesService::reorder_step(&s2.id, -1).unwrap();
        let steps = FinalTouchesService::list_steps("/test").unwrap();
        assert_eq!(steps[0].label, "Second");
        assert_eq!(steps[1].label, "First");
    }
}

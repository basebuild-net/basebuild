use std::path::Path;

use crate::models::openspec_runtime::OpenSpecRuntimeStatus;
use crate::services::process_helpers::{hidden_command, run_with_timeout, OMP_TIMEOUT};

type RResult<T> = Result<T, String>;

/// Service for detecting and validating the OpenSpec toolchain.
///
/// Detection is local-only: no network calls. The service probes for an
/// `openspec` executable on PATH (or a user-configured path), runs
/// `openspec --version`, and checks whether the project has an `openspec/`
/// directory. Install/update are explicit stubs returning actionable
/// `not configured` messages until a distribution source is selected.
pub struct OpenSpecRuntimeService;

impl OpenSpecRuntimeService {
    /// Check OpenSpec runtime status for a project path.
    ///
    /// - If an executable is found and responds to `--version`, state is
    ///   `ready` when the project has `openspec/`, otherwise `missing`
    ///   with a project-not-ready message.
    /// - If no executable is found, state is `missing` with guidance.
    /// - If detection itself errors, state is `error` with the message.
    pub fn status(project_path: Option<&str>) -> OpenSpecRuntimeStatus {
        let project_ready = project_path
            .map(|p| Path::new(p).join("openspec").is_dir())
            .unwrap_or(false);

        match Self::detect_executable() {
            DetectResult::Found { path, version } => {
                let schema = Self::detect_schema(project_path);
                OpenSpecRuntimeStatus {
                    state: if project_ready {
                        "ready".to_string()
                    } else {
                        "missing".to_string()
                    },
                    version: Some(version),
                    executable_path: Some(path),
                    schema,
                    project_ready,
                    message: if project_ready {
                        None
                    } else {
                        Some("OpenSpec executable found, but the project has no openspec/ directory. Run openspec init or choose a project with an existing openspec/ folder.".to_string())
                    },
                }
            }
            DetectResult::NotFound => OpenSpecRuntimeStatus {
                state: "missing".to_string(),
                version: None,
                executable_path: None,
                schema: None,
                project_ready,
                message: Some(
                    "OpenSpec executable not found on PATH. Set a manual path in Settings → OpenSpec or install OpenSpec.".to_string(),
                ),
            },
            DetectResult::Error(msg) => OpenSpecRuntimeStatus {
                state: "error".to_string(),
                version: None,
                executable_path: None,
                schema: None,
                project_ready,
                message: Some(msg),
            },
        }
    }

    /// Probe for the `openspec` executable on PATH. Returns the path and
    /// version string on success. No network calls.
    pub fn detect_executable() -> DetectResult {
        let mut cmd = hidden_command("openspec");
        cmd.arg("--version");
        match run_with_timeout(cmd, OMP_TIMEOUT, "openspec --version") {
            Ok(stdout) => {
                let version = stdout.trim().to_string();
                if version.is_empty() {
                    return DetectResult::Error(
                        "openspec --version returned empty output.".to_string(),
                    );
                }
                // Try to resolve the absolute path of the executable.
                let path = which_openspec().unwrap_or_else(|| "openspec".to_string());
                DetectResult::Found { path, version }
            }
            Err(e) => {
                // Distinguish "not found" from "ran but failed".
                if e.contains("Failed to run openspec") || e.contains("No such file") {
                    DetectResult::NotFound
                } else {
                    DetectResult::Error(e)
                }
            }
        }
    }

    /// Validate that a path contains an `openspec/` directory with at least
    /// a `changes/` subdirectory or a `.openspec.yaml` / `openspec.yaml` file.
    pub fn validate_project(path: &str) -> bool {
        let openspec_dir = Path::new(path).join("openspec");
        if !openspec_dir.is_dir() {
            return false;
        }
        // Accept projects with a changes/ dir or a config file.
        openspec_dir.join("changes").is_dir()
            || openspec_dir.join(".openspec.yaml").exists()
            || openspec_dir.join("openspec.yaml").exists()
    }

    /// Best-effort schema detection from the project's openspec config.
    fn detect_schema(project_path: Option<&str>) -> Option<String> {
        let p = project_path?;
        let dir = Path::new(p).join("openspec");
        for name in [".openspec.yaml", "openspec.yaml"] {
            let file = dir.join(name);
            if let Ok(content) = std::fs::read_to_string(&file) {
                // Naive parse: look for `schema:` line.
                for line in content.lines() {
                    let trimmed = line.trim();
                    if let Some(rest) = trimmed.strip_prefix("schema:") {
                        let val = rest.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    /// Install stub: returns an actionable error until a source is configured.
    /// No network call is made.
    pub fn install(_project_path: Option<&str>) -> RResult<OpenSpecRuntimeStatus> {
        Err(
            "OpenSpec install source not configured. Set a manual executable path in Settings → OpenSpec or install OpenSpec manually and set the path."
                .to_string(),
        )
    }

    /// Update stub: returns an actionable error until a source is configured.
    /// No network call is made.
    pub fn update(_project_path: Option<&str>) -> RResult<OpenSpecRuntimeStatus> {
        Err(
            "OpenSpec update source not configured. Update OpenSpec manually and verify the path in Settings → OpenSpec."
                .to_string(),
        )
    }
}

/// Result of executable detection.
#[derive(Debug, Clone)]
pub enum DetectResult {
    /// Executable found with path and version.
    Found { path: String, version: String },
    /// No executable on PATH.
    NotFound,
    /// Detection errored.
    Error(String),
}

/// Best-effort `which` for the openspec executable. Returns the absolute path
/// if resolvable, otherwise falls back to the bare name.
fn which_openspec() -> Option<String> {
    let mut cmd = if cfg!(windows) {
        let mut c = hidden_command("where");
        c.arg("openspec");
        c
    } else {
        let mut c = hidden_command("which");
        c.arg("openspec");
        c
    };
    run_with_timeout(cmd, OMP_TIMEOUT, "which openspec")
        .ok()
        .map(|s| s.trim().lines().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_returns_missing_when_no_executable() {
        // On CI / test environments, openspec is likely not installed.
        // This test verifies the missing path returns a usable status.
        let status = OpenSpecRuntimeService::status(None);
        assert!(
            status.state == "missing" || status.state == "error",
            "expected missing or error, got {}",
            status.state
        );
        assert!(!status.project_ready);
    }

    #[test]
    fn validate_project_returns_false_for_nonexistent() {
        assert!(!OpenSpecRuntimeService::validate_project(
            "/nonexistent/path/xyz"
        ));
    }

    #[test]
    fn validate_project_returns_false_for_no_openspec_dir() {
        let tmp = std::env::temp_dir();
        assert!(!OpenSpecRuntimeService::validate_project(
            tmp.to_str().unwrap()
        ));
    }

    #[test]
    fn validate_project_returns_true_for_valid_structure() {
        let tmp = std::env::temp_dir().join("bb_openspec_test_valid");
        let openspec_dir = tmp.join("openspec").join("changes");
        std::fs::create_dir_all(&openspec_dir).unwrap();
        assert!(OpenSpecRuntimeService::validate_project(
            tmp.to_str().unwrap()
        ));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn install_returns_actionable_error() {
        let result = OpenSpecRuntimeService::install(None);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("not configured"));
    }

    #[test]
    fn update_returns_actionable_error() {
        let result = OpenSpecRuntimeService::update(None);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("not configured"));
    }
}

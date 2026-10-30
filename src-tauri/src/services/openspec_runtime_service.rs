use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;

use tauri::{AppHandle, Emitter};

use crate::models::openspec_runtime::{
    OpenSpecRuntimeProgress, OpenSpecRuntimeStatus, OPENSPEC_RUNTIME_PROGRESS_EVENT,
};
use crate::services::process_helpers::{hidden_command, run_with_timeout, OMP_TIMEOUT};

type RResult<T> = Result<T, String>;

/// Service for detecting, installing, and updating the OpenSpec toolchain.
///
/// Detection is local-only: no network calls. The service probes for an
/// `openspec` executable on PATH (or a user-configured path), runs
/// `openspec --version`, and checks whether the project has an `openspec/`
/// directory. Install and update run `npm install -g @fission-ai/openspec@latest`
/// and are only started after the user confirms in the UI.
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
        if OPERATION_RUNNING.load(Ordering::SeqCst) {
            return OpenSpecRuntimeStatus {
                state: "installing".to_string(),
                version: None,
                executable_path: None,
                schema: None,
                project_ready,
                message: Some("An OpenSpec install or update is running.".to_string()),
            };
        }

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

    /// Install OpenSpec from npm (`@fission-ai/openspec`) as a global package.
    /// Callers must have obtained user confirmation in the UI first.
    pub fn install(app: &AppHandle, project_path: Option<&str>) -> RResult<OpenSpecRuntimeStatus> {
        Self::run_global_install(app, RuntimeAction::Install, project_path)
    }

    /// Update OpenSpec to the latest npm release. Requires an existing install.
    pub fn update(app: &AppHandle, project_path: Option<&str>) -> RResult<OpenSpecRuntimeStatus> {
        if matches!(Self::detect_executable(), DetectResult::NotFound) {
            return Err("OpenSpec is not installed. Use Install first.".to_string());
        }
        Self::run_global_install(app, RuntimeAction::Update, project_path)
    }

    fn run_global_install(
        app: &AppHandle,
        action: RuntimeAction,
        project_path: Option<&str>,
    ) -> RResult<OpenSpecRuntimeStatus> {
        let spec = format!("{OPENSPEC_NPM_PACKAGE}@latest");
        {
            let _guard = OperationGuard::acquire()?;
            emit_progress(app, action, "started", format!("npm install -g {spec}"));
            stream_npm_install(app, action, &spec)?;
            emit_progress(
                app,
                action,
                "finished",
                "npm finished. Checking the OpenSpec version.".to_string(),
            );
        }
        Ok(Self::status(project_path))
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

/// npm distribution of the OpenSpec CLI.
pub const OPENSPEC_NPM_PACKAGE: &str = "@fission-ai/openspec";
/// Number of trailing npm output lines kept for error messages.
const NPM_OUTPUT_TAIL_LINES: usize = 8;
/// Longest npm output line forwarded to the UI.
const NPM_LINE_MAX_CHARS: usize = 300;
const NPM_BIN: &str = if cfg!(windows) { "npm.cmd" } else { "npm" };

/// Set while an install or update runs so overlapping calls fail fast and
/// status reports `installing`.
static OPERATION_RUNNING: AtomicBool = AtomicBool::new(false);

struct OperationGuard;

impl OperationGuard {
    fn acquire() -> RResult<Self> {
        OPERATION_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| OperationGuard)
            .map_err(|_| "An OpenSpec install or update is already running.".to_string())
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        OPERATION_RUNNING.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Copy)]
enum RuntimeAction {
    Install,
    Update,
}

impl RuntimeAction {
    fn label(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Update => "update",
        }
    }
}

fn emit_progress(app: &AppHandle, action: RuntimeAction, phase: &str, message: String) {
    let _ = app.emit(
        OPENSPEC_RUNTIME_PROGRESS_EVENT,
        OpenSpecRuntimeProgress {
            action: action.label().to_string(),
            phase: phase.to_string(),
            message,
        },
    );
}

fn spawn_line_reader<R: Read + Send + 'static>(pipe: R, tx: mpsc::Sender<String>) {
    thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let clipped: String = trimmed.chars().take(NPM_LINE_MAX_CHARS).collect();
                let _ = tx.send(clipped);
            }
        }
    });
}

/// Run `npm install -g <spec>`, forwarding each output line as a progress
/// event. Returns an error with the final output lines when npm fails.
fn stream_npm_install(app: &AppHandle, action: RuntimeAction, spec: &str) -> RResult<()> {
    let mut child = hidden_command(NPM_BIN)
        .args(["install", "-g", spec])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "npm was not found on PATH. Install Node.js (it includes npm), then try again."
                    .to_string()
            } else {
                format!("Failed to start npm: {e}")
            }
        })?;

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        spawn_line_reader(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_line_reader(stderr, tx.clone());
    }
    drop(tx);

    // rx ends once both reader threads have finished, i.e. both pipes closed.
    let mut tail: VecDeque<String> = VecDeque::with_capacity(NPM_OUTPUT_TAIL_LINES);
    for line in rx {
        emit_progress(app, action, "output", line.clone());
        if tail.len() == NPM_OUTPUT_TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line);
    }

    let exit = child
        .wait()
        .map_err(|e| format!("Failed to wait for npm: {e}"))?;
    if exit.success() {
        return Ok(());
    }
    let mut message = format!("npm install -g {spec} failed (exit {:?}).", exit.code());
    if !tail.is_empty() {
        let lines: Vec<&str> = tail.iter().map(String::as_str).collect();
        message.push('\n');
        message.push_str(&lines.join("\n"));
    }
    if tail.iter().any(|line| line.contains("EACCES")) {
        message.push_str(
            "\nnpm cannot write to its global prefix. Fix the npm permissions or use a Node.js install with a writable global prefix.",
        );
    }
    Err(message)
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
            status.state == "missing" || status.state == "error" || status.state == "installing",
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
    fn operation_guard_rejects_overlapping_runs() {
        let first = OperationGuard::acquire().expect("first acquire succeeds");
        assert!(OperationGuard::acquire().is_err());
        drop(first);
        assert!(OperationGuard::acquire().is_ok());
    }
}

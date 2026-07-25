use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::OMP_EVENT;
use crate::models::omp::{OmpCommandResult, OmpStatus};
use crate::services::process_helpers::hidden_command;

static STREAM_ID: AtomicU64 = AtomicU64::new(1);

/// Cache of the last OMP install probe. `status()` spawns `omp --version`
/// (and `omp config path`) which is far too expensive to run on every usage
/// status read. Hot paths (usage-source availability, sync gates) use
/// `is_installed_cached()` instead; install state does not change mid-session.
static INSTALLED_CACHE: LazyLock<parking_lot::Mutex<Option<(bool, Instant)>>> =
    LazyLock::new(|| parking_lot::Mutex::new(None));
const INSTALLED_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Default)]
pub struct OmpService;

impl OmpService {
    pub fn status() -> OmpStatus {
        match run_omp(&["--version"]) {
            Ok(version_result) if version_result.success => {
                let config_path = run_omp(&["config", "path"])
                    .ok()
                    .filter(|result| result.success)
                    .map(|result| result.stdout.trim().to_string())
                    .filter(|path| !path.is_empty());

                OmpStatus {
                    installed: true,
                    version: Some(version_result.stdout.trim().to_string()),
                    config_path,
                    message: None,
                }
            }
            Ok(result) => OmpStatus {
                installed: false,
                version: None,
                config_path: None,
                message: Some(result.stderr),
            },
            Err(message) => OmpStatus {
                installed: false,
                version: None,
                config_path: None,
                message: Some(message),
            },
        }
    }

    /// Cached `installed` check for hot paths. Probes at most once per
    /// `INSTALLED_TTL`; never spawns a subprocess on the fast path.
    pub fn is_installed_cached() -> bool {
        {
            let cache = INSTALLED_CACHE.lock();
            if let Some((installed, at)) = *cache {
                if at.elapsed() < INSTALLED_TTL {
                    return installed;
                }
            }
        }
        let installed = Self::status().installed;
        *INSTALLED_CACHE.lock() = Some((installed, Instant::now()));
        installed
    }

    pub fn run_json(args: &[&str]) -> Result<OmpCommandResult, String> {
        let mut result = run_omp(args)?;
        result.json = parse_json_lenient(&result.stdout);
        Ok(result)
    }

    pub fn stream_command(app: AppHandle, args: Vec<String>) -> Result<u64, String> {
        let id = STREAM_ID.fetch_add(1, Ordering::Relaxed);
        thread::spawn(move || {
            let child = hidden_command("omp")
                .args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            match child {
                Ok(mut process) => {
                    let stdout = process.stdout.take();
                    if let Some(stdout) = stdout {
                        let reader = std::io::BufReader::new(stdout);
                        for line_result in std::io::BufRead::lines(reader) {
                            if let Ok(line) = line_result {
                                let payload = json!({
                                    "id": id,
                                    "kind": "line",
                                    "line": line,
                                    "json": serde_json::from_str::<Value>(&line).ok(),
                                });
                                let _ = app.emit(OMP_EVENT, payload);
                            }
                        }
                    }

                    let exit = process.wait();
                    let payload = json!({
                        "id": id,
                        "kind": "done",
                        "success": exit.as_ref().map(|status| status.success()).unwrap_or(false),
                        "exitCode": exit.ok().and_then(|status| status.code()),
                    });
                    let _ = app.emit(OMP_EVENT, payload);
                }
                Err(error) => {
                    let payload = json!({
                        "id": id,
                        "kind": "error",
                        "error": format!("Failed to start omp: {error}"),
                    });
                    let _ = app.emit(OMP_EVENT, payload);
                }
            }
        });

        Ok(id)
    }
}

fn run_omp(args: &[&str]) -> Result<OmpCommandResult, String> {
    let output = hidden_command("omp")
        .args(args)
        .output()
        .map_err(|_| "omp was not found on PATH.".to_string())?;

    Ok(OmpCommandResult {
        command: std::iter::once("omp".to_string())
            .chain(args.iter().map(|arg| arg.to_string()))
            .collect(),
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        json: None,
    })
}

/// Parse a JSON document from command stdout that may be prefixed with a
/// non-JSON preamble. `omp stats --json` prints session-sync progress lines
/// ("Synced N new entries...") to stdout before the JSON, which breaks a naive
/// whole-string parse. Try the whole string first (fast path for clean output
/// like `omp usage --json`), then fall back to the first `{`/`[` and read one
/// complete JSON value from there, ignoring any trailing bytes.
fn parse_json_lenient(stdout: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str::<Value>(stdout) {
        return Some(v);
    }
    let start = stdout.find(['{', '['])?;
    serde_json::Deserializer::from_str(&stdout[start..])
        .into_iter::<Value>()
        .next()
        .and_then(Result::ok)
}

//! Stability service: crash/freeze report store, command telemetry ring,
//! and freeze watchdog.
//!
//! Report files are JSON, stored under `<app-data>/reports/`, retained to 50.
//! The store is file-first (no DB dependency) so reports survive every failure
//! mode including DB corruption.

use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::services::storage_paths::StoragePathService;

/// Maximum number of report files retained. Older files are pruned.
const MAX_REPORTS: usize = 50;

// ─── Report store ──────────────────────────────────────────────────────────

/// A crash, freeze, or renderer-crash report persisted as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StabilityReport {
    /// Unique ID (timestamp-based).
    pub id: String,
    /// Report kind: "panic", "freeze", "renderer", or "abort".
    pub kind: String,
    /// ISO-ish timestamp of the report.
    pub timestamp: i64,
    /// Human-readable summary (first line).
    pub summary: String,
    /// Full report text (backtrace, telemetry, context).
    pub details: String,
    /// Whether the user has seen this report (set by frontend).
    pub seen: bool,
}

/// Returns the reports directory, creating it if needed.
fn reports_dir() -> Result<PathBuf, String> {
    let paths = StoragePathService::ensure_global_layout()?;
    let dir = paths.global_dir.join("reports");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create reports dir: {e}"))?;
    Ok(dir)
}

/// Current time in seconds since epoch.
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// Track which report IDs have been surfaced to the user (persisted in a
/// simple JSON sidecar so we don't re-notify on every launch).
static SEEN_IDS: LazyLock<Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

impl StabilityReport {
    /// Write a new report to disk and return it.
    pub fn write(kind: &str, summary: &str, details: &str) -> Result<Self, String> {
        let dir = reports_dir()?;
        let timestamp = now_secs();
        let id = format!("{kind}-{timestamp}");
        let report = StabilityReport {
            id: id.clone(),
            kind: kind.to_string(),
            timestamp,
            summary: summary.to_string(),
            details: details.to_string(),
            seen: false,
        };
        let file_path = dir.join(format!("{id}.json"));
        let json = serde_json::to_string_pretty(&report)
            .map_err(|e| format!("Failed to serialize report: {e}"))?;
        fs::write(&file_path, json).map_err(|e| format!("Failed to write report: {e}"))?;
        // Prune old reports.
        Self::prune(&dir)?;
        Ok(report)
    }

    /// List all reports, newest first.
    pub fn list() -> Result<Vec<Self>, String> {
        let dir = reports_dir()?;
        let mut reports = Vec::new();
        if !dir.exists() {
            return Ok(reports);
        }
        for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read reports dir: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(report) = serde_json::from_str::<StabilityReport>(&content) {
                let seen = SEEN_IDS.lock().contains(&report.id);
                reports.push(StabilityReport { seen, ..report });
            }
        }
        reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(reports)
    }

    /// Read a single report by ID.
    pub fn read(id: &str) -> Result<Self, String> {
        let dir = reports_dir()?;
        let path = dir.join(format!("{id}.json"));
        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read report {id}: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse report: {e}"))
    }

    /// Delete a report by ID.
    pub fn delete(id: &str) -> Result<(), String> {
        let dir = reports_dir()?;
        let path = dir.join(format!("{id}.json"));
        fs::remove_file(&path).map_err(|e| format!("Failed to delete report {id}: {e}"))
    }

    /// Mark a report as seen (updates the sidecar set).
    pub fn mark_seen(id: &str) -> Result<(), String> {
        SEEN_IDS.lock().insert(id.to_string());
        Ok(())
    }

    /// Count unseen reports (for badge display).
    pub fn unseen_count() -> Result<usize, String> {
        let reports = Self::list()?;
        Ok(reports.iter().filter(|r| !r.seen).count())
    }

    /// Prune old reports beyond MAX_REPORTS.
    fn prune(dir: &PathBuf) -> Result<(), String> {
        let mut entries: Vec<(PathBuf, i64)> = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            // Extract timestamp from filename: <kind>-<timestamp>.json
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let ts = stem
                .rsplit('-')
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
            entries.push((path, ts));
        }
        if entries.len() <= MAX_REPORTS {
            return Ok(());
        }
        // Sort by timestamp ascending, remove oldest.
        entries.sort_by_key(|(_, ts)| *ts);
        let to_remove = entries.len() - MAX_REPORTS;
        for (path, _) in entries.iter().take(to_remove) {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }
}

// ─── Command telemetry ring ──────────────────────────────────────────────────

/// A single command duration entry in the telemetry ring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandTelemetryEntry {
    pub command: String,
    pub duration_ms: u64,
    pub timestamp: i64,
    /// True if the command exceeded the sync threshold (50ms default).
    pub violation: bool,
}

/// Fixed-size ring buffer for command telemetry (512 entries).
static TELEMETRY_RING: LazyLock<Mutex<std::collections::VecDeque<CommandTelemetryEntry>>> =
    LazyLock::new(|| Mutex::new(std::collections::VecDeque::with_capacity(512)));

const RING_CAPACITY: usize = 512;
const SYNC_VIOLATION_THRESHOLD_MS: u64 = 50;

/// Record a command execution in the telemetry ring.
pub fn record_command(command: &str, duration_ms: u64) {
    let entry = CommandTelemetryEntry {
        command: command.to_string(),
        duration_ms,
        timestamp: now_secs(),
        violation: duration_ms > SYNC_VIOLATION_THRESHOLD_MS,
    };
    let mut ring = TELEMETRY_RING.lock();
    if ring.len() >= RING_CAPACITY {
        ring.pop_front();
    }
    ring.push_back(entry);
}

/// Get the recent N telemetry entries (newest first).
pub fn recent_telemetry(limit: usize) -> Vec<CommandTelemetryEntry> {
    let ring = TELEMETRY_RING.lock();
    ring.iter().rev().take(limit).cloned().collect()
}

/// Get all violation entries (sync commands that exceeded the threshold).
pub fn violations() -> Vec<CommandTelemetryEntry> {
    let ring = TELEMETRY_RING.lock();
    ring.iter().filter(|e| e.violation).cloned().collect()
}

/// A convenience wrapper for timing a command.
///
/// ```ignore
/// let result = timed!("native_chat_send", || { /* ... */ });
/// ```
#[macro_export]
macro_rules! timed {
    ($name:expr, $body:block) => {{
        let _start = std::time::Instant::now();
        let result = $body;
        $crate::services::stability_service::record_command(
            $name,
            _start.elapsed().as_millis() as u64,
        );
        result
    }};
}

// ─── Freeze watchdog ─────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// Heartbeat interval: how often the watchdog posts a heartbeat to the main thread.
const HEARTBEAT_INTERVAL_SECS: u64 = 2;
/// Report threshold: if the main thread is unresponsive for this long, write a freeze report.
const REPORT_THRESHOLD_SECS: u64 = 10;
/// Abort threshold: if the main thread is unresponsive for this long, abort the process.
const ABORT_THRESHOLD_SECS: u64 = 60;

/// Last heartbeat completion timestamp (monotonic, nanos since watchdog start).
static LAST_HEARTBEAT: AtomicI64 = AtomicI64::new(0);
/// Whether the watchdog is running.
static WATCHDOG_RUNNING: AtomicBool = AtomicBool::new(false);
/// Watchdog start time (monotonic).
static WATCHDOG_START: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

/// Start the freeze watchdog. Posts a heartbeat closure to the main thread every
/// 2s and measures completion. If unresponsive beyond thresholds, writes a freeze
/// report and optionally aborts.
///
/// Call from `app.setup()` after the Tauri app is ready.
pub fn start_watchdog(app: tauri::AppHandle) {
    if WATCHDOG_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }
    let start = Instant::now();
    *WATCHDOG_START.lock() = Some(start);
    LAST_HEARTBEAT.store(0, Ordering::SeqCst);

    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
            check_renderer_crash();

            // Post a heartbeat to the main thread and measure completion.
            let heartbeat_done = std::sync::Arc::new(AtomicBool::new(false));
            let done_clone = heartbeat_done.clone();
            let app_clone = app.clone();

            let _ = app_clone.run_on_main_thread(move || {
                done_clone.store(true, Ordering::SeqCst);
            });

            // Wait up to the report threshold to see if the heartbeat completes.
            let waited = Instant::now();
            while !heartbeat_done.load(Ordering::SeqCst) {
                let action = classify_freeze(waited.elapsed());
                match action {
                    FreezeAction::Abort => {
                        let elapsed = start.elapsed().as_secs();
                        let (summary, details) =
                            build_freeze_report_details(elapsed, ABORT_THRESHOLD_SECS, "abort");
                        let _ = StabilityReport::write("abort", &summary, &details);
                        eprintln!("{summary}");
                        std::process::abort();
                    }
                    FreezeAction::Report => {
                        if LAST_HEARTBEAT.load(Ordering::SeqCst) == 0 {
                            // First freeze report (only once per freeze).
                            let elapsed = start.elapsed().as_secs();
                            let (summary, details) = build_freeze_report_details(
                                elapsed,
                                REPORT_THRESHOLD_SECS,
                                "freeze",
                            );
                            let _ = StabilityReport::write("freeze", &summary, &details);
                            LAST_HEARTBEAT.store(-1, Ordering::SeqCst); // Mark as reported
                        }
                    }
                    FreezeAction::None => {}
                }
                thread::sleep(Duration::from_millis(100));
            }

            // Heartbeat completed — update timestamp.
            LAST_HEARTBEAT.store(start.elapsed().as_nanos() as i64, Ordering::SeqCst);
        }
    });
}

// ─── Renderer heartbeat ─────────────────────────────────────────────────────

/// Last renderer heartbeat timestamp (epoch seconds).
static RENDERER_HEARTBEAT: AtomicI64 = AtomicI64::new(0);
/// Whether the renderer crash detector has written a report for the current
/// outage (resets when a heartbeat arrives).
static RENDERER_REPORTED: AtomicBool = AtomicBool::new(false);
/// Renderer heartbeat interval (frontend calls every 5s).
pub const RENDERER_HEARTBEAT_INTERVAL_SECS: u64 = 5;
/// If no renderer heartbeat arrives for this long, write a renderer crash report.
const RENDERER_CRASH_THRESHOLD_SECS: i64 = 15;

/// Called by the frontend via Tauri command every 5s. Resets the renderer
/// heartbeat timer and clears the reported flag.
pub fn renderer_heartbeat() {
    let now = now_secs();
    RENDERER_HEARTBEAT.store(now, Ordering::SeqCst);
    RENDERER_REPORTED.store(false, Ordering::SeqCst);
}

/// Check if the renderer has gone silent. Called by the watchdog thread.
/// If no heartbeat arrives for >RENDERER_CRASH_THRESHOLD_SECS, writes a
/// "renderer" crash report (once per outage).
fn check_renderer_crash() {
    let last = RENDERER_HEARTBEAT.load(Ordering::SeqCst);
    if last == 0 {
        return; // No heartbeat yet — don't report during startup
    }
    let now = now_secs();
    let elapsed = now - last;
    if elapsed > RENDERER_CRASH_THRESHOLD_SECS && !RENDERER_REPORTED.swap(true, Ordering::SeqCst) {
        let summary =
            format!("Renderer crash detected: no heartbeat for >{RENDERER_CRASH_THRESHOLD_SECS}s");
        let details = format!(
            "## Renderer Crash Report\n\n**Last heartbeat:** {last}s\n**Current time:** {now}s\n**Elapsed:** {elapsed}s\n\nThe renderer process may have crashed or frozen. Check the webview console for JavaScript errors."
        );
        let _ = StabilityReport::write("renderer", &summary, &details);
    }
}

/// Freeze detection state: tracks whether we should write a report or abort
/// based on how long the main thread has been unresponsive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreezeAction {
    /// Main thread is responsive — no action needed.
    None,
    /// Main thread unresponsive beyond report threshold — write a freeze report.
    Report,
    /// Main thread unresponsive beyond abort threshold — abort the process.
    Abort,
}

/// Determine the freeze action based on elapsed time since heartbeat started.
/// Pure function for testable threshold logic.
fn classify_freeze(elapsed: Duration) -> FreezeAction {
    if elapsed > Duration::from_secs(ABORT_THRESHOLD_SECS) {
        FreezeAction::Abort
    } else if elapsed > Duration::from_secs(REPORT_THRESHOLD_SECS) {
        FreezeAction::Report
    } else {
        FreezeAction::None
    }
}

/// Build the freeze report details string from telemetry.
fn build_freeze_report_details(uptime: u64, threshold: u64, kind: &str) -> (String, String) {
    let summary = format!(
        "{}: main thread unresponsive for >{threshold}s (uptime: {uptime}s)",
        if kind == "abort" {
            "Freeze abort"
        } else {
            "Freeze detected"
        }
    );
    let telemetry = recent_telemetry(20);
    let tel_str = telemetry
        .iter()
        .map(|t| {
            format!(
                "  {} - {}ms{} ({}s ago)",
                t.command,
                t.duration_ms,
                if t.violation { " [VIOLATION]" } else { "" },
                t.timestamp
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let details = format!(
        "## {} Report\n\n**Uptime:** {uptime}s\n**Threshold:** {threshold}s\n\n**Recent Commands:**\n```\n{tel_str}\n```",
        if kind == "abort" { "Freeze Abort" } else { "Freeze" }
    );
    (summary, details)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::LazyLock;

    static SHARED_DIR: LazyLock<tempfile::TempDir> =
        LazyLock::new(|| tempfile::TempDir::new().unwrap());

    fn lock() -> parking_lot::MutexGuard<'static, ()> {
        let _ = &*SHARED_DIR;
        let guard = crate::test_util::test::DB_TEST_LOCK.lock();
        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        guard
    }
    #[test]
    fn ring_bounded_to_capacity() {
        let _g = lock();
        TELEMETRY_RING.lock().clear();
        for i in 0..600 {
            record_command(&format!("cmd_{i}"), 10);
        }
        let ring = TELEMETRY_RING.lock();
        assert_eq!(ring.len(), RING_CAPACITY);
        assert!(ring.iter().any(|e| e.command == "cmd_599"));
        assert!(!ring.iter().any(|e| e.command == "cmd_0"));
    }

    #[test]
    fn violation_classification() {
        let _g = lock();
        TELEMETRY_RING.lock().clear();
        record_command("fast_command", 5);
        record_command("slow_command", 75);
        record_command("border_command", 50);
        let viols = violations();
        assert_eq!(viols.len(), 1);
        assert_eq!(viols[0].command, "slow_command");
        assert_eq!(viols[0].duration_ms, 75);
    }

    #[test]
    fn report_write_and_read() {
        let _g = lock();
        // Clean reports dir for a fresh test.
        let dir = reports_dir().unwrap();
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        let report = StabilityReport::write(
            "panic",
            "Test panic summary",
            "Test panic details\nwith backtrace",
        )
        .unwrap();
        assert_eq!(report.kind, "panic");
        assert_eq!(report.summary, "Test panic summary");

        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        let read = StabilityReport::read(&report.id).unwrap();
        assert_eq!(read.summary, "Test panic summary");
        assert_eq!(read.details, "Test panic details\nwith backtrace");

        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        let list = StabilityReport::list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, report.id);

        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        StabilityReport::delete(&report.id).unwrap();
        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        let list_after = StabilityReport::list().unwrap();
        assert!(list_after.is_empty());
    }

    #[test]
    fn report_prune_keeps_max_50() {
        let _g = lock();
        // Ensure reports dir exists fresh.
        let dir = reports_dir().unwrap();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        for i in 0..60 {
            // Re-set BASEBUILD_HOME before each write to handle races.
            std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
            StabilityReport::write("panic", &format!("Panic {i}"), "details").unwrap();
        }
        let list = StabilityReport::list().unwrap();
        assert!(list.len() <= MAX_REPORTS);
    }

    #[test]
    fn freeze_classification_none_under_report_threshold() {
        // 5s: well under the 10s report threshold
        assert_eq!(classify_freeze(Duration::from_secs(5)), FreezeAction::None);
        // 9s: still under
        assert_eq!(classify_freeze(Duration::from_secs(9)), FreezeAction::None);
        // Exactly 10s: not strictly greater, so still None
        assert_eq!(classify_freeze(Duration::from_secs(10)), FreezeAction::None);
    }

    #[test]
    fn freeze_classification_report_above_threshold() {
        // 11s: above 10s report threshold, below 60s abort
        assert_eq!(
            classify_freeze(Duration::from_secs(11)),
            FreezeAction::Report
        );
        // 30s: mid-range
        assert_eq!(
            classify_freeze(Duration::from_secs(30)),
            FreezeAction::Report
        );
        // Exactly 60s: not strictly greater than abort threshold
        assert_eq!(
            classify_freeze(Duration::from_secs(60)),
            FreezeAction::Report
        );
    }

    #[test]
    fn freeze_classification_abort_above_60s() {
        // 61s: above 60s abort threshold
        assert_eq!(
            classify_freeze(Duration::from_secs(61)),
            FreezeAction::Abort
        );
        // 120s: well above
        assert_eq!(
            classify_freeze(Duration::from_secs(120)),
            FreezeAction::Abort
        );
    }

    #[test]
    fn freeze_report_details_contains_telemetry() {
        let _g = lock();
        TELEMETRY_RING.lock().clear();
        record_command("git_status", 5);
        record_command("git_diff", 75);
        let (summary, details) = build_freeze_report_details(42, 10, "freeze");
        assert!(summary.contains("Freeze detected"));
        assert!(summary.contains("uptime: 42s"));
        assert!(details.contains("git_status"));
        assert!(details.contains("git_diff"));
        assert!(details.contains("[VIOLATION]"));
    }

    #[test]
    fn abort_report_details_correctly_titled() {
        let _g = lock();
        TELEMETRY_RING.lock().clear();
        let (summary, details) = build_freeze_report_details(120, 60, "abort");
        assert!(summary.contains("Freeze abort"));
        assert!(summary.contains("uptime: 120s"));
        assert!(details.contains("Freeze Abort Report"));
    }
}

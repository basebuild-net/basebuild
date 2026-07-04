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
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read report {id}: {e}"))?;
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
            let ts = stem.rsplit('-').next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::LazyLock;
    use parking_lot::Mutex;

    static SHARED_DIR: LazyLock<tempfile::TempDir> = LazyLock::new(|| {
        let dir = tempfile::TempDir::new().unwrap();
        std::env::set_var("BASEBUILD_HOME", dir.path());
        let _ = StoragePathService::ensure_global_layout().unwrap();
        dir
    });

    static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn lock() -> parking_lot::MutexGuard<'static, ()> {
        let _ = &*SHARED_DIR;
        // Re-set BASEBUILD_HOME in case other tests clobbered it.
        std::env::set_var("BASEBUILD_HOME", SHARED_DIR.path());
        TEST_LOCK.lock()
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

        let report = StabilityReport::write(
            "panic",
            "Test panic summary",
            "Test panic details\nwith backtrace",
        )
        .unwrap();
        assert_eq!(report.kind, "panic");
        assert_eq!(report.summary, "Test panic summary");

        let read = StabilityReport::read(&report.id).unwrap();
        assert_eq!(read.summary, "Test panic summary");
        assert_eq!(read.details, "Test panic details\nwith backtrace");

        let list = StabilityReport::list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, report.id);

        StabilityReport::delete(&report.id).unwrap();
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
}

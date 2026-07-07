use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::events::TERMINAL_OUTPUT;
use crate::models::terminal::TerminalSession;

/// Maximum scrollback buffer size per terminal session (512 KiB).
const SCROLLBACK_CAP: usize = 512 * 1024;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Child process handle. MUST be held alive for the lifetime of the session;
    /// dropping it on Windows ConPTY destroys the pseudoconsole and kills the
    /// shell, causing the reader to get EOF and the terminal to appear dead.
    child: Box<dyn portable_pty::Child + Send + Sync>,
    shell: String,
    cwd: Option<String>,
    pid: Option<u32>,
    rows: u16,
    cols: u16,
    started_at: u64,
    /// Bounded scrollback buffer for replay when a listener attaches after
    /// the PTY has already produced output (e.g. startup prompt lost due to
    /// StrictMode double-mount or late xterm.js attach).
    scrollback: Arc<Mutex<VecDeque<u8>>>,
    /// Monotonic sequence number for output events. Incremented on every
    /// PTY read; emitted with each `data` event so the frontend can
    /// deduplicate replayed bytes against live events.
    seq: Arc<AtomicU64>,
}

impl PtySession {
    fn to_session(&self, id: u64, alive: bool) -> TerminalSession {
        TerminalSession {
            id,
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            pid: self.pid,
            rows: self.rows,
            cols: self.cols,
            started_at: self.started_at,
            alive,
        }
    }
}

#[derive(Default)]
pub struct TerminalManager {
    next_id: u64,
    sessions: HashMap<u64, PtySession>,
}

impl TerminalManager {
    pub fn create(
        &mut self,
        app: AppHandle,
        shell: &str,
        cwd: Option<&str>,
    ) -> Result<TerminalSession, String> {
        let id = self.next_id;
        self.next_id += 1;

        eprintln!("[terminal] create: id={} shell={} cwd={:?}", id, shell, cwd);

        let rows: u16 = 24;
        let cols: u16 = 80;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to open pty: {error}"))?;

        let mut cmd = CommandBuilder::new(shell);
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|error| format!("Failed to spawn shell: {error}"))?;

        let pid = child.process_id();

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| format!("Failed to take writer: {error}"))?,
        ));
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Failed to clone reader: {error}"))?;

        let scrollback: Arc<Mutex<VecDeque<u8>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(SCROLLBACK_CAP)));
        let seq: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));

        let session_id = id;
        let output_app = app.clone();
        let reader_scrollback = scrollback.clone();
        let reader_seq = seq.clone();
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        let _ = output_app.emit(
                            TERMINAL_OUTPUT,
                            json!({
                                "id": session_id,
                                "kind": "close",
                            }),
                        );
                        break;
                    }
                    Ok(count) => {
                        let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                        // Buffer output for replay.
                        if let Ok(mut sb) = reader_scrollback.lock() {
                            let remaining = SCROLLBACK_CAP.saturating_sub(sb.len());
                            if count <= remaining {
                                sb.extend(buffer[..count].iter().copied());
                            } else {
                                // Evict oldest bytes to make room.
                                let overflow = count - remaining;
                                for _ in 0..overflow {
                                    sb.pop_front();
                                }
                                sb.extend(buffer[..count].iter().copied());
                            }
                        }
                        let current_seq = reader_seq.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = output_app.emit(
                            TERMINAL_OUTPUT,
                            json!({
                                "id": session_id,
                                "kind": "data",
                                "data": data,
                                "seq": current_seq,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
        let started_at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let session = PtySession {
            master: pair.master,
            writer,
            child,
            shell: shell.to_string(),
            cwd: cwd.map(str::to_string),
            pid,
            rows,
            cols,
            started_at,
            scrollback,
            seq,
        };

        let session_info = session.to_session(id, true);
        self.sessions.insert(id, session);

        Ok(session_info)
    }

    pub fn write(&self, id: u64, data: &str) -> Result<(), String> {
        let session = self.sessions.get(&id).ok_or("Terminal session not found")?;
        eprintln!("[terminal] write: id={} {} bytes", id, data.len());
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Terminal writer poisoned")?;
        eprintln!("[terminal] write: id={} {} bytes: {:?}", id, data.len(), data.chars().take(40).collect::<String>());
        writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("Failed to write to terminal: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush terminal: {error}"))?;
        Ok(())
    }

    pub fn resize(&mut self, id: u64, rows: u16, cols: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or("Terminal session not found")?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize terminal: {error}"))?;

        session.rows = rows;
        session.cols = cols;
        Ok(())
    }

    /// Return the scrollback buffer and current seq for replay. The frontend
    /// calls this after attaching its event listener to catch any PTY output
    /// that was produced before the listener was registered (e.g. the shell
    /// startup prompt). Bytes with `seq <= last_seen` can be dropped by the
    /// frontend to avoid duplicates.
    pub fn replay(&self, id: u64) -> Result<TerminalReplay, String> {
        let session = self.sessions.get(&id).ok_or("Terminal session not found")?;
        let data = session
            .scrollback
            .lock()
            .map(|sb| {
                let bytes: Vec<u8> = sb.iter().copied().collect();
                String::from_utf8_lossy(&bytes).to_string()
            })
            .map_err(|_| "Terminal scrollback poisoned")?;
        let last_seq = session.seq.load(Ordering::SeqCst);
        Ok(TerminalReplay { data, last_seq })
    }

    pub fn close(&mut self, id: u64) -> Result<(), String> {
        let session = self
            .sessions
            .remove(&id)
            .ok_or("Terminal session not found")?;
        // Explicitly kill the child process before dropping handles.
        let _ = session.child.clone_killer().kill();
        drop(session.child);
        drop(session.master);
        drop(session.writer);
        Ok(())
    }

    pub fn list(&self) -> Vec<TerminalSession> {
        self.sessions
            .iter()
            .map(|(id, s)| s.to_session(*id, true))
            .collect()
    }
}

/// Scrollback replay result returned by `terminal_replay`.
pub struct TerminalReplay {
    pub data: String,
    pub last_seq: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrollback_cap_evicts_oldest_bytes() {
        // Simulate the scrollback eviction logic: when the buffer is full,
        // oldest bytes are evicted to make room for new ones.
        let mut sb: VecDeque<u8> = VecDeque::with_capacity(SCROLLBACK_CAP);
        // Fill to capacity.
        sb.extend(std::iter::repeat(0x41).take(SCROLLBACK_CAP));
        assert_eq!(sb.len(), SCROLLBACK_CAP);

        // Write 100 new bytes — should evict 100 oldest.
        let count = 100;
        let remaining = SCROLLBACK_CAP.saturating_sub(sb.len());
        if count > remaining {
            let overflow = count - remaining;
            for _ in 0..overflow {
                sb.pop_front();
            }
        }
        sb.extend(std::iter::repeat(0x42).take(count));
        assert_eq!(sb.len(), SCROLLBACK_CAP, "buffer should stay at cap");
        // Oldest 100 bytes (0x41) were evicted; remaining old bytes at front.
        assert_eq!(sb[0], 0x41, "remaining old bytes should be at front");
        // New bytes (0x42) are at the back.
        assert_eq!(sb[SCROLLBACK_CAP - 100], 0x42, "new bytes should be at the back");
        assert_eq!(sb[SCROLLBACK_CAP - 1], 0x42, "last byte should be new");
    }

    #[test]
    fn seq_is_monotonic() {
        // The seq counter uses fetch_add with SeqCst ordering, guaranteeing
        // monotonicity. Verify the atomic increments correctly.
        let seq = Arc::new(AtomicU64::new(0));
        let s1 = seq.fetch_add(1, Ordering::SeqCst) + 1;
        let s2 = seq.fetch_add(1, Ordering::SeqCst) + 1;
        let s3 = seq.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(s1 < s2 && s2 < s3, "seq should be monotonic: {s1} < {s2} < {s3}");
        assert_eq!(s1, 1);
        assert_eq!(s2, 2);
        assert_eq!(s3, 3);
    }
}

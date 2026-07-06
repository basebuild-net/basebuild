use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::events::TERMINAL_OUTPUT;
use crate::models::terminal::TerminalSession;

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

        eprintln!("[terminal] create: openpty ok");

        let mut cmd = CommandBuilder::new(shell);
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|error| {
                eprintln!("[terminal] create: spawn_command FAILED: {}", error);
                format!("Failed to spawn shell: {error}")
            })?;

        let pid = child.process_id();
        eprintln!("[terminal] create: spawn_command ok, pid={:?}", pid);

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| format!("Failed to take writer: {error}"))?,
        ));
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Failed to clone reader: {error}"))?;

        eprintln!("[terminal] create: writer+reader ready, starting reader thread");

        let session_id = id;
        let output_app = app.clone();
        thread::spawn(move || {
            eprintln!("[terminal] reader thread: started for id={}", session_id);
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        eprintln!("[terminal] reader thread: EOF for id={}", session_id);
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
                        eprintln!("[terminal] reader thread: {} bytes for id={}: {:?}", count, session_id, data.chars().take(80).collect::<String>());
                        let _ = output_app.emit(
                            TERMINAL_OUTPUT,
                            json!({
                                "id": session_id,
                                "kind": "data",
                                "data": data,
                            }),
                        );
                    }
                    Err(e) => {
                        eprintln!("[terminal] reader thread: ERROR for id={}: {}", session_id, e);
                        break;
                    }
                }
            }
            eprintln!("[terminal] reader thread: exiting for id={}", session_id);
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
        };

        let session_info = session.to_session(id, true);
        self.sessions.insert(id, session);

        Ok(session_info)
    }

    pub fn write(&self, id: u64, data: &str) -> Result<(), String> {
        let session = self.sessions.get(&id).ok_or("Terminal session not found")?;

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

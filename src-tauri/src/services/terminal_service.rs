use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::events::TERMINAL_OUTPUT;
use crate::models::terminal::TerminalSession;

#[derive(Default)]
pub struct TerminalManager {
    next_id: u64,
    sessions: HashMap<u64, PtySession>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
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

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to open pty: {error}"))?;

        let mut cmd = CommandBuilder::new(shell);
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|error| format!("Failed to spawn shell: {error}"))?;

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| format!("Failed to take writer: {error}"))?,
        ));
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Failed to clone reader: {error}"))?;

        let session_id = id;
        let output_app = app.clone();
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
                        let _ = output_app.emit(
                            TERMINAL_OUTPUT,
                            json!({
                                "id": session_id,
                                "kind": "data",
                                "data": data,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });

        let master = pair.master;
        self.sessions.insert(
            id,
            PtySession {
                master,
                writer,
            },
        );

        Ok(TerminalSession {
            id,
            shell: shell.to_string(),
            cwd: cwd.map(str::to_string),
        })
    }

    pub fn write(&self, id: u64, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get(&id)
            .ok_or("Terminal session not found")?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Terminal writer poisoned")?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("Failed to write to terminal: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush terminal: {error}"))?;
        Ok(())
    }

    pub fn resize(&self, id: u64, rows: u16, cols: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(&id)
            .ok_or("Terminal session not found")?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize terminal: {error}"))
    }

    pub fn close(&mut self, id: u64) -> Result<(), String> {
        self.sessions
            .remove(&id)
            .ok_or("Terminal session not found")?;
        Ok(())
    }
}

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

const AGENT_OUTPUT: &str = "agent://output";

/// A running agent chat session.
struct AgentSession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    _shell: String,
}

/// Manages agent chat sessions (OMP, Claude Code, Codex CLI, etc.)
/// Currently only OhMyPi is supported, but the architecture is agent-agnostic.
#[derive(Default)]
pub struct AgentManager {
    next_id: u64,
    sessions: HashMap<u64, AgentSession>,
}

impl AgentManager {
    pub fn start(&mut self, app: AppHandle, cwd: &str) -> Result<u64, String> {
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
            .map_err(|e| format!("Failed to open pty: {e}"))?;

        // Spawn omp in interactive mode
        let mut cmd = CommandBuilder::new("omp");
        cmd.cwd(cwd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn omp: {e}. Is oh-my-pi installed and on PATH?"))?;

        let _pid = child.process_id();

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|e| format!("Failed to take writer: {e}"))?,
        ));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        let session_id = id;
        let output_app = app.clone();
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        let _ = output_app.emit(
                            AGENT_OUTPUT,
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
                            AGENT_OUTPUT,
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

        let session = AgentSession {
            master: pair.master,
            writer,
            child,
            _shell: "omp".to_string(),
        };

        self.sessions.insert(id, session);
        Ok(id)
    }

    pub fn send(&self, id: u64, message: &str) -> Result<(), String> {
        let session = self.sessions.get(&id).ok_or("Agent session not found")?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| format!("Failed to lock writer: {e}"))?;
        writer
            .write_all(format!("{message}\n").as_bytes())
            .map_err(|e| format!("Failed to write to agent: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush: {e}"))?;
        Ok(())
    }

    pub fn stop(&mut self, id: u64) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(&id)
            .ok_or("Agent session not found")?;
        // Kill the child process (omp.exe) so it doesn't linger as an orphan
        let _ = session.child.kill();
        Ok(())
    }
}

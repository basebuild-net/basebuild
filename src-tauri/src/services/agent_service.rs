use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::models::runtime::{AgentCapability, RuntimeProfile, RuntimeProfileKind};
use crate::services::settings_service::SettingsService;

const AGENT_OUTPUT: &str = "agent://output";

/// A running agent chat session.
struct AgentSession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    profile_id: String,
}

/// Manages agent chat sessions. Uses runtime profiles so any chat adapter
/// (OMP, Basebuild CLI, future IDEs) can be supported without changing the
/// chat UI contract.
#[derive(Default)]
pub struct AgentManager {
    next_id: u64,
    sessions: HashMap<u64, AgentSession>,
}

impl AgentManager {
    pub fn start(
        &mut self,
        app: AppHandle,
        cwd: &str,
        profile_id: Option<&str>,
        _model: Option<&str>,
    ) -> Result<u64, String> {
        let id = self.next_id;
        self.next_id += 1;

        // Resolve the profile: use the given ID or fall back to the default chat profile.
        let profiles = SettingsService::list_profiles()?;
        let defaults = SettingsService::get_defaults()?;
        let effective_id = profile_id
            .map(|s| s.to_string())
            .or(defaults.default_chat_profile_id)
            .unwrap_or_else(|| "omp".to_string());

        let profile = profiles
            .into_iter()
            .find(|p| p.id == effective_id)
            .ok_or_else(|| {
                format!("Chat profile '{effective_id}' not found. Check settings.")
            })?;

        if profile.kind != RuntimeProfileKind::Chat {
            return Err(format!(
                "Profile '{}' is not a chat profile.",
                profile.label
            ));
        }

        // Validate the executable exists before spawning.
        if which::which(&profile.executable).is_err() {
            return Err(format!(
                "Adapter '{}' executable '{}' was not found on PATH. Install it or select a different chat profile in Settings.",
                profile.label, profile.executable
            ));
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {e}"))?;

        let mut cmd = CommandBuilder::new(&profile.executable);
        for arg in &profile.args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                format!(
                    "Failed to spawn '{}': {e}. Is '{}' installed and on PATH?",
                    profile.label, profile.executable
                )
            })?;

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
            profile_id: profile.id.clone(),
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
        self.sessions
            .remove(&id)
            .ok_or("Agent session not found")?;
        Ok(())
    }
}

/// Returns the capabilities of a profile, or a typed error if unsupported.
pub fn profile_capabilities(profile: &RuntimeProfile) -> Vec<AgentCapability> {
    profile.capabilities.clone()
}

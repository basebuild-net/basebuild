use std::sync::Mutex;
use std::time::SystemTime;

use crate::services::terminal_service::TerminalManager;

pub struct AppState {
    pub started_at: SystemTime,
    pub terminals: Mutex<TerminalManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            started_at: SystemTime::now(),
            terminals: Mutex::default(),
        }
    }
}

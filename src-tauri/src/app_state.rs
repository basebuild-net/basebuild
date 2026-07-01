use std::sync::Mutex;

use crate::services::terminal_service::TerminalManager;

pub struct AppState {
    pub terminals: Mutex<TerminalManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            terminals: Mutex::default(),
        }
    }
}

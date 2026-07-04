use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::services::mcp_service::McpService;
use crate::services::terminal_service::TerminalManager;

pub struct AppState {
    pub terminals: Mutex<TerminalManager>,
    /// Per-project MCP service instances. Keyed by project path.
    /// Each project gets its own `McpService` that loads that project's
    /// `mcp.json` configs and manages its own connections.
    pub mcp_services: Mutex<HashMap<String, Arc<McpService>>>,
}

impl AppState {
    /// Get or create the MCP service for a project path.
    pub fn get_or_create_mcp_service(&self, project_path: &str) -> Arc<McpService> {
        let mut services = self.mcp_services.lock();
        if let Some(svc) = services.get(project_path) {
            return svc.clone();
        }
        let svc = Arc::new(McpService::new(PathBuf::from(project_path)));
        services.insert(project_path.to_string(), svc.clone());
        svc
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            terminals: Mutex::default(),
            mcp_services: Mutex::new(HashMap::new()),
        }
    }
}

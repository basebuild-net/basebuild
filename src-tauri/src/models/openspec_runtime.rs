use serde::{Deserialize, Serialize};

/// Health state of the OpenSpec toolchain for a project.
///
/// - `missing` — no executable found; plans that need OpenSpec are blocked.
/// - `ready` — executable detected and project has an `openspec/` directory.
/// - `installing` — an install/update is in progress (future; stubs return
///   `missing` with an actionable message until a source is selected).
/// - `error` — detection or validation failed with a specific message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSpecRuntimeStatus {
    /// One of: `missing`, `ready`, `installing`, `error`.
    pub state: String,
    /// Detected OpenSpec version string, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Absolute path to the detected executable, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    /// Detected schema name (e.g. `spec-driven`), if resolvable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// Whether the project path has a valid `openspec/` directory.
    pub project_ready: bool,
    /// Human-readable detail: actionable guidance when `state` is not `ready`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Default for OpenSpecRuntimeStatus {
    fn default() -> Self {
        Self {
            state: "missing".to_string(),
            version: None,
            executable_path: None,
            schema: None,
            project_ready: false,
            message: Some("OpenSpec runtime not configured.".to_string()),
        }
    }
}

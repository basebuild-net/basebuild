use serde::{Deserialize, Serialize};

/// Connector lifecycle states.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorState {
    /// Registered but not started.
    Registered,
    /// Launching/attaching in progress.
    Connecting,
    /// Connected and capable.
    Connected,
    /// Disconnected (user-initiated or crash).
    Disconnected,
    /// Connector reported an error or crashed.
    Error,
    /// Unsupported on this platform/config.
    Unsupported,
}

impl ConnectorState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Disconnected => "disconnected",
            Self::Error => "error",
            Self::Unsupported => "unsupported",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "connecting" => Self::Connecting,
            "connected" => Self::Connected,
            "error" => Self::Error,
            "unsupported" => Self::Unsupported,
            _ => Self::Disconnected,
        }
    }
}

/// Transport options for connector IPC.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorTransport {
    /// stdio (child process).
    Stdio,
    /// Loopback HTTP/WebSocket.
    Loopback,
    /// PTY-backed terminal observation (no structured IPC).
    Pty,
}

impl ConnectorTransport {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stdio => "stdio",
            Self::Loopback => "loopback",
            Self::Pty => "pty",
        }
    }
}

/// Connector capability names. Each maps to a permission scope.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorCapability {
    /// Execute commands on behalf of the connector.
    Command,
    /// Read/write files within the workspace.
    FileAccess,
    /// Claim a provider subscription exists (e.g. "OMP has OpenAI connected").
    ProviderClaim,
    /// Sync chat sessions into Basebuild.
    ChatSync,
    /// Embed a web UI or collaboration surface.
    WebBridge,
    /// Report diagnostics.
    Diagnostics,
    /// Report analytics events.
    Analytics,
    /// Expose skills/commands.
    Skills,
}

impl ConnectorCapability {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::FileAccess => "file_access",
            Self::ProviderClaim => "provider_claim",
            Self::ChatSync => "chat_sync",
            Self::WebBridge => "web_bridge",
            Self::Diagnostics => "diagnostics",
            Self::Analytics => "analytics",
            Self::Skills => "skills",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "command" => Some(Self::Command),
            "file_access" => Some(Self::FileAccess),
            "provider_claim" => Some(Self::ProviderClaim),
            "chat_sync" => Some(Self::ChatSync),
            "web_bridge" => Some(Self::WebBridge),
            "diagnostics" => Some(Self::Diagnostics),
            "analytics" => Some(Self::Analytics),
            "skills" => Some(Self::Skills),
            _ => None,
        }
    }
}

/// A connector manifest: describes a tool that can plug into Basebuild.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorManifest {
    /// Unique connector id (e.g. "omp", "claude-code").
    pub id: String,
    /// Display name.
    pub name: String,
    /// Version string.
    pub version: String,
    /// Transport type.
    pub transport: ConnectorTransport,
    /// Capabilities the connector claims to support.
    pub capabilities: Vec<ConnectorCapability>,
    /// Detection command (e.g. "omp" — checked on PATH).
    pub detect_command: Option<String>,
    /// Launch command for stdio/loopback transports.
    pub launch_command: Option<String>,
    /// Whether the connector is trusted (built-in vs third-party).
    pub trusted: bool,
    /// Default enabled state.
    pub default_enabled: bool,
}

/// A registered connector instance with lifecycle state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    pub id: String,
    pub manifest_id: String,
    pub name: String,
    pub version: String,
    pub transport: ConnectorTransport,
    pub capabilities: Vec<ConnectorCapability>,
    pub state: ConnectorState,
    pub trusted: bool,
    pub enabled: bool,
    pub project_path: Option<String>,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A permission request from a connector for a specific capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorPermissionRequest {
    pub connector_id: String,
    pub capability: ConnectorCapability,
    /// Human-readable description of what the connector wants to do.
    pub description: String,
    /// Capability-specific payload (e.g. provider name for provider_claim).
    pub payload: serde_json::Value,
}

/// The broker's decision for a connector permission request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorGrantDecision {
    pub connector_id: String,
    pub capability: ConnectorCapability,
    pub decision: crate::models::permission::PermissionDecision,
    /// Whether this grant persists for the session or project.
    pub scope: ConnectorGrantScope,
    /// Audit trail entry id.
    pub audit_id: Option<String>,
}

/// Grant scope: how long the permission lasts.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorGrantScope {
    /// One-time: ask again next time.
    Once,
    /// Session-scoped: persists until the session ends.
    Session,
    /// Project-scoped: persists in settings.
    Project,
}

impl ConnectorGrantScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Once => "once",
            Self::Session => "session",
            Self::Project => "project",
        }
    }
}

/// A provider claim: a connector reports a provider subscription exists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderClaim {
    pub id: String,
    pub connector_id: String,
    pub provider_id: String,
    pub provider_label: String,
    /// Whether the user has approved importing this provider.
    pub approved: bool,
    /// Whether the user has explicitly denied this claim.
    pub denied: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Connector event payload (emitted on the `connector://event` channel).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorEvent {
    pub connector_id: String,
    pub event_type: ConnectorEventType,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorEventType {
    StateChanged,
    CapabilityReady,
    ProviderClaimed,
    ChatSynced,
    Diagnostic,
    Error,
    PermissionRequested,
}

impl ConnectorEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateChanged => "state_changed",
            Self::CapabilityReady => "capability_ready",
            Self::ProviderClaimed => "provider_claimed",
            Self::ChatSynced => "chat_synced",
            Self::Diagnostic => "diagnostic",
            Self::Error => "error",
            Self::PermissionRequested => "permission_requested",
        }
    }
}

/// Typed connector error codes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorError {
    /// Connector not found in registry.
    NotFound,
    /// Connector not enabled.
    NotEnabled,
    /// Capability not supported by this connector.
    UnsupportedCapability,
    /// Permission denied by the broker.
    PermissionDenied,
    /// Connector process crashed or is unreachable.
    ConnectionLost,
    /// Manifest validation failed.
    InvalidManifest,
    /// Transport error.
    TransportError,
}

impl ConnectorError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::NotEnabled => "not_enabled",
            Self::UnsupportedCapability => "unsupported_capability",
            Self::PermissionDenied => "permission_denied",
            Self::ConnectionLost => "connection_lost",
            Self::InvalidManifest => "invalid_manifest",
            Self::TransportError => "transport_error",
        }
    }
}

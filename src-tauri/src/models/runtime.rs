use serde::{Deserialize, Serialize};

/// Capabilities an agent adapter can expose. Used by the chat UI to degrade
/// gracefully when an adapter does not support a feature.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AgentCapability {
    Chat,
    Messages,
    Skills,
    Providers,
    Commands,
    Info,
}

#[allow(dead_code)]
 impl AgentCapability {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Messages => "messages",
            Self::Skills => "skills",
            Self::Providers => "providers",
            Self::Commands => "commands",
            Self::Info => "info",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "chat" => Some(Self::Chat),
            "messages" => Some(Self::Messages),
            "skills" => Some(Self::Skills),
            "providers" => Some(Self::Providers),
            "commands" => Some(Self::Commands),
            "info" => Some(Self::Info),
            _ => None,
        }
    }

    /// Default OMP capabilities — OMP supports all known capabilities.
    pub fn omp_defaults() -> Vec<Self> {
        vec![
            Self::Chat,
            Self::Messages,
            Self::Skills,
            Self::Providers,
            Self::Commands,
            Self::Info,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeProfileKind {
    Chat,
    Terminal,
}

impl RuntimeProfileKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Terminal => "terminal",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "terminal" => Self::Terminal,
            _ => Self::Chat,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkingDirectoryMode {
    Project,
    Home,
    Custom,
}

impl WorkingDirectoryMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Home => "home",
            Self::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "home" => Self::Home,
            "custom" => Self::Custom,
            _ => Self::Project,
        }
    }
}

/// A runtime profile describes how to launch an agent or terminal integration.
/// Profiles are persisted locally and validated before use.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfile {
    pub id: String,
    pub kind: RuntimeProfileKind,
    pub label: String,
    pub executable: String,
    pub args: Vec<String>,
    pub working_directory_mode: WorkingDirectoryMode,
    pub default_model: Option<String>,
    pub capabilities: Vec<AgentCapability>,
    pub built_in: bool,
}

impl RuntimeProfile {
    /// The default OMP chat profile used on fresh installs.
    pub fn default_omp() -> Self {
        Self {
            id: "omp".to_string(),
            kind: RuntimeProfileKind::Chat,
            label: "OhMyPi (OMP)".to_string(),
            executable: "omp".to_string(),
            args: vec![],
            working_directory_mode: WorkingDirectoryMode::Project,
            default_model: None,
            capabilities: AgentCapability::omp_defaults(),
            built_in: true,
        }
    }

    /// The default terminal profile for the current platform.
    pub fn default_terminal() -> Self {
        let shell = if cfg!(target_os = "windows") {
            "powershell.exe"
        } else {
            "bash"
        };
        Self {
            id: "default-terminal".to_string(),
            kind: RuntimeProfileKind::Terminal,
            label: "Default Terminal".to_string(),
            executable: shell.to_string(),
            args: vec![],
            working_directory_mode: WorkingDirectoryMode::Project,
            default_model: None,
            capabilities: vec![],
            built_in: true,
        }
    }

     /// A placeholder Basebuild CLI profile — not selectable until validated.
    #[allow(dead_code)]
     pub fn basebuild_cli_placeholder() -> Self {
        Self {
            id: "basebuild-cli".to_string(),
            kind: RuntimeProfileKind::Chat,
            label: "Basebuild CLI (future)".to_string(),
            executable: "basebuild".to_string(),
            args: vec![],
            working_directory_mode: WorkingDirectoryMode::Project,
            default_model: None,
            capabilities: vec![AgentCapability::Chat],
            built_in: true,
        }
    }

    /// Built-in profiles seeded on first run.
    pub fn built_ins() -> Vec<Self> {
        vec![Self::default_omp(), Self::default_terminal()]
    }
}

/// Persisted application defaults. Stored as a single key-value table in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDefaults {
    pub default_chat_profile_id: Option<String>,
    pub default_terminal_profile_id: Option<String>,
    pub default_model: Option<String>,
    pub auto_send_generated_prompts: bool,
}

impl RuntimeDefaults {
    /// Conservative defaults used on fresh install or after reset.
    pub fn conservative() -> Self {
        Self {
            default_chat_profile_id: Some("omp".to_string()),
            default_terminal_profile_id: Some("default-terminal".to_string()),
            default_model: None,
            auto_send_generated_prompts: false,
        }
    }
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Per-provider run concurrency + subagent governance (`run-concurrency-limits`).
///
/// A `RunConcurrencyLimits` map holds one entry per provider id. Providers
/// not in the map use the conservative default (max concurrency `1`,
/// subagents off). The global defaults live in `app_defaults` under the
/// `run_concurrency` key; per-project overrides live in
/// `run_concurrency_overrides`.
///
/// `planning_max` and `global_max` are optional cross-provider caps stored
/// alongside the provider map. When `None` they read as the defaults
/// (`planning_max = 3`, `global_max = 4`). `planning_max` caps the total
/// concurrent plan runs across all providers; `global_max` caps the total
/// concurrent runs of any kind (plan + pipeline).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConcurrencyLimits {
    /// Map of provider id → limit. Absent providers read as the default.
    #[serde(default)]
    pub providers: HashMap<String, RunConcurrencyEntry>,
    /// Cap on the total concurrent plan runs across all providers. `None`
    /// reads as `DEFAULT_PLANNING_MAX` (3). When the active plan-run count
    /// (running + pending) reaches this, new plan runs are queued as
    /// `pending` instead of started.
    #[serde(default)]
    pub planning_max: Option<u32>,
    /// Cap on the total concurrent runs of any kind (plan + pipeline) across
    /// all providers. `None` reads as `DEFAULT_GLOBAL_MAX` (4). When the
    /// active run count reaches this, new runs (plan or pipeline) are
    /// queued/refused instead of started.
    #[serde(default)]
    pub global_max: Option<u32>,
}

/// Default planning concurrency cap: at most 3 plan runs running at once.
pub const DEFAULT_PLANNING_MAX: u32 = 3;
/// Default global concurrency cap: at most 4 runs (plan + pipeline) at once,
/// leaving 1 slot of headroom for non-planning work.
pub const DEFAULT_GLOBAL_MAX: u32 = 4;

impl Default for RunConcurrencyLimits {
    fn default() -> Self {
        Self {
            providers: HashMap::new(),
            planning_max: None,
            global_max: None,
        }
    }
}

impl RunConcurrencyLimits {
    /// Conservative default: provider `1`, subagents off. Used when no
    /// global or project override exists.
    pub fn conservative() -> Self {
        Self::default()
    }

    /// Resolve the effective entry for a provider: project override entry,
    /// else global entry, else the conservative default.
    pub fn effective_for(
        &self,
        provider_id: &str,
        global: &RunConcurrencyLimits,
    ) -> RunConcurrencyEntry {
        self.providers
            .get(provider_id)
            .cloned()
            .or_else(|| global.providers.get(provider_id).cloned())
            .unwrap_or_default()
    }

    /// Effective planning concurrency cap: the configured value or the
    /// default (`DEFAULT_PLANNING_MAX`) when `None`.
    pub fn effective_planning_max(&self) -> u32 {
        self.planning_max.unwrap_or(DEFAULT_PLANNING_MAX)
    }

    /// Effective global concurrency cap: the configured value or the
    /// default (`DEFAULT_GLOBAL_MAX`) when `None`.
    pub fn effective_global_max(&self) -> u32 {
        self.global_max.unwrap_or(DEFAULT_GLOBAL_MAX)
    }
}

/// Cross-provider concurrency caps surfaced by the `get_concurrency_limits`
/// / `set_concurrency_limits` commands. Mirrors the `planning_max` /
/// `global_max` fields on `RunConcurrencyLimits`; `None` reads as the
/// defaults (`planning_max = 3`, `global_max = 4`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrencyLimits {
    #[serde(default)]
    pub global_max: Option<u32>,
    #[serde(default)]
    pub planning_max: Option<u32>,
}

impl Default for ConcurrencyLimits {
    fn default() -> Self {
        Self {
            global_max: None,
            planning_max: None,
        }
    }
}

impl ConcurrencyLimits {
    /// Conservative default — both caps unset, so the effective defaults
    /// (`planning_max = 3`, `global_max = 4`) apply.
    pub fn conservative() -> Self {
        Self::default()
    }

    /// Effective planning cap (configured or `DEFAULT_PLANNING_MAX`).
    pub fn effective_planning_max(&self) -> u32 {
        self.planning_max.unwrap_or(DEFAULT_PLANNING_MAX)
    }

    /// Effective global cap (configured or `DEFAULT_GLOBAL_MAX`).
    pub fn effective_global_max(&self) -> u32 {
        self.global_max.unwrap_or(DEFAULT_GLOBAL_MAX)
    }
}

impl From<&RunConcurrencyLimits> for ConcurrencyLimits {
    fn from(limits: &RunConcurrencyLimits) -> Self {
        Self {
            global_max: limits.global_max,
            planning_max: limits.planning_max,
        }
    }
}

/// One provider's concurrency + subagent settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConcurrencyEntry {
    /// Max simultaneous in-flight requests (plan runs + subagents) to this
    /// provider. Default `1` — most providers meter concurrency.
    #[serde(default = "default_concurrency")]
    pub max_concurrency: u32,
    /// Whether subagents are permitted at all. Default `false` — one model
    /// per chat, no delegated sub-sessions. Execution mechanics are owned by
    /// `harness-subagents`; this only governs permission + count.
    #[serde(default)]
    pub subagents_enabled: bool,
    /// Max concurrent subagents when enabled. Counted against the provider's
    /// `max_concurrency`. Default `0` (reads as "off" until enabled + set).
    #[serde(default)]
    pub subagent_max_count: u32,
}

impl Default for RunConcurrencyEntry {
    fn default() -> Self {
        Self {
            max_concurrency: 1,
            subagents_enabled: false,
            subagent_max_count: 0,
        }
    }
}

fn default_concurrency() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_conservative() {
        let e = RunConcurrencyEntry::default();
        assert_eq!(e.max_concurrency, 1);
        assert!(!e.subagents_enabled);
        assert_eq!(e.subagent_max_count, 0);
    }

    #[test]
    fn effective_for_prefers_project_override() {
        let mut global = RunConcurrencyLimits::default();
        global.providers.insert(
            "anthropic".to_string(),
            RunConcurrencyEntry {
                max_concurrency: 2,
                subagents_enabled: false,
                subagent_max_count: 0,
            },
        );
        let mut project = RunConcurrencyLimits::default();
        project.providers.insert(
            "anthropic".to_string(),
            RunConcurrencyEntry {
                max_concurrency: 1,
                subagents_enabled: true,
                subagent_max_count: 3,
            },
        );
        let eff = project.effective_for("anthropic", &global);
        assert_eq!(eff.max_concurrency, 1);
        assert!(eff.subagents_enabled);
        assert_eq!(eff.subagent_max_count, 3);
    }

    #[test]
    fn effective_for_falls_back_to_global() {
        let mut global = RunConcurrencyLimits::default();
        global.providers.insert(
            "openai".to_string(),
            RunConcurrencyEntry {
                max_concurrency: 4,
                subagents_enabled: true,
                subagent_max_count: 2,
            },
        );
        let project = RunConcurrencyLimits::default();
        let eff = project.effective_for("openai", &global);
        assert_eq!(eff.max_concurrency, 4);
        assert!(eff.subagents_enabled);
    }

    #[test]
    fn effective_for_falls_back_to_conservative() {
        let global = RunConcurrencyLimits::default();
        let project = RunConcurrencyLimits::default();
        let eff = project.effective_for("unknown", &global);
        assert_eq!(eff.max_concurrency, 1);
        assert!(!eff.subagents_enabled);
    }

    #[test]
    fn planning_global_max_default_when_unset() {
        let limits = RunConcurrencyLimits::default();
        assert_eq!(limits.effective_planning_max(), DEFAULT_PLANNING_MAX);
        assert_eq!(limits.effective_global_max(), DEFAULT_GLOBAL_MAX);
    }

    #[test]
    fn planning_global_max_respect_configured() {
        let limits = RunConcurrencyLimits {
            planning_max: Some(5),
            global_max: Some(8),
            ..Default::default()
        };
        assert_eq!(limits.effective_planning_max(), 5);
        assert_eq!(limits.effective_global_max(), 8);
    }

    #[test]
    fn concurrency_limits_command_shape_defaults() {
        let cmd = ConcurrencyLimits::default();
        assert_eq!(cmd.effective_planning_max(), DEFAULT_PLANNING_MAX);
        assert_eq!(cmd.effective_global_max(), DEFAULT_GLOBAL_MAX);
    }

    #[test]
    fn concurrency_limits_projected_from_run_limits() {
        let limits = RunConcurrencyLimits {
            planning_max: Some(2),
            global_max: Some(6),
            ..Default::default()
        };
        let cmd: ConcurrencyLimits = (&limits).into();
        assert_eq!(cmd.planning_max, Some(2));
        assert_eq!(cmd.global_max, Some(6));
    }
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Per-provider run concurrency + subagent governance (`run-concurrency-limits`).
///
/// A `RunConcurrencyLimits` map holds one entry per provider id. Providers
/// not in the map use the conservative default (max concurrency `1`,
/// subagents off). The global defaults live in `app_defaults` under the
/// `run_concurrency` key; per-project overrides live in
/// `run_concurrency_overrides`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConcurrencyLimits {
    /// Map of provider id → limit. Absent providers read as the default.
    #[serde(default)]
    pub providers: HashMap<String, RunConcurrencyEntry>,
}

impl Default for RunConcurrencyLimits {
    fn default() -> Self {
        Self {
            providers: HashMap::new(),
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
}

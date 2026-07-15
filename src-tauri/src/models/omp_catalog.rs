//! Vendored OMP (Oh My Pi) model catalog.
//!
//! `models.json` is embedded at compile time via `include_str!` and parsed
//! once into a `LazyLock`. It is the source of truth for bundled provider and
//! model definitions, replacing the hand-transcribed tables that previously
//! lived in `provider_model_catalog_service.rs`.
//!
//! The catalog is a map of provider id → (model id → model entry). Each entry
//! carries the wire-protocol kind (`api`), base URL, context window, max
//! tokens, reasoning flag, input modalities, and cost. Basebuild overlays
//! provider-level metadata (label, auth method, API-key URL) that OMP does not
//! carry — see `provider_overlays()` in `provider_model_catalog_service`.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

/// The content-hash version stamp of the vendored catalog (from `VERSION`),
/// used by cache-invalidation logic to detect stale bundled rows.
pub const CATALOG_VERSION: &str = include_str!("../../vendor/omp-catalog/VERSION");

const CATALOG_JSON: &str = include_str!("../../vendor/omp-catalog/models.json");

/// A single model entry in the OMP catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    /// Wire-protocol kind: `openai-completions`, `anthropic-messages`,
    /// `devin-agent`, `openai-codex-responses`, `cursor-agent`,
    /// `google-generative-ai`, `google-vertex`, `google-gemini-cli`,
    /// `bedrock-converse-stream`, `ollama-chat`, `openrouter`,
    /// `openai-responses`, `azure-openai-responses`, `gitlab-duo-agent`.
    #[serde(rename = "api")]
    pub api_kind: String,
    pub provider: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub reasoning: bool,
    /// Input modalities: `"text"`, `"image"`, etc.
    pub input: Vec<String>,
    pub cost: CatalogCost,
    #[serde(rename = "contextWindow")]
    pub context_window: Option<i64>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i64>,
}

/// Cost fields from the OMP catalog (per-token rates).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CatalogCost {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(default, rename = "cacheRead")]
    pub cache_read: f64,
    #[serde(default, rename = "cacheWrite")]
    pub cache_write: f64,
}

/// The parsed catalog: provider id → (model id → model entry).
pub static CATALOG: LazyLock<HashMap<String, HashMap<String, CatalogModel>>> =
    LazyLock::new(|| {
        serde_json::from_str(CATALOG_JSON).unwrap_or_else(|e| {
            // A corrupt vendored catalog is a build-time bug, not a runtime
            // condition. Panic at first use so the developer fixes the file.
            panic!("Failed to parse vendored OMP catalog: {e}")
        })
    });

/// All provider ids in the catalog, sorted alphabetically.
pub fn provider_ids() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = CATALOG.keys().map(String::as_str).collect();
    ids.sort();
    ids
}

/// All models for a provider, sorted by id.
pub fn models_for(provider_id: &str) -> Vec<&'static CatalogModel> {
    CATALOG
        .get(provider_id)
        .map(|models| {
            let mut entries: Vec<&CatalogModel> = models.values().collect();
            entries.sort_by(|a, b| a.id.cmp(&b.id));
            entries
        })
        .unwrap_or_default()
}

/// The number of providers in the catalog.
pub fn provider_count() -> usize {
    CATALOG.len()
}

/// The total number of models across all providers.
pub fn model_count() -> usize {
    CATALOG.values().map(|models| models.len()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses_successfully() {
        assert!(provider_count() > 0, "catalog should have providers");
        assert!(model_count() > 0, "catalog should have models");
    }

    #[test]
    fn devin_has_48_models_with_swe_and_glm() {
        let devin = models_for("devin");
        assert_eq!(devin.len(), 48, "devin should expose 48 models");
        let ids: Vec<&str> = devin.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"swe-1-6"), "devin should include swe-1-6");
        assert!(ids.contains(&"glm-5-2"), "devin should include glm-5-2");
    }

    #[test]
    fn every_model_has_non_empty_api_kind() {
        for (provider_id, models) in CATALOG.iter() {
            for (model_id, model) in models.iter() {
                assert!(
                    !model.api_kind.is_empty(),
                    "model {provider_id}/{model_id} has empty api kind"
                );
            }
        }
    }

    #[test]
    fn catalog_version_is_stamped() {
        assert!(
            !CATALOG_VERSION.trim().is_empty(),
            "VERSION file should be stamped"
        );
    }
}

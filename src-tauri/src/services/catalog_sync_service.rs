//! Catalog sync — fetches the canonical provider→model tree from basebuild.net
//! and upserts it into the local model cache. This is the primary model source
//! for the desktop; per-provider `/v1/models` discovery is a fallback for
//! providers not yet in the catalog.
//!
//! The endpoint is `GET /api/catalog/desktop` (unauthenticated, edge-cached).
//! The response is versioned; a future version the desktop doesn't understand
//! is refused, not ingested, so an incompatible shape never corrupts the cache.

use std::env;

use rusqlite::params;
use serde::Deserialize;

use crate::models::execution_advisor::ModelExecutionProfileV1;
use crate::services::storage_service::StorageService;

/// The highest catalog response `version` this desktop understands. If the
/// endpoint returns a higher version, sync refuses with an upgrade prompt.
pub const SUPPORTED_CATALOG_VERSION: u32 = 2;

/// Default catalog base URL. Override with `BASEBUILD_CATALOG_URL` for dev.
const DEFAULT_CATALOG_BASE_URL: &str = "https://basebuild.net";

/// Catalog response shape (subset — we only read what we need to persist).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogResponse {
    version: u32,
    providers: Vec<CatalogProvider>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogProvider {
    slug: String,
    #[allow(dead_code)]
    name: String,
    /// The provider's API base URL (e.g. "https://api.code.umans.ai/v1").
    /// Stored on the cache row so `resolve_client` can use it when the
    /// credential doesn't override it.
    #[allow(dead_code)]
    api_url: Option<String>,
    models: Vec<CatalogModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogModel {
    /// Canonical slug (e.g. "glm-5.2") — stored as `model_id`.
    slug: String,
    /// Provider-specific API id (e.g. "umans-glm-5.2") — stored as `model_api_id`.
    api_id: String,
    #[allow(dead_code)]
    name: String,
    reasoning: bool,
    #[allow(dead_code)]
    tool_call: bool,
    #[allow(dead_code)]
    structured_output: bool,
    context_limit: Option<i64>,
    output_limit: Option<i64>,
    #[allow(dead_code)]
    input_modalities: String,
    #[serde(default)]
    execution_profile: Option<ModelExecutionProfileV1>,
}

/// Result of a catalog sync, surfaced to the UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSyncResult {
    pub synced: usize,
    pub skipped: usize,
    pub error: Option<String>,
}

/// Fetch the catalog endpoint and upsert rows. Idempotent: re-running with the
/// same data updates `synced_at` without duplicating rows.
pub fn sync_catalog() -> CatalogSyncResult {
    match sync_catalog_inner() {
        Ok(result) => result,
        Err(error) => {
            mark_profile_cache_error(&error);
            CatalogSyncResult {
                synced: 0,
                skipped: 0,
                error: Some(error),
            }
        }
    }
}

fn sync_catalog_inner() -> Result<CatalogSyncResult, String> {
    let base =
        env::var("BASEBUILD_CATALOG_URL").unwrap_or_else(|_| DEFAULT_CATALOG_BASE_URL.to_string());
    let url = format!("{}/api/catalog/desktop", base.trim_end_matches('/'));

    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build catalog HTTP client: {e}"))?
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch catalog from {url}: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Catalog endpoint returned HTTP {status}"));
    }

    let catalog: CatalogResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse catalog response: {e}"))?;

    if catalog.version > SUPPORTED_CATALOG_VERSION {
        return Err(format!(
            "Catalog version {} is newer than supported ({}). Update Basebuild Desktop.",
            catalog.version, SUPPORTED_CATALOG_VERSION
        ));
    }

    let conn = StorageService::connect()?;

    let now = crate::services::provider_model_catalog_service::now_seconds();
    let mut synced = 0usize;
    let mut skipped = 0usize;

    for provider in &catalog.providers {
        for model in &provider.models {
            // Upsert by (provider_id, model_id). Catalog-sync rows overwrite
            // bundled/discovered rows for the same pair — the catalog is canonical.
            let supported_efforts = if model.reasoning {
                r#"["low","medium","high","xhigh"]"#.to_string()
            } else {
                "[]".to_string()
            };
            let supports_images = model
                .input_modalities
                .split(',')
                .any(|item| item.trim() == "image");
            let changed = conn
                .execute(
                    "INSERT INTO native_provider_model_cache
                    (provider_id, model_id, label, context_window, max_tokens,
                     supports_reasoning, supported_efforts, supports_images, source,
                     synced_at, error, model_api_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'catalog_sync', ?9, NULL, ?10)
                 ON CONFLICT(provider_id, model_id) DO UPDATE SET
                    label = excluded.label,
                    context_window = excluded.context_window,
                    max_tokens = excluded.max_tokens,
                    supports_reasoning = excluded.supports_reasoning,
                    supported_efforts = excluded.supported_efforts,
                    supports_images = excluded.supports_images,
                    source = 'catalog_sync',
                    synced_at = excluded.synced_at,
                    error = NULL,
                    model_api_id = excluded.model_api_id",
                    params![
                        provider.slug,
                        model.slug,
                        model.name,
                        model.context_limit,
                        model.output_limit,
                        model.reasoning as i32,
                        supported_efforts,
                        supports_images as i32,
                        now,
                        model.api_id,
                    ],
                )
                .map_err(|e| format!("Failed to upsert catalog row: {e}"))?;
            if changed > 0 {
                synced += 1;
            } else {
                skipped += 1;
            }
            if let Some(profile) = &model.execution_profile {
                if let Err(error) = profile.validate() {
                    skipped += 1;
                    eprintln!(
                        "[catalog-sync] skipped invalid execution profile {}: {error}",
                        profile.canonical_model_id
                    );
                    continue;
                }
                let profile_json = serde_json::to_string(profile)
                    .map_err(|error| format!("Failed to serialize execution profile: {error}"))?;
                conn.execute(
                    "INSERT INTO model_execution_profile_cache
                        (canonical_model_id, profile_json, fetched_at, error)
                     VALUES (?1, ?2, ?3, NULL)
                     ON CONFLICT(canonical_model_id) DO UPDATE SET
                        profile_json = excluded.profile_json,
                        fetched_at = excluded.fetched_at,
                        error = NULL",
                    params![profile.canonical_model_id, profile_json, now],
                )
                .map_err(|error| format!("Failed to cache execution profile: {error}"))?;
            }
        }
    }

    Ok(CatalogSyncResult {
        synced,
        skipped,
        error: None,
    })
}
fn mark_profile_cache_error(error: &str) {
    let Ok(conn) = StorageService::connect() else {
        return;
    };
    let bounded = error.chars().take(1_000).collect::<String>();
    let _ = conn.execute(
        "UPDATE model_execution_profile_cache SET error = ?1",
        params![bounded],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_additive_profile_catalog_version() {
        assert_eq!(SUPPORTED_CATALOG_VERSION, 2);
    }
}

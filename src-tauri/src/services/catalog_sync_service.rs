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

use crate::services::storage_service::StorageService;

/// The highest catalog response `version` this desktop understands. If the
/// endpoint returns a higher version, sync refuses with an upgrade prompt.
pub const SUPPORTED_CATALOG_VERSION: u32 = 1;

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
        Ok(r) => r,
        Err(e) => CatalogSyncResult {
            synced: 0,
            skipped: 0,
            error: Some(e),
        },
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
            let changed = conn
                .execute(
                    "INSERT INTO native_provider_model_cache
                    (provider_id, model_id, label, context_window, max_tokens,
                     supports_reasoning, supported_efforts, supports_images, source,
                     synced_at, error, model_api_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 'catalog_sync', ?8, NULL, ?9)
                 ON CONFLICT(provider_id, model_id) DO UPDATE SET
                    label = excluded.label,
                    context_window = excluded.context_window,
                    max_tokens = excluded.max_tokens,
                    supports_reasoning = excluded.supports_reasoning,
                    supported_efforts = excluded.supported_efforts,
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
        }
    }

    Ok(CatalogSyncResult {
        synced,
        skipped,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_version_is_1() {
        // Guard against accidental bump without desktop support.
        assert_eq!(SUPPORTED_CATALOG_VERSION, 1);
    }
}

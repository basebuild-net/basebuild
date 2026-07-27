//! Offline tool model download service.
//!
//! Downloads GGUF model files from the catalog's HTTPS URLs into the Basebuild
//! data directory and records the local path in `downloaded_tool_models` so
//! the voice runtime can find them without a network round trip on every
//! transcription.
//!
//! Safety posture. The download URL comes from the bundled catalog, never from
//! caller text: the command layer passes a `tool_id` + `quant`, and this
//! service resolves that to a catalog entry. The URL scheme is verified
//! `https` before any fetch. The file is written to a temp path and renamed
//! into place only after the size matches the catalog's expected size, so a
//! truncated or hostile response never produces a "downloaded" row.
use rusqlite::params;
use rusqlite::OptionalExtension;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use crate::models::tool_catalog::{CatalogTool, ToolKind, TOOLS_CATALOG};
use crate::services::storage_paths::StoragePathService;
use crate::services::storage_service::StorageService;

type DbResult<T> = Result<T, String>;

/// Where downloaded tool model files live: `~/.basebuild/tool-models/`.
fn tool_models_dir() -> Result<PathBuf, String> {
    let dir = StoragePathService::global_basebuild_dir()?.join("tool-models");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create tool-models directory: {error}"))?;
    Ok(dir)
}

/// Resolve a catalog entry by tool id and kind.
fn catalog_entry(kind: ToolKind, tool_id: &str) -> Result<&'static CatalogTool, String> {
    TOOLS_CATALOG
        .get(&kind)
        .and_then(|m| m.get(tool_id))
        .ok_or_else(|| format!("Tool '{tool_id}' not found in catalog"))
}

/// A downloaded model row, returned to the frontend so it can show what's
/// available locally.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedToolModel {
    pub tool_id: String,
    pub quant: String,
    pub kind: String,
    pub local_path: String,
    pub size_bytes: u64,
    pub downloaded_at: i64,
}

/// The result of a download attempt.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDownloadResult {
    pub tool_id: String,
    pub quant: String,
    pub local_path: String,
    pub size_bytes: u64,
}

pub struct ToolDownloadService;

impl ToolDownloadService {
    /// List all downloaded tool models, sorted by tool id then quant.
    pub fn list_downloaded() -> DbResult<Vec<DownloadedToolModel>> {
        let connection = StorageService::connect()?;
        let mut stmt = connection
            .prepare(
                "SELECT tool_id, quant, kind, local_path, size_bytes, downloaded_at
                 FROM downloaded_tool_models
                 ORDER BY tool_id, quant",
            )
            .map_err(|error| format!("Failed to list downloaded tool models: {error}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DownloadedToolModel {
                    tool_id: row.get(0)?,
                    quant: row.get(1)?,
                    kind: row.get(2)?,
                    local_path: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    downloaded_at: row.get(5)?,
                })
            })
            .map_err(|error| format!("Failed to query downloaded tool models: {error}"))?;
        let mut models = Vec::new();
        for row in rows {
            models.push(row.map_err(|error| format!("Row decode error: {error}"))?);
        }
        Ok(models)
    }

    /// Check whether a specific tool model is already downloaded.
    pub fn is_downloaded(tool_id: &str, quant: &str) -> DbResult<Option<DownloadedToolModel>> {
        let connection = StorageService::connect()?;
        let row = connection
            .query_row(
                "SELECT tool_id, quant, kind, local_path, size_bytes, downloaded_at
                 FROM downloaded_tool_models
                 WHERE tool_id = ?1 AND quant = ?2",
                params![tool_id, quant],
                |row| {
                    Ok(DownloadedToolModel {
                        tool_id: row.get(0)?,
                        quant: row.get(1)?,
                        kind: row.get(2)?,
                        local_path: row.get(3)?,
                        size_bytes: row.get::<_, i64>(4)? as u64,
                        downloaded_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Failed to query downloaded tool model: {error}"))?;
        Ok(row)
    }

    /// Download a specific quantization of a tool model. The URL and expected
    /// size come from the bundled catalog, never from the caller.
    pub fn download(
        kind: ToolKind,
        tool_id: &str,
        quant: &str,
    ) -> Result<ToolDownloadResult, String> {
        let tool = catalog_entry(kind, tool_id)?;
        let file = tool
            .files
            .iter()
            .find(|f| f.quant == quant)
            .ok_or_else(|| {
                format!("Tool '{tool_id}' has no file with quant '{quant}'")
            })?;

        if !file.url.starts_with("https://") {
            return Err(format!(
                "Refusing to download from non-HTTPS URL for tool '{tool_id}'"
            ));
        }

        let models_dir = tool_models_dir()?;
        let tool_dir = models_dir.join(tool_id);
        fs::create_dir_all(&tool_dir)
            .map_err(|error| format!("Failed to create tool model directory: {error}"))?;

        let filename = format!("{}.gguf", quant);
        let final_path = tool_dir.join(&filename);
        let temp_path = tool_dir.join(format!("{filename}.part"));

        // If the file already exists with the right size, return it without
        // re-downloading.
        if final_path.exists() {
            if let Ok(metadata) = fs::metadata(&final_path) {
                if metadata.len() == file.size_bytes {
                    return Ok(ToolDownloadResult {
                        tool_id: tool_id.to_string(),
                        quant: quant.to_string(),
                        local_path: final_path.to_string_lossy().to_string(),
                        size_bytes: file.size_bytes,
                    });
                }
            }
        }

        // Download to the temp path, then rename on success.
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(3600))
            .build()
            .map_err(|error| format!("Failed to build HTTP client: {error}"))?;

        let response = client
            .get(&file.url)
            .send()
            .map_err(|error| format!("Download request failed: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Download failed with HTTP {}",
                response.status()
            ));
        }

        let mut file_handle = fs::File::create(&temp_path)
            .map_err(|error| format!("Failed to create temp file: {error}"))?;

        let bytes = response
            .bytes()
            .map_err(|error| format!("Failed to read download body: {error}"))?;

        file_handle
            .write_all(&bytes)
            .map_err(|error| format!("Failed to write download: {error}"))?;

        // Verify the downloaded size matches the catalog's expected size.
        let actual_size = bytes.len() as u64;
        if actual_size != file.size_bytes {
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "Downloaded size {} bytes does not match expected {} bytes for tool '{tool_id}' quant '{quant}'",
                actual_size, file.size_bytes
            ));
        }

        fs::rename(&temp_path, &final_path)
            .map_err(|error| format!("Failed to finalize download: {error}"))?;

        let local_path = final_path.to_string_lossy().to_string();
        let kind_str = kind_to_str(kind);

        // Record the download in the database.
        let connection = StorageService::connect()?;
        connection
            .execute(
                "INSERT INTO downloaded_tool_models
                    (tool_id, quant, kind, local_path, size_bytes, downloaded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(tool_id, quant) DO UPDATE SET
                   kind = excluded.kind,
                   local_path = excluded.local_path,
                   size_bytes = excluded.size_bytes,
                   downloaded_at = excluded.downloaded_at",
                params![
                    tool_id,
                    quant,
                    kind_str,
                    local_path,
                    actual_size as i64,
                    now_seconds(),
                ],
            )
            .map_err(|error| format!("Failed to record download: {error}"))?;

        Ok(ToolDownloadResult {
            tool_id: tool_id.to_string(),
            quant: quant.to_string(),
            local_path,
            size_bytes: actual_size,
        })
    }

    /// Delete a downloaded model file and its database row.
    pub fn delete_download(tool_id: &str, quant: &str) -> Result<(), String> {
        let connection = StorageService::connect()?;
        let row = connection
            .query_row(
                "SELECT local_path FROM downloaded_tool_models
                 WHERE tool_id = ?1 AND quant = ?2",
                params![tool_id, quant],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to query download: {error}"))?;

        if let Some(path) = row {
            let _ = fs::remove_file(Path::new(&path));
            connection
                .execute(
                    "DELETE FROM downloaded_tool_models
                     WHERE tool_id = ?1 AND quant = ?2",
                    params![tool_id, quant],
                )
                .map_err(|error| format!("Failed to delete download row: {error}"))?;
        }
        Ok(())
    }
}

fn kind_to_str(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::SpeechToText => "speechToText",
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

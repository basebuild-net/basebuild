//! Tools catalog commands.
//!
//! Read-only shims over the bundled `tools.json` catalog, plus download
//! commands for offline tool models. The catalog is parsed once into a
//! `LazyLock` at first access; the list command just projects it into a
//! serializable shape for the frontend. Download commands resolve a tool id
//! + quantization to a catalog entry and delegate to the download service.

use crate::models::tool_catalog::{tools_for, CatalogTool, ToolKind};
use crate::services::tool_download_service::{
    DownloadedToolModel, ToolDownloadResult, ToolDownloadService,
};

fn parse_kind(kind: &str) -> Result<ToolKind, String> {
    match kind {
        "speechToText" => Ok(ToolKind::SpeechToText),
        other => Err(format!(
            "Unknown tool kind '{other}'. Supported kinds: speechToText."
        )),
    }
}

/// List all tools of a kind from the bundled `tools.json` catalog.
#[tauri::command]
pub fn tool_catalog_list(kind: String) -> Result<Vec<CatalogTool>, String> {
    let parsed = parse_kind(&kind)?;
    Ok(tools_for(parsed).into_iter().cloned().collect())
}

/// List all downloaded tool models.
#[tauri::command]
pub fn tool_downloads_list() -> Result<Vec<DownloadedToolModel>, String> {
    ToolDownloadService::list_downloaded()
}

/// Download a specific quantization of a tool model. The URL and expected
/// size come from the bundled catalog, never from the caller.
#[tauri::command]
pub fn tool_download(
    kind: String,
    tool_id: String,
    quant: String,
) -> Result<ToolDownloadResult, String> {
    let parsed = parse_kind(&kind)?;
    ToolDownloadService::download(parsed, &tool_id, &quant)
}

/// Delete a downloaded tool model file and its database row.
#[tauri::command]
pub fn tool_download_delete(tool_id: String, quant: String) -> Result<(), String> {
    ToolDownloadService::delete_download(&tool_id, &quant)
}

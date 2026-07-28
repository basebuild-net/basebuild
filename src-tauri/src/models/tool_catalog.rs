//! First-party Basebuild tools catalog.
//!
//! `tools.json` is the companion to `models.json`: where `models.json` carries
//! AI/LLM chat and coding models, `tools.json` carries non-LLM services that
//! Basebuild can download and run locally, such as offline speech-to-text and
//! OCR engines. Keeping them in separate files makes the capability boundary
//! explicit: a tool entry never carries a wire protocol or a per-token cost,
//! and a model entry never carries a download URL.
//!
//! Like the model catalog, `tools.json` is embedded at compile time via
//! `include_str!` and parsed once into a `LazyLock`. A corrupt bundled catalog
//! is a build-time bug, not a runtime condition: the `LazyLock` panics at first
//! use so the developer fixes the file rather than silently shipping an empty
//! tool set.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

const TOOLS_JSON: &str = include_str!("../../catalog/tools.json");

/// The kind of non-LLM service a tool provides. Used as the top-level key in
/// `tools.json` so each kind can grow its own entry shape without colliding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolKind {
    /// Offline speech-to-text engines that transcribe recorded audio to text.
    SpeechToText,
}

/// Capabilities a tool entry advertises. Mirrors the user's requested
/// `{ speechToText, toolCalling, selfHostDownloadLink }` shape, extended with
/// the STT-specific flags that the Handy/transcribe.cpp ecosystem already
/// records on model cards.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapabilities {
    pub speech_to_text: bool,
    pub tool_calling: bool,
    pub self_host_download_link: bool,
    /// STT: whether the model supports streaming/low-latency inference.
    #[serde(default)]
    pub streaming: bool,
    /// STT: whether the model can translate to English.
    #[serde(default)]
    pub translate: bool,
    /// STT: whether the model auto-detects the spoken language.
    #[serde(default)]
    pub lang_detect: bool,
    /// STT: timestamp granularity the model emits (`"token"`, `"word"`,
    /// `"segment"`, or `"none"`).
    #[serde(default)]
    pub timestamps: String,
}

/// One downloadable quantization/file of a tool model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFile {
    /// Quantization label (`"Q8_0"`, `"Q5_K_M"`, `"F16"`, etc.).
    pub quant: String,
    /// Exact file size in bytes, from the hosting registry. Used to show
    /// download size before the transfer starts and to verify completion.
    pub size_bytes: u64,
    /// Canonical download URL. Currently Hugging Face `resolve/main` links
    /// that redirect to CDN storage. The download command validates that the
    /// URL scheme is `https` before fetching.
    pub url: String,
}

/// A single tool entry in the catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTool {
    pub id: String,
    pub name: String,
    /// Model family for grouping in the UI (`"parakeet"`, `"whisper"`, etc.).
    pub family: String,
    /// GGUF architecture label, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    /// Parameter count as a display string (`"0.6B"`, `"1.7B"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<String>,
    pub description: String,
    /// Language codes the model supports. Empty means language-agnostic.
    #[serde(default)]
    pub languages: Vec<String>,
    pub capabilities: ToolCapabilities,
    pub license: String,
    /// Upstream model id on Hugging Face, for attribution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_model: Option<String>,
    /// Whether the model carries the "Recommended" badge for onboarding.
    #[serde(default)]
    pub recommended: bool,
    /// Editorial sort position (lower = earlier). Independent of `recommended`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_rank: Option<u32>,
    /// Downloadable files, sorted by size ascending.
    pub files: Vec<ToolFile>,
    /// Quantization to download by default. Must match one of `files[].quant`.
    pub default_quant: String,
}

impl CatalogTool {
    /// The file matching the default quantization, if present.
    pub fn default_file(&self) -> Option<&ToolFile> {
        self.files.iter().find(|f| f.quant == self.default_quant)
    }

    /// Total download size of all files combined (for storage estimates).
    pub fn total_size_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size_bytes).sum()
    }
}

/// The parsed tools catalog: tool kind → (tool id → tool entry).
pub static TOOLS_CATALOG: LazyLock<HashMap<ToolKind, HashMap<String, CatalogTool>>> =
    LazyLock::new(|| {
        serde_json::from_str(TOOLS_JSON).unwrap_or_else(|e| {
            panic!("Failed to parse bundled tools catalog: {e}")
        })
    });

/// All tool entries for a kind, sorted by recommended rank then id.
pub fn tools_for(kind: ToolKind) -> Vec<&'static CatalogTool> {
    let mut entries: Vec<&CatalogTool> = TOOLS_CATALOG
        .get(&kind)
        .map(|m| m.values().collect::<Vec<_>>())
        .unwrap_or_default();
    entries.sort_by(|a, b| {
        b.recommended
            .cmp(&a.recommended)
            .then_with(|| {
                a.recommended_rank
                    .unwrap_or(u32::MAX)
                    .cmp(&b.recommended_rank.unwrap_or(u32::MAX))
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    entries
}

/// The number of tools across all kinds.
pub fn tool_count() -> usize {
    TOOLS_CATALOG.values().map(|m| m.len()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bundled_catalog() {
        // Force parsing.
        let _ = &*TOOLS_CATALOG;
        assert!(tool_count() >= 2, "expected at least 2 tools in catalog");
    }

    #[test]
    fn speech_to_text_has_parakeet_models() {
        let stt = tools_for(ToolKind::SpeechToText);
        assert!(
            stt.iter().any(|t| t.id == "parakeet-unified-en-0.6b"),
            "missing parakeet-unified-en-0.6b"
        );
        assert!(
            stt.iter().any(|t| t.id == "parakeet-tdt-0.6b-v3"),
            "missing parakeet-tdt-0.6b-v3"
        );
    }

    #[test]
    fn every_file_has_https_url() {
        for tools in TOOLS_CATALOG.values() {
            for tool in tools.values() {
                for file in &tool.files {
                    assert!(
                        file.url.starts_with("https://"),
                        "{} file {} has non-HTTPS URL: {}",
                        tool.id,
                        file.quant,
                        file.url
                    );
                    assert!(
                        file.size_bytes > 0,
                        "{} file {} has zero size",
                        tool.id,
                        file.quant
                    );
                }
            }
        }
    }

    #[test]
    fn default_quant_matches_a_file() {
        for tools in TOOLS_CATALOG.values() {
            for tool in tools.values() {
                assert!(
                    tool.default_file().is_some(),
                    "{} default_quant {} does not match any file",
                    tool.id,
                    tool.default_quant
                );
            }
        }
    }

    #[test]
    fn speech_to_text_capabilities_set() {
        for tool in tools_for(ToolKind::SpeechToText) {
            assert!(
                tool.capabilities.speech_to_text,
                "{} is in speechToText but lacks speechToText capability",
                tool.id
            );
            assert!(
                tool.capabilities.self_host_download_link,
                "{} lacks selfHostDownloadLink capability",
                tool.id
            );
        }
    }
}

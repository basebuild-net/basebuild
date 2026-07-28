//! First-party Basebuild model catalog.
//!
//! `models.json` is embedded at compile time via `include_str!` and parsed
//! once into a `LazyLock`. It is the source of truth for Basebuild's bundled
//! provider and model definitions, replacing the hand-transcribed tables that
//! previously lived in `provider_model_catalog_service.rs`.
//!
//! At runtime the bundled data can be refreshed from `basebuild.net` via
//! `catalog_sync_service`; this file is the offline default that ships with the
//! app. The seed data was originally sourced from OhMyPi's catalog (MIT) — see
//! `catalog/README.md` for attribution.
//!
//! The catalog is a map of provider id → (model id → model entry). Each entry
//! carries the wire-protocol kind (`api`), base URL, context window, max
//! tokens, reasoning flag, input modalities, and cost. Basebuild overlays
//! provider-level metadata (label, auth method, API-key URL) that the catalog
//! does not carry — see `provider_overlays()` in `provider_model_catalog_service`.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

/// The content-hash version stamp of the bundled catalog (from `VERSION`),
/// used by cache-invalidation logic to detect stale bundled rows.
pub const CATALOG_VERSION: &str = include_str!("../../catalog/VERSION");

const CATALOG_JSON: &str = include_str!("../../catalog/models.json");

/// How a model exposes voice, weakest to strongest. Ordered so the UI can rank
/// routes and so comparisons like `level >= VoiceLevel::AudioTurn` mean what
/// they read like.
///
/// The ladder exists because "supports audio" is the question everyone asks
/// and the wrong one: a model that accepts an audio attachment in a normal
/// request is a completely different product from one that holds a duplex
/// session open. Collapsing those into one boolean is what makes catalogs
/// useless for choosing a voice route.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default, Hash,
)]
#[serde(rename_all = "snake_case")]
pub enum VoiceLevel {
    /// Text only.
    #[default]
    None,
    /// Audio in, text out. Dictation and transcription. Not a conversation.
    Stt,
    /// Text in, audio out. Readback only.
    Tts,
    /// Audio carried inside an ordinary request/response turn (audio-preview
    /// and omni models). Conversational content, but still strictly
    /// turn-based: the client owns endpointing, and there is no barge-in.
    AudioTurn,
    /// Native full-duplex speech-to-speech over a stateful session, with
    /// server-side turn detection and barge-in. The only level that feels
    /// like a phone call.
    Realtime,
}

/// Which credential actually unlocks a model's voice capability.
///
/// This is the field the whole question turns on. As of 2026-07 every hosted
/// native speech-to-speech surface (OpenAI Realtime, Gemini Live, xAI Grok
/// Voice, Azure Realtime) authenticates with an API key and meters per token
/// or per minute. No consumer subscription credential grants one: the Codex
/// ChatGPT OAuth scope is `openid profile email offline_access
/// api.connectors.read api.connectors.invoke`, which carries no audio or
/// realtime grant. `Subscription` exists so the catalog can record such a
/// route the day one ships, instead of needing a schema change to say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum VoiceBilling {
    /// Pay-per-token or per-minute against an API key.
    ApiKey,
    /// Covered by a consumer subscription credential (OAuth sign-in).
    Subscription,
    /// Runs on this machine. No credential, no metering, no network.
    Local,
}

/// Voice capability detail for one model. Absent on a catalog entry means the
/// model has no voice capability at all.
///
/// Field vocabularies are borrowed rather than invented: `transports` uses
/// OpenAI's own three Realtime transports, and `turn_detection` uses the
/// literal values of `session.turn_detection.type` shared by OpenAI and Azure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVoice {
    pub level: VoiceLevel,
    /// Absent when the level is `None`, or when the route is known to exist
    /// but its billing has not been confirmed. Never guess this field: an
    /// unverified `Subscription` would send a user hunting for a free lunch
    /// that does not exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing: Option<VoiceBilling>,
    /// Session transports, e.g. `webrtc`, `websocket`, `sip`. Empty below
    /// `Realtime`, where there is no session to transport.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transports: Vec<String>,
    /// Server-side endpointing modes, e.g. `server_vad`, `semantic_vad`,
    /// `none`. Empty when the client owns endpointing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub turn_detection: Vec<String>,
    /// Whether the server accepts speech over its own output and cuts itself
    /// off. Client-side interruption does not count.
    #[serde(default)]
    pub barge_in: bool,
    /// Selectable output voice ids, when the provider names them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub voices: Vec<String>,
    /// Required input PCM sample rate in Hz, when the provider fixes one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate_in: Option<u32>,
    /// Emitted output PCM sample rate in Hz, when the provider fixes one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate_out: Option<u32>,
}

/// Default output modality for catalog entries that predate the `output`
/// field. Every model emits text; only some emit anything else.
fn default_output_modalities() -> Vec<String> {
    vec!["text".to_string()]
}

/// A single model entry in the catalog.
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
    /// Input modalities: `"text"`, `"image"`, `"audio"`, `"pdf"`, `"video"`.
    pub input: Vec<String>,
    /// Output modalities: `"text"`, `"audio"`. Mirrors OpenRouter's
    /// `architecture.output_modalities`. Defaults to `["text"]` for the many
    /// catalog entries that predate the field.
    #[serde(default = "default_output_modalities")]
    pub output: Vec<String>,
    /// Voice capability detail. Absent means the model has no voice
    /// capability, which is the case for the overwhelming majority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<CatalogVoice>,
    pub cost: CatalogCost,
    #[serde(rename = "contextWindow")]
    pub context_window: Option<i64>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i64>,
}

impl CatalogModel {
    /// Voice level, treating a missing voice block as `None` so callers never
    /// have to unwrap to ask the common question.
    pub fn voice_level(&self) -> VoiceLevel {
        self.voice.as_ref().map(|v| v.level).unwrap_or_default()
    }

    /// Whether the model accepts audio input in any form, dictation or duplex.
    pub fn accepts_audio(&self) -> bool {
        self.input.iter().any(|m| m == "audio")
    }

    /// Whether the model emits audio rather than only text.
    pub fn emits_audio(&self) -> bool {
        self.output.iter().any(|m| m == "audio")
    }
}

/// Cost fields from the catalog (per-token rates).
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
            // A corrupt bundled catalog is a build-time bug, not a runtime
            // condition. Panic at first use so the developer fixes the file.
            panic!("Failed to parse bundled model catalog: {e}")
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
    fn openai_realtime_is_marked_as_a_realtime_voice_route() {
        let model = models_for("openai")
            .into_iter()
            .find(|m| m.id == "gpt-realtime-2.1")
            .expect("catalog should carry gpt-realtime-2.1");
        assert_eq!(model.voice_level(), VoiceLevel::Realtime);
        assert!(model.accepts_audio(), "realtime route must accept audio");
        assert!(model.emits_audio(), "realtime route must emit audio");
        let voice = model.voice.as_ref().expect("voice block");
        assert_eq!(
            voice.billing,
            Some(VoiceBilling::ApiKey),
            "OpenAI Realtime authenticates with an API key and meters usage; \
             recording it as subscription-covered would send users hunting \
             for a free lunch that does not exist"
        );
        assert!(voice.barge_in);
        assert!(voice.transports.iter().any(|t| t == "webrtc"));
    }

    #[test]
    fn chatgpt_subscription_route_advertises_no_voice() {
        // The Codex OAuth scope is `openid profile email offline_access
        // api.connectors.read api.connectors.invoke`: no audio grant, no
        // realtime grant. If a future catalog refresh ever claims otherwise,
        // this test should fail loudly rather than let the UI promise a
        // capability the credential cannot deliver.
        for model in models_for("openai-codex") {
            assert_eq!(
                model.voice_level(),
                VoiceLevel::None,
                "openai-codex/{} must not advertise voice on a subscription credential",
                model.id
            );
        }
    }

    #[test]
    fn no_model_claims_subscription_backed_realtime_voice() {
        // A standing guard over the whole catalog, not one provider. As of
        // 2026-07 no vendor sells third-party realtime speech-to-speech on a
        // consumer subscription. If a catalog sync ever introduces such a
        // claim it is either a genuine industry first or bad data, and both
        // deserve a human look before shipping.
        for (provider_id, models) in CATALOG.iter() {
            for (model_id, model) in models.iter() {
                let Some(voice) = &model.voice else { continue };
                assert!(
                    !(voice.level == VoiceLevel::Realtime
                        && voice.billing == Some(VoiceBilling::Subscription)),
                    "{provider_id}/{model_id} claims subscription-backed realtime voice; \
                     verify against provider docs before allowing this"
                );
            }
        }
    }

    #[test]
    fn devin_has_models_with_swe_and_glm() {
        // The catalog auto-refreshes (upstream OMP + basebuild overlay), so
        // assert structural invariants, never exact counts.
        let devin = models_for("devin");
        assert!(devin.len() >= 48, "devin should expose at least 48 models");
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

//! Voice runtime types: the profile the user configures for spoken
//! conversations, plus the transcription request/result pair.
//!
//! The Tauri webview exposes `speechSynthesis` (text to speech works in the
//! renderer) but not `SpeechRecognition`, so speech to text has to round-trip
//! through Rust. These types are the wire shape for that round trip and are
//! mirrored field for field in `src/lib/voice.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SttEngine {
    /// OpenAI /v1/audio/transcriptions. API-key billed. The default: it is
    /// the only engine we can guarantee works on a fresh install today.
    OpenaiWhisper,
    /// Windows.Media.SpeechRecognition. Offline, no key, Windows only.
    WindowsNative,
    /// whisper.cpp via a local model file. Offline, no key.
    LocalWhisper,
    /// Parakeet TDT V3 (multilingual, 25 European languages) via
    /// transcribe.cpp. Offline, no key, requires a downloaded GGUF model.
    ParakeetTdtV3,
    /// Parakeet Unified EN 0.6B (English) via transcribe.cpp. Offline, no
    /// key, requires a downloaded GGUF model.
    ParakeetUnifiedEn,
}

impl SttEngine {
    pub fn as_str(&self) -> &'static str {
        match self {
            SttEngine::OpenaiWhisper => "openai_whisper",
            SttEngine::WindowsNative => "windows_native",
            SttEngine::LocalWhisper => "local_whisper",
            SttEngine::ParakeetTdtV3 => "parakeet_tdt_v3",
            SttEngine::ParakeetUnifiedEn => "parakeet_unified_en",
        }
    }

    /// Parse a persisted engine id. Unknown values fall back to the default
    /// engine rather than failing the read, so a hand-edited or downgraded
    /// row never strands the user without voice input.
    pub fn from_str(value: &str) -> Self {
        match value {
            "windows_native" => SttEngine::WindowsNative,
            "local_whisper" => SttEngine::LocalWhisper,
            "parakeet_tdt_v3" => SttEngine::ParakeetTdtV3,
            "parakeet_unified_en" => SttEngine::ParakeetUnifiedEn,
            _ => SttEngine::OpenaiWhisper,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceMode {
    /// Hold or click the mic, speak, release. One utterance per press.
    PushToTalk,
    /// Always listening with VAD endpointing. The default the user asked for.
    Call,
}

impl VoiceMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            VoiceMode::PushToTalk => "push_to_talk",
            VoiceMode::Call => "call",
        }
    }

    /// Parse a persisted mode id. Unknown values fall back to `Call`, the
    /// documented default.
    pub fn from_str(value: &str) -> Self {
        match value {
            "push_to_talk" => VoiceMode::PushToTalk,
            _ => VoiceMode::Call,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfile {
    pub enabled: bool,
    /// Chat provider/model used for VOICE conversations, independent of the
    /// text chat selection. This is the "separate profile" the user asked for.
    pub provider_id: String,
    pub model_id: String,
    pub effort_level: String,
    pub stt_engine: SttEngine,
    /// Credential provider for STT (e.g. "openai"). Separate from provider_id
    /// so you can talk to Claude while transcribing with OpenAI.
    pub stt_provider_id: String,
    pub stt_model_id: String,
    pub tts_enabled: bool,
    /// `speechSynthesis` voice name. None = the OS default voice.
    pub tts_voice: Option<String>,
    pub tts_rate: f32,
    pub mode: VoiceMode,
    /// Trailing silence that ends an utterance in Call mode.
    pub vad_silence_ms: u32,
    /// Speaking over the agent interrupts it (routes through native_chat_steer).
    pub barge_in: bool,
}

impl Default for VoiceProfile {
    /// The documented fresh-install defaults. A database with no saved row
    /// reads back exactly this.
    fn default() -> Self {
        Self {
            enabled: false,
            provider_id: String::new(),
            model_id: String::new(),
            effort_level: "medium".to_string(),
            stt_engine: SttEngine::OpenaiWhisper,
            stt_provider_id: "openai".to_string(),
            stt_model_id: "whisper-1".to_string(),
            tts_enabled: true,
            tts_voice: None,
            tts_rate: 1.0,
            mode: VoiceMode::Call,
            vad_silence_ms: 900,
            barge_in: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscribeRequest {
    pub audio_base64: String,
    pub mime_type: String,
    pub engine: SttEngine,
    pub provider_id: String,
    pub model_id: String,
    pub language_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscribeResult {
    pub text: String,
    pub engine: String,
    pub duration_ms: u64,
}

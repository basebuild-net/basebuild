//! Voice runtime service: profile persistence and speech to text.
//!
//! Two responsibilities that deliberately stay apart:
//! - the single-row `voice_profile` table, read with documented defaults so a
//!   fresh install never fails its first read;
//! - speech to text dispatch, which decodes one recorded utterance and hands
//!   it to the selected engine.
//!
//! Safety posture. The decoded payload is the user speaking into a microphone
//! in their own home. It is never logged, never written to disk, and never
//! echoed back inside an error message. The transcript is treated the same
//! way. API keys are resolved through the shared provider account service
//! (the same lookup the chat clients use), are never read from the
//! environment, and never appear in an error string. Both the encoded and the
//! decoded size are capped before anything is sent anywhere.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::models::voice::{
    SttEngine, VoiceMode, VoiceProfile, VoiceTranscribeRequest, VoiceTranscribeResult,
};
use crate::services::provider_account_service::ProviderAccountService;
use crate::services::provider_login_service::ProviderLoginService;
use crate::services::storage_service::StorageService;

type DbResult<T> = Result<T, String>;

/// OpenAI rejects transcription uploads above 25 MB, and an unbounded decode
/// is a memory-exhaustion vector for every engine, not just that one. Checked
/// against the decoded byte count, and estimated from the encoded length
/// before the decode is allowed to allocate.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

/// Containers the recorder is allowed to produce, mapped to the upload
/// filename and the media type actually put on the wire. Both come from this
/// table and never from caller text, so `mime_type` cannot steer the
/// multipart filename into something odd.
const ALLOWED_AUDIO_TYPES: [(&str, &str); 5] = [
    ("audio/webm", "speech.webm"),
    ("audio/ogg", "speech.ogg"),
    ("audio/wav", "speech.wav"),
    ("audio/mp4", "speech.mp4"),
    ("audio/mpeg", "speech.mp3"),
];

/// Matches the OpenAI-compatible default in `provider_client::resolve_client`.
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

/// `speechSynthesis` ignores rates outside this range.
const MIN_TTS_RATE: f32 = 0.1;
const MAX_TTS_RATE: f32 = 10.0;

/// Endpointing bounds for Call mode. Below the floor every breath ends the
/// utterance; above the ceiling the turn never ends.
const MIN_VAD_SILENCE_MS: u32 = 200;
const MAX_VAD_SILENCE_MS: u32 = 10_000;

/// Language hints are short locale tokens ("en", "en-US"). Bounded and
/// character-restricted because the value reaches an outbound request.
const MAX_LANGUAGE_HINT_LEN: usize = 16;

pub struct VoiceService;

impl VoiceService {
    /// Read the saved voice profile. A database with no row yet returns
    /// [`VoiceProfile::default`] rather than failing, so voice settings open
    /// cleanly on a fresh install.
    pub fn get_profile() -> DbResult<VoiceProfile> {
        let connection = StorageService::connect()?;
        let profile = connection
            .query_row(
                "SELECT enabled, provider_id, model_id, effort_level, stt_engine,
                        stt_provider_id, stt_model_id, tts_enabled, tts_voice, tts_rate,
                        mode, vad_silence_ms, barge_in
                 FROM voice_profile WHERE id = 1",
                [],
                |row| {
                    Ok(VoiceProfile {
                        enabled: row.get::<_, i64>(0)? != 0,
                        provider_id: row.get(1)?,
                        model_id: row.get(2)?,
                        effort_level: row.get(3)?,
                        stt_engine: SttEngine::from_str(&row.get::<_, String>(4)?),
                        stt_provider_id: row.get(5)?,
                        stt_model_id: row.get(6)?,
                        tts_enabled: row.get::<_, i64>(7)? != 0,
                        tts_voice: row.get(8)?,
                        tts_rate: row.get::<_, f64>(9)? as f32,
                        mode: VoiceMode::from_str(&row.get::<_, String>(10)?),
                        vad_silence_ms: row.get::<_, i64>(11)?.clamp(0, u32::MAX as i64) as u32,
                        barge_in: row.get::<_, i64>(12)? != 0,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Failed to read voice profile: {error}"))?;
        Ok(profile.unwrap_or_default())
    }

    /// Persist the voice profile and return what was actually stored. The
    /// returned value is the normalized profile, so the UI reflects any
    /// clamped rate or endpointing window instead of drifting from the row.
    pub fn set_profile(profile: &VoiceProfile) -> DbResult<VoiceProfile> {
        let normalized = normalize(profile);
        let connection = StorageService::connect()?;
        connection
            .execute(
                "INSERT INTO voice_profile (id, enabled, provider_id, model_id, effort_level,
                     stt_engine, stt_provider_id, stt_model_id, tts_enabled, tts_voice, tts_rate,
                     mode, vad_silence_ms, barge_in, updated_at)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                   enabled = excluded.enabled,
                   provider_id = excluded.provider_id,
                   model_id = excluded.model_id,
                   effort_level = excluded.effort_level,
                   stt_engine = excluded.stt_engine,
                   stt_provider_id = excluded.stt_provider_id,
                   stt_model_id = excluded.stt_model_id,
                   tts_enabled = excluded.tts_enabled,
                   tts_voice = excluded.tts_voice,
                   tts_rate = excluded.tts_rate,
                   mode = excluded.mode,
                   vad_silence_ms = excluded.vad_silence_ms,
                   barge_in = excluded.barge_in,
                   updated_at = excluded.updated_at",
                params![
                    normalized.enabled as i32,
                    normalized.provider_id,
                    normalized.model_id,
                    normalized.effort_level,
                    normalized.stt_engine.as_str(),
                    normalized.stt_provider_id,
                    normalized.stt_model_id,
                    normalized.tts_enabled as i32,
                    normalized.tts_voice,
                    normalized.tts_rate as f64,
                    normalized.mode.as_str(),
                    normalized.vad_silence_ms as i64,
                    normalized.barge_in as i32,
                    now_seconds(),
                ],
            )
            .map_err(|error| format!("Failed to save voice profile: {error}"))?;
        Ok(normalized)
    }

    /// Transcribe one recorded utterance.
    ///
    /// Validation runs before dispatch so every engine inherits the same
    /// container allowlist and the same size cap. Engines that are not built
    /// yet return an actionable `Err`: a silent empty transcript would put
    /// words the user never said into the conversation, which is the worst
    /// available failure mode here.
    pub fn transcribe(request: &VoiceTranscribeRequest) -> Result<VoiceTranscribeResult, String> {
        let started = Instant::now();
        let (mime, filename) = resolve_container(&request.mime_type)?;
        let audio = decode_audio(&request.audio_base64)?;

        let text = match request.engine {
            SttEngine::OpenaiWhisper => transcribe_openai_whisper(request, audio, mime, filename)?,
            SttEngine::WindowsNative => {
                return Err(
                    "Windows speech recognition is not wired up yet; pick OpenAI Whisper in \
                     voice settings."
                        .to_string(),
                )
            }
            SttEngine::LocalWhisper => {
                return Err(
                    "Local whisper.cpp transcription is not wired up yet; it needs a downloaded \
                     model file. Pick OpenAI Whisper in voice settings."
                        .to_string(),
                )
            }
        };

        Ok(VoiceTranscribeResult {
            text: text.trim().to_string(),
            engine: request.engine.as_str().to_string(),
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }
}

/// Clamp and tidy a profile into the shape the table should hold. Empty
/// strings collapse to their documented defaults; a blank TTS voice becomes
/// `None`, which the contract defines as the OS default voice.
fn normalize(profile: &VoiceProfile) -> VoiceProfile {
    let defaults = VoiceProfile::default();
    let effort_level = profile.effort_level.trim();
    let stt_provider_id = profile.stt_provider_id.trim();
    let stt_model_id = profile.stt_model_id.trim();
    // NaN fails every comparison, so clamp would propagate it into the row.
    let tts_rate = if profile.tts_rate.is_finite() {
        profile.tts_rate.clamp(MIN_TTS_RATE, MAX_TTS_RATE)
    } else {
        defaults.tts_rate
    };

    VoiceProfile {
        enabled: profile.enabled,
        provider_id: profile.provider_id.trim().to_string(),
        model_id: profile.model_id.trim().to_string(),
        effort_level: if effort_level.is_empty() {
            defaults.effort_level
        } else {
            effort_level.to_string()
        },
        stt_engine: profile.stt_engine,
        stt_provider_id: if stt_provider_id.is_empty() {
            defaults.stt_provider_id
        } else {
            stt_provider_id.to_string()
        },
        stt_model_id: if stt_model_id.is_empty() {
            defaults.stt_model_id
        } else {
            stt_model_id.to_string()
        },
        tts_enabled: profile.tts_enabled,
        tts_voice: profile
            .tts_voice
            .as_deref()
            .map(str::trim)
            .filter(|voice| !voice.is_empty())
            .map(str::to_string),
        tts_rate,
        mode: profile.mode,
        vad_silence_ms: profile
            .vad_silence_ms
            .clamp(MIN_VAD_SILENCE_MS, MAX_VAD_SILENCE_MS),
        barge_in: profile.barge_in,
    }
}

/// Resolve a caller-supplied media type to the `(mime, filename)` pair used
/// on the wire. Media-type parameters are stripped first because
/// `MediaRecorder.mimeType` reports codecs inline (`audio/webm;codecs=opus`),
/// but only the bare type is ever matched, and both returned values are
/// `'static` entries from [`ALLOWED_AUDIO_TYPES`] rather than caller text.
fn resolve_container(mime_type: &str) -> Result<(&'static str, &'static str), String> {
    let essence = mime_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    ALLOWED_AUDIO_TYPES
        .iter()
        .find(|(allowed, _)| *allowed == essence)
        .map(|(mime, filename)| (*mime, *filename))
        .ok_or_else(|| {
            let allowed = ALLOWED_AUDIO_TYPES
                .iter()
                .map(|(mime, _)| *mime)
                .collect::<Vec<_>>()
                .join(", ");
            format!("Unsupported audio format. Supported recording types: {allowed}.")
        })
}

/// Decode the recorded utterance, refusing anything over the cap.
///
/// The encoded length is checked first: four base64 characters carry three
/// bytes, so a hostile payload is rejected before it is materialized rather
/// than after. No part of the payload appears in any error text.
fn decode_audio(audio_base64: &str) -> Result<Vec<u8>, String> {
    if audio_base64.is_empty() {
        return Err(empty_audio_message());
    }
    if audio_base64.len() / 4 * 3 > MAX_AUDIO_BYTES {
        return Err(oversized_audio_message());
    }
    let audio = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|_| {
            "Audio payload is not valid base64. Expected raw standard base64 with no data: URL \
             prefix."
                .to_string()
        })?;
    // Authoritative check, on real bytes rather than an estimate. The guard
    // above is an upper bound for every base64 variant, so this is a backstop
    // that keeps the cap correct if the decode step ever changes.
    if audio.len() > MAX_AUDIO_BYTES {
        return Err(oversized_audio_message());
    }
    if audio.is_empty() {
        return Err(empty_audio_message());
    }
    Ok(audio)
}

fn empty_audio_message() -> String {
    "No audio was captured. Check the microphone permission and try again.".to_string()
}

fn oversized_audio_message() -> String {
    format!(
        "Recording is too large to transcribe (limit {} MB). Record a shorter utterance or \
         switch to push to talk.",
        MAX_AUDIO_BYTES / (1024 * 1024)
    )
}

/// POST the utterance to an OpenAI-compatible `/audio/transcriptions`
/// endpoint as multipart form data.
fn transcribe_openai_whisper(
    request: &VoiceTranscribeRequest,
    audio: Vec<u8>,
    mime: &'static str,
    filename: &'static str,
) -> Result<String, String> {
    let defaults = VoiceProfile::default();
    let provider_id = non_empty(&request.provider_id).unwrap_or(&defaults.stt_provider_id);
    let model_id = non_empty(&request.model_id).unwrap_or(&defaults.stt_model_id);
    let language = language_part(request.language_hint.as_deref())?;
    let (api_key, base_url) = resolve_stt_credential(provider_id)?;

    let part = reqwest::blocking::multipart::Part::bytes(audio)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|_| "Failed to build the transcription upload.".to_string())?;
    let mut form = reqwest::blocking::multipart::Form::new()
        .part("file", part)
        .text("model", model_id.to_string());
    if let Some(language) = language {
        form = form.text("language", language);
    }

    let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));
    let response = http_client()?
        .post(url)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        // Classified rather than formatted: a reqwest error renders the
        // request URL, and a user-configured base URL can carry credentials.
        .map_err(|error| {
            if error.is_timeout() {
                "Transcription timed out. Try a shorter utterance or check your connection."
                    .to_string()
            } else if error.is_connect() {
                "Could not reach the transcription endpoint. Check your connection and the \
                 provider base URL."
                    .to_string()
            } else {
                "Transcription request failed before a response arrived.".to_string()
            }
        })?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|_| "Transcription response could not be read.".to_string())?;
    if !status.is_success() {
        return Err(transcription_http_error(status.as_u16(), provider_id, &body));
    }
    // The body holds the transcript, so it is parsed and returned but never
    // logged and never quoted into an error.
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .ok_or_else(|| "Transcription response did not contain any text.".to_string())
}

/// Resolve the STT API key and base URL through the same account lookup the
/// chat clients use: strategy-ordered healthy candidates from
/// [`ProviderAccountService`], with the per-account OAuth refresh applied
/// first. No environment variables and no second credential store.
fn resolve_stt_credential(provider_id: &str) -> Result<(String, String), String> {
    let mut candidates = ProviderAccountService::candidates(provider_id, None)?;
    for candidate in candidates.iter_mut() {
        let _ = ProviderLoginService::refresh_account_token(candidate);
    }
    // Delegated logins (`omp://`, `native://`) are routing markers, not HTTP
    // endpoints, and their stored key can be a placeholder owned by the
    // delegating runtime. They cannot serve a direct multipart upload.
    let account = candidates
        .into_iter()
        .find(|candidate| {
            candidate
                .base_url
                .as_deref()
                .map(is_http_endpoint)
                .unwrap_or(true)
        })
        .ok_or_else(|| {
            format!(
                "No API key available for '{provider_id}'. Add an API key for that provider in \
                 settings; subscription logins cannot be used for transcription."
            )
        })?;

    let base_url = account
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .unwrap_or(DEFAULT_OPENAI_BASE_URL)
        .to_string();
    Ok((account.api_key, base_url))
}

fn is_http_endpoint(base_url: &str) -> bool {
    let url = base_url.trim();
    url.is_empty() || url.starts_with("https://") || url.starts_with("http://")
}

/// Validate the optional language hint. Rejected loudly rather than dropped
/// silently: the UI owns this field, so a malformed value is a bug worth
/// surfacing, not a transcript quietly done in the wrong language.
fn language_part(language_hint: Option<&str>) -> Result<Option<String>, String> {
    let Some(hint) = language_hint.map(str::trim).filter(|hint| !hint.is_empty()) else {
        return Ok(None);
    };
    let valid = hint.len() <= MAX_LANGUAGE_HINT_LEN
        && hint
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(
            "Invalid language hint. Use a locale code such as \"en\" or \"en-US\".".to_string(),
        );
    }
    Ok(Some(hint.to_string()))
}

fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Concise, secret-free message for a failed transcription response. Mirrors
/// `provider_client::provider_http_error`: the upstream error message is
/// useful, the body is truncated, and no credential is ever interpolated.
fn transcription_http_error(status: u16, provider_id: &str, body: &str) -> String {
    match status {
        401 | 403 => format!(
            "Authentication failed ({status}) for '{provider_id}'. Reconnect the provider or \
             check the API key."
        ),
        413 => "Recording was rejected as too large by the transcription service. Record a \
                shorter utterance."
            .to_string(),
        429 => format!("Rate limited ({status}) by '{provider_id}'. Try again shortly."),
        _ => {
            let detail = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|value| {
                    value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| body.trim().chars().take(200).collect());
            format!("Transcription failed ({status}) on '{provider_id}': {detail}")
        }
    }
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "Failed to build the transcription HTTP client.".to_string())
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn populated_profile() -> VoiceProfile {
        VoiceProfile {
            enabled: true,
            provider_id: "anthropic".to_string(),
            model_id: "claude-sonnet-4".to_string(),
            effort_level: "high".to_string(),
            stt_engine: SttEngine::LocalWhisper,
            stt_provider_id: "openai".to_string(),
            stt_model_id: "gpt-4o-transcribe".to_string(),
            tts_enabled: false,
            tts_voice: Some("Microsoft Aria".to_string()),
            tts_rate: 1.25,
            mode: VoiceMode::PushToTalk,
            vad_silence_ms: 700,
            barge_in: false,
        }
    }

    #[test]
    fn fresh_database_returns_documented_defaults() {
        let (_home, _guard) = crate::test_util::test::isolated_home();
        let profile = VoiceService::get_profile().expect("fresh database reads defaults");

        assert!(!profile.enabled);
        assert_eq!(profile.provider_id, "");
        assert_eq!(profile.model_id, "");
        assert_eq!(profile.effort_level, "medium");
        assert_eq!(profile.stt_engine, SttEngine::OpenaiWhisper);
        assert_eq!(profile.stt_provider_id, "openai");
        assert_eq!(profile.stt_model_id, "whisper-1");
        assert!(profile.tts_enabled);
        assert_eq!(profile.tts_voice, None);
        assert_eq!(profile.tts_rate, 1.0);
        assert_eq!(profile.mode, VoiceMode::Call);
        assert_eq!(profile.vad_silence_ms, 900);
        assert!(profile.barge_in);
    }

    #[test]
    fn populated_profile_round_trips_through_sqlite() {
        let (_home, _guard) = crate::test_util::test::isolated_home();
        let saved = VoiceService::set_profile(&populated_profile()).expect("save profile");
        let read = VoiceService::get_profile().expect("read profile back");

        // Every field is asserted individually: a column-order mistake in the
        // INSERT would otherwise round-trip two swapped strings unnoticed.
        assert!(read.enabled);
        assert_eq!(read.provider_id, "anthropic");
        assert_eq!(read.model_id, "claude-sonnet-4");
        assert_eq!(read.effort_level, "high");
        assert_eq!(read.stt_engine, SttEngine::LocalWhisper);
        assert_eq!(read.stt_provider_id, "openai");
        assert_eq!(read.stt_model_id, "gpt-4o-transcribe");
        assert!(!read.tts_enabled);
        assert_eq!(read.tts_voice.as_deref(), Some("Microsoft Aria"));
        assert_eq!(read.tts_rate, 1.25);
        assert_eq!(read.mode, VoiceMode::PushToTalk);
        assert_eq!(read.vad_silence_ms, 700);
        assert!(!read.barge_in);
        assert_eq!(
            saved.stt_model_id, read.stt_model_id,
            "set_profile returns what was stored"
        );
    }

    #[test]
    fn saving_twice_updates_the_single_row() {
        let (_home, _guard) = crate::test_util::test::isolated_home();
        VoiceService::set_profile(&populated_profile()).expect("first save");
        VoiceService::set_profile(&VoiceProfile {
            model_id: "claude-opus-4".to_string(),
            ..populated_profile()
        })
        .expect("second save");

        let connection = StorageService::connect().expect("connect");
        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM voice_profile", [], |row| row.get(0))
            .expect("count rows");
        assert_eq!(rows, 1, "voice_profile stays a single row");
        assert_eq!(
            VoiceService::get_profile().expect("read").model_id,
            "claude-opus-4"
        );
    }

    #[test]
    fn oversized_payload_is_rejected_before_decoding() {
        // Encoded length alone exceeds the cap, so this must fail without
        // allocating the decoded buffer.
        let encoded_len = (MAX_AUDIO_BYTES / 3 + 64) * 4;
        let payload = "A".repeat(encoded_len);
        let error = decode_audio(&payload).expect_err("oversized payload is rejected");
        assert!(
            error.contains("too large"),
            "error names the size problem: {error}"
        );
        assert!(
            !error.contains("AAAA"),
            "error never echoes the payload: {error}"
        );
    }

    #[test]
    fn valid_payload_decodes_and_empty_payload_is_rejected() {
        assert_eq!(
            MAX_AUDIO_BYTES,
            25 * 1024 * 1024,
            "the cap is OpenAI's documented 25 MB upload limit"
        );
        let under = base64::engine::general_purpose::STANDARD.encode(vec![0_u8; 1024]);
        assert_eq!(
            decode_audio(&under).expect("small payload decodes").len(),
            1024
        );
        assert!(
            decode_audio("not base64!!").is_err(),
            "a malformed payload is rejected instead of being sent upstream"
        );
        assert!(
            decode_audio("").is_err(),
            "an empty payload is a failed recording, not a silent success"
        );
    }

    #[test]
    fn mime_allowlist_rejects_unknown_types() {
        for (mime, filename) in ALLOWED_AUDIO_TYPES {
            assert_eq!(resolve_container(mime), Ok((mime, filename)));
        }
        // MediaRecorder reports codecs inline; the bare type still matches and
        // the filename comes from the table, not the caller.
        assert_eq!(
            resolve_container("audio/webm;codecs=opus"),
            Ok(("audio/webm", "speech.webm"))
        );
        assert_eq!(
            resolve_container("AUDIO/WEBM"),
            Ok(("audio/webm", "speech.webm"))
        );

        for rejected in [
            "application/octet-stream",
            "text/html",
            "audio/../../etc/passwd",
            "audio/webm/../evil.exe",
            "",
        ] {
            assert!(
                resolve_container(rejected).is_err(),
                "'{rejected}' must not resolve to an upload filename"
            );
        }
    }

    #[test]
    fn unimplemented_engines_fail_loudly() {
        // A quiet Ok("") would inject words the user never said. Both engines
        // must name what is missing and what to do instead.
        for engine in [SttEngine::WindowsNative, SttEngine::LocalWhisper] {
            let request = VoiceTranscribeRequest {
                audio_base64: base64::engine::general_purpose::STANDARD.encode(b"pretend audio"),
                mime_type: "audio/webm".to_string(),
                engine,
                provider_id: "openai".to_string(),
                model_id: "whisper-1".to_string(),
                language_hint: None,
            };
            let error = VoiceService::transcribe(&request)
                .expect_err("unimplemented engine returns Err, never Ok(empty)");
            assert!(
                error.contains("not wired up yet"),
                "{} names the gap: {error}",
                engine.as_str()
            );
            assert!(
                error.contains("OpenAI Whisper"),
                "{} names the working alternative: {error}",
                engine.as_str()
            );
        }
    }

    #[test]
    fn language_hint_is_bounded_and_character_restricted() {
        assert_eq!(language_part(None), Ok(None));
        assert_eq!(language_part(Some("  ")), Ok(None));
        assert_eq!(language_part(Some("en")), Ok(Some("en".to_string())));
        assert_eq!(language_part(Some(" en-US ")), Ok(Some("en-US".to_string())));
        assert!(language_part(Some("en\r\nX-Injected: 1")).is_err());
        assert!(language_part(Some(&"e".repeat(64))).is_err());
    }

    #[test]
    fn normalize_clamps_out_of_range_values() {
        let normalized = normalize(&VoiceProfile {
            tts_rate: 99.0,
            vad_silence_ms: 5,
            effort_level: "  ".to_string(),
            tts_voice: Some("   ".to_string()),
            ..populated_profile()
        });
        assert_eq!(normalized.tts_rate, MAX_TTS_RATE);
        assert_eq!(normalized.vad_silence_ms, MIN_VAD_SILENCE_MS);
        assert_eq!(normalized.effort_level, "medium");
        assert_eq!(normalized.tts_voice, None, "blank voice means OS default");

        let nan = normalize(&VoiceProfile {
            tts_rate: f32::NAN,
            ..populated_profile()
        });
        assert_eq!(nan.tts_rate, 1.0, "NaN falls back to the default rate");
    }

    #[test]
    fn delegated_login_base_urls_are_not_http_endpoints() {
        assert!(is_http_endpoint("https://api.openai.com/v1"));
        assert!(is_http_endpoint(""));
        assert!(!is_http_endpoint("omp://openai-codex"));
        assert!(!is_http_endpoint("native://openai-codex"));
    }

    #[test]
    fn http_errors_never_leak_credentials() {
        let auth =
            transcription_http_error(401, "openai", "{\"error\":{\"message\":\"key sk-secret\"}}");
        assert!(!auth.contains("sk-secret"), "401 detail is not echoed: {auth}");
        assert!(auth.contains("Reconnect the provider"));

        let rate = transcription_http_error(429, "openai", "slow down");
        assert!(rate.contains("Rate limited"));

        let other = transcription_http_error(
            500,
            "openai",
            "{\"error\":{\"message\":\"upstream exploded\"}}",
        );
        assert!(
            other.contains("upstream exploded"),
            "a generic failure keeps the upstream reason: {other}"
        );
    }
}

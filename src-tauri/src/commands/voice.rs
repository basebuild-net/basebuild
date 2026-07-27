//! Voice runtime commands.
//!
//! These are boundary shims: they check that a request carries the fields it
//! claims to, then delegate. The security-relevant rules (container
//! allowlist, decoded size cap, credential resolution, engine dispatch) live
//! in [`VoiceService`] so they hold for every caller, not just this one.

use crate::models::voice::{VoiceProfile, VoiceTranscribeRequest, VoiceTranscribeResult};
use crate::services::voice_service::VoiceService;

#[tauri::command]
pub fn voice_profile_get() -> Result<VoiceProfile, String> {
    VoiceService::get_profile()
}

#[tauri::command]
pub fn voice_profile_set(profile: VoiceProfile) -> Result<VoiceProfile, String> {
    VoiceService::set_profile(&profile)
}

#[tauri::command]
pub fn voice_transcribe(request: VoiceTranscribeRequest) -> Result<VoiceTranscribeResult, String> {
    if request.audio_base64.is_empty() {
        return Err("The transcription request carries no audio payload.".to_string());
    }
    if request.mime_type.trim().is_empty() {
        return Err(
            "The transcription request carries no media type, so the recording format cannot be \
             verified."
                .to_string(),
        );
    }
    VoiceService::transcribe(&request)
}

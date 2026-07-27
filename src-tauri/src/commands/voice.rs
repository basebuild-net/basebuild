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

/// Reset the WebView2 microphone permission for the app's origin so the next
/// `getUserMedia` call re-prompts instead of silently failing with a cached
/// "block" decision. On non-Windows platforms this is a no-op success.
///
/// The user can land in a state where they accidentally clicked "Block" on the
/// mic permission prompt. WebView2 caches that per-origin decision in its user
/// data folder, and unpackaged desktop apps do not appear in the Windows mic
/// privacy settings list, so the user has no UI to un-block it. This command
/// uses the WebView2 `ICoreWebView2Profile4::SetPermissionState` API to reset
/// the stored permission to `DEFAULT` (re-prompt on next access).
#[tauri::command]
pub async fn voice_reset_mic_permission(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let webview_window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main webview window not found".to_string())?;
        let url = webview_window
            .url()
            .map_err(|e| format!("Failed to read webview URL: {e}"))?;
        // Origin is scheme://host[:port] with no trailing slash.
        let origin = format!(
            "{}://{}{}",
            url.scheme(),
            url.host_str().unwrap_or(""),
            url.port()
                .map(|p| format!(":{p}"))
                .unwrap_or_default()
        );

        let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
        let origin_for_closure = origin.clone();
        webview_window
            .with_webview(move |webview| {
                use windows_core::Interface;
                use webview2_com::Microsoft::Web::WebView2::Win32::*;
                use webview2_com::SetPermissionStateCompletedHandler;

                let result = (|| -> webview2_com::Result<()> {
                    let controller = webview.controller();
                    let core = unsafe { controller.CoreWebView2()? };
                    // ICoreWebView2_13 exposes the Profile property.
                    let core13: ICoreWebView2_13 = core.cast()?;
                    let profile = unsafe { core13.Profile()? };
                    // ICoreWebView2Profile4 exposes SetPermissionState.
                    let profile4: ICoreWebView2Profile4 = profile.cast()?;

                    let origin_wide: Vec<u16> = origin_for_closure
                        .encode_utf16()
                        .chain(std::iter::once(0))
                        .collect();

                    // Set to DEFAULT so WebView2 re-prompts on next getUserMedia.
                    // wait_for_async_operation creates the completion handler,
                    // calls our closure with it, and pumps messages until the
                    // async COM call finishes. The closure owns the origin
                    // buffer so the PCWSTR stays valid for the COM call.
                    let profile4_clone = profile4.clone();
                    SetPermissionStateCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| {
                            let origin_pcwstr =
                                windows_core::PCWSTR(origin_wide.as_ptr());
                            unsafe {
                                profile4_clone
                                    .SetPermissionState(
                                        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                                        origin_pcwstr,
                                        COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                                        &handler,
                                    )
                                    .map_err(webview2_com::Error::from)
                            }
                        }),
                        Box::new(|_hr| Ok(())),
                    )?;
                    Ok(())
                })();

                let _ = tx.send(result.map_err(|e| {
                    format!("WebView2 SetPermissionState failed: {e}")
                }));
            })
            .map_err(|e| format!("with_webview dispatch failed: {e}"))?;

        rx.await
            .map_err(|e| format!("Permission reset channel closed: {e}"))?
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        // Non-Windows platforms don't use WebView2; no cached permission to
        // reset. The OS-level permission prompt will appear on next access.
        Ok(())
    }
}

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Error as UpdaterPluginError, UpdaterExt};

use crate::services::updater_service::{
    clear_skipped_version, get_skipped_version, set_skipped_version, UpdatePolicy,
};
/// Classified update-channel state for actionable diagnostics.
///
/// `Ok` means the channel responded with a parseable manifest (whether or
/// not a newer version is available). `Err` carries a stable failure class
/// so the frontend can tell release-channel breakage apart from a normal
/// no-update state without leaking plugin internals.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannelStatus {
    /// The updater manifest was fetched and parsed successfully.
    Ok,
    /// The release endpoint returned a non-success response (e.g. HTTP 404
    /// for a missing `latest.json`). Indicates a broken or incomplete release.
    EndpointUnavailable,
    /// The response could not be parsed as a valid updater manifest.
    /// Indicates the release uploaded malformed JSON or the wrong file.
    MalformedManifest,
    /// The manifest is valid but does not include the current platform.
    /// Indicates the release is missing a Windows installer/signature entry.
    PlatformMissing,
    /// A signature for the announced update could not be verified or decoded.
    SignatureInvalid,
    /// The request itself failed (DNS, TLS, proxy, connectivity).
    NetworkUnreachable,
    /// Any other updater failure we have not classified yet.
    Unknown,
}

impl UpdateChannelStatus {
    /// Human-readable explanation suitable for the Settings panel and logs.
    pub fn explanation(&self) -> &'static str {
        match self {
            Self::Ok => "Update channel is healthy.",
            Self::EndpointUnavailable => {
                "The update endpoint returned an unsuccessful response (often HTTP 404). \
                 The latest published release is missing the `latest.json` manifest asset."
            }
            Self::MalformedManifest => {
                "The update endpoint returned a response that could not be parsed as a valid \
                 signed Tauri updater manifest. The release assets may be malformed or the wrong \
                 file was uploaded as `latest.json`."
            }
            Self::PlatformMissing => {
                "The updater manifest is valid but does not include an entry for the current \
                 Windows target. The release is missing the Windows installer or its signature."
            }
            Self::SignatureInvalid => {
                "The update signature could not be verified. The release signature asset may be \
                 missing, empty, or corrupted."
            }
            Self::NetworkUnreachable => {
                "Basebuild could not reach the update endpoint. Check network connectivity, \
                 proxy settings, or DNS for the release host."
            }
            Self::Unknown => {
                "An unexpected updater error occurred. See the raw updater message for details."
            }
        }
    }

    /// Classify a `tauri_plugin_updater::Error` into a stable channel status.
    pub fn from_plugin_error(error: &UpdaterPluginError) -> Self {
        match error {
            UpdaterPluginError::ReleaseNotFound => Self::EndpointUnavailable,
            UpdaterPluginError::Serialization(_) | UpdaterPluginError::Semver(_) => {
                Self::MalformedManifest
            }
            UpdaterPluginError::TargetNotFound(_) | UpdaterPluginError::TargetsNotFound(_) => {
                Self::PlatformMissing
            }
            UpdaterPluginError::Minisign(_)
            | UpdaterPluginError::Base64(_)
            | UpdaterPluginError::SignatureUtf8(_) => Self::SignatureInvalid,
            UpdaterPluginError::Reqwest(_) | UpdaterPluginError::Network(_) => {
                Self::NetworkUnreachable
            }
            UpdaterPluginError::Io(_) => Self::NetworkUnreachable,
            // All remaining variants (including the `zip`-gated Extract variant
            // and any future #[non_exhaustive] additions) fall through to Unknown
            // so the UI still surfaces the raw updater message.
            UpdaterPluginError::EmptyEndpoints
            | UpdaterPluginError::UnsupportedArch
            | UpdaterPluginError::UnsupportedOs
            | UpdaterPluginError::FailedToDetermineExtractPath
            | UpdaterPluginError::UrlParse(_)
            | UpdaterPluginError::TempDirNotOnSameMountPoint
            | UpdaterPluginError::BinaryNotFoundInArchive
            | UpdaterPluginError::TempDirNotFound
            | UpdaterPluginError::AuthenticationFailed
            | UpdaterPluginError::DebInstallFailed
            | UpdaterPluginError::PackageInstallFailed
            | UpdaterPluginError::InvalidUpdaterFormat
            | UpdaterPluginError::Http(_)
            | UpdaterPluginError::InvalidHeaderValue(_)
            | UpdaterPluginError::InvalidHeaderName(_)
            | UpdaterPluginError::FormatDate
            | UpdaterPluginError::InsecureTransportProtocol
            | UpdaterPluginError::Tauri(_) => Self::Unknown,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub target: Option<String>,
    pub download_url: Option<String>,
    /// Classified update-channel state. Always present so the frontend can
    /// distinguish "no update available" from "release channel is broken".
    pub channel_status: UpdateChannelStatus,
    /// Stable, human-readable explanation of `channel_status`.
    pub channel_explanation: String,
    /// Raw updater plugin error message (if any). Useful for maintainers.
    pub raw_error: Option<String>,
    /// Release-channel policy: whether this update is mandatory (running
    /// version is below the supported minimum) and a user-facing summary.
    pub policy: UpdatePolicyInfo,
    /// Whether the user has previously skipped this exact target version.
    /// When `true`, the startup splash should not prompt for this version.
    pub skipped: bool,
}

/// Serializable update policy for the frontend.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicyInfo {
    /// `true` when the running version is below the release channel's
    /// minimum supported version. The splash must hide the skip button
    /// and auto-start the update.
    pub mandatory: bool,
    /// The minimum supported version string (e.g. `"0.1.2"`), if declared.
    pub minimum_supported_version: Option<String>,
    /// Short user-facing summary of the release, if provided by the channel.
    pub release_summary: Option<String>,
}

impl From<&UpdatePolicy> for UpdatePolicyInfo {
    fn from(policy: &UpdatePolicy) -> Self {
        Self {
            mandatory: false, // Set by the caller after comparing to current_version.
            minimum_supported_version: policy.mandatory_below.clone(),
            release_summary: policy.release_summary.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedUpdateManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    target: String,
    url: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
struct StaticUpdateManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: BTreeMap<String, StaticUpdatePlatform>,
}

#[derive(Debug, Deserialize)]
struct StaticUpdatePlatform {
    url: String,
    signature: String,
}

fn parse_static_update_manifest_value(
    value: &serde_json::Value,
    target: &str,
) -> Result<ParsedUpdateManifest, String> {
    let manifest: StaticUpdateManifest = serde_json::from_value(value.clone())
        .map_err(|e| format!("Invalid updater manifest JSON: {e}"))?;

    let version = manifest.version.trim();
    if !is_semver_like(version) {
        return Err(format!(
            "Invalid updater manifest version `{}`; expected SemVer like 0.0.5",
            manifest.version
        ));
    }

    // `target` may be either the bare OS reported by the updater plugin
    // when no explicit `.target()` is configured (e.g. `"windows"`) or a
    // fully-qualified `{os}-{arch}` string (e.g. `"windows-x86_64"`). The
    // manifest's `platforms` keys are fully-qualified and may also carry
    // an installer suffix (`windows-x86_64-nsis`). The plugin's own
    // `get_urls` already resolved the right key; this re-parse only
    // validates that some key for the current target exists. Accept an
    // exact match or any key whose first segment(s) match `target`.
    let platform_key = manifest
        .platforms
        .keys()
        .find(|k| *k == target || k.starts_with(&format!("{target}-")))
        .ok_or_else(|| format!("Updater manifest is missing required platform `{target}`"))?;
    let platform = &manifest.platforms[platform_key];

    let url = platform.url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!(
            "Updater manifest platform `{platform_key}` has invalid URL `{}`",
            platform.url
        ));
    }

    let signature = platform.signature.trim();
    if signature.is_empty() {
        return Err(format!(
            "Updater manifest platform `{platform_key}` has an empty signature"
        ));
    }

    Ok(ParsedUpdateManifest {
        version: version.to_string(),
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        target: platform_key.to_string(),
        url: url.to_string(),
        signature: signature.to_string(),
    })
}

fn is_semver_like(version: &str) -> bool {
    let normalized = version.strip_prefix('v').unwrap_or(version);
    let core = normalized
        .split_once('-')
        .map(|(core, _)| core)
        .unwrap_or(normalized)
        .split_once('+')
        .map(|(core, _)| core)
        .unwrap_or(normalized);

    let mut parts = core.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if is_numeric_identifier(major)
                && is_numeric_identifier(minor)
                && is_numeric_identifier(patch)
    )
}

fn is_numeric_identifier(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
}
/// Dev builds (`cargo tauri dev`, debug assertions on) must never
/// self-update: the dev binary runs as version 0.0.0, so any published
/// release looks "newer" and the silent auto-updater would install the
/// release build over the developer's session and relaunch it.
fn updates_disabled_in_dev() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    if updates_disabled_in_dev() {
        return Ok(UpdateInfo {
            available: false,
            version: None,
            current_version: None,
            notes: Some("Updates are disabled in dev builds.".to_string()),
            date: None,
            target: None,
            download_url: None,
            channel_status: UpdateChannelStatus::Ok,
            channel_explanation: UpdateChannelStatus::Ok.explanation().to_string(),
            raw_error: None,
            policy: UpdatePolicyInfo::default(),
            skipped: false,
        });
    }
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater.check().await.map_err(|e| {
        let status = UpdateChannelStatus::from_plugin_error(&e);
        let explanation = status.explanation();
        format!("Failed to check for updates: {e} | channel_status={status:?} | {explanation}")
    })?;

    match update {
        Some(update) => {
            let parsed = parse_static_update_manifest_value(&update.raw_json, &update.target)?;
            let policy = UpdatePolicy::from_raw_json(&update.raw_json);
            let mandatory = policy.is_mandatory(&update.current_version);
            let skipped_version = get_skipped_version().ok().flatten();
            let skipped = skipped_version
                .as_deref()
                .map(|v| v == update.version.as_str())
                .unwrap_or(false);

            Ok(UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
                current_version: Some(update.current_version.clone()),
                notes: update.body.clone().or(parsed.notes),
                date: update.date.map(|d| d.to_string()).or(parsed.pub_date),
                target: Some(update.target.clone()),
                download_url: Some(update.download_url.to_string()),
                channel_status: UpdateChannelStatus::Ok,
                channel_explanation: UpdateChannelStatus::Ok.explanation().to_string(),
                raw_error: None,
                policy: UpdatePolicyInfo {
                    mandatory,
                    minimum_supported_version: policy.mandatory_below.clone(),
                    release_summary: policy.release_summary.clone(),
                },
                skipped,
            })
        }
        None => Ok(UpdateInfo {
            available: false,
            version: None,
            current_version: None,
            notes: None,
            date: None,
            target: None,
            download_url: None,
            channel_status: UpdateChannelStatus::Ok,
            channel_explanation: UpdateChannelStatus::Ok.explanation().to_string(),
            raw_error: None,
            policy: UpdatePolicyInfo::default(),
            skipped: false,
        }),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if updates_disabled_in_dev() {
        return Err("Updates are disabled in dev builds.".to_string());
    }
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| {
            let status = UpdateChannelStatus::from_plugin_error(&e);
            let explanation = status.explanation();
            format!("Failed to check for updates: {e} | channel_status={status:?} | {explanation}")
        })?
        .ok_or("No update available")?;

    parse_static_update_manifest_value(&update.raw_json, &update.target)?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| {
            let status = UpdateChannelStatus::from_plugin_error(&e);
            let explanation = status.explanation();
            format!("Failed to install update: {e} | channel_status={status:?} | {explanation}")
        })?;

    app.restart();
}

/// Download and install an update with progress events emitted to the
/// frontend. Emits `updater://progress` with `{ step, downloaded, total }`
/// during download, then delegates to the Tauri plugin's install path
/// (NSIS for installer builds, or the portable handoff for portable
/// builds when supported).
#[tauri::command]
pub async fn install_update_with_progress(app: AppHandle) -> Result<(), String> {
    if updates_disabled_in_dev() {
        return Err("Updates are disabled in dev builds.".to_string());
    }
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| {
            let status = UpdateChannelStatus::from_plugin_error(&e);
            let explanation = status.explanation();
            format!("Failed to check for updates: {e} | channel_status={status:?} | {explanation}")
        })?
        .ok_or("No update available")?;

    parse_static_update_manifest_value(&update.raw_json, &update.target)?;

    let app_handle = app.clone();
    let version = update.version.clone();

    let _ = app_handle.emit(
        UPDATER_PROGRESS_EVENT,
        UpdateProgress {
            step: UpdateStep::Downloading.to_string(),
            downloaded: 0,
            total: None,
            message: format!("Downloading Basebuild {version}…"),
        },
    );

    // Use the plugin's download (which verifies signature) then install.
    update
        .download_and_install(
            |chunk_len, content_length| {
                let _ = app_handle.emit(
                    UPDATER_PROGRESS_EVENT,
                    UpdateProgress {
                        step: UpdateStep::Downloading.to_string(),
                        downloaded: chunk_len,
                        total: content_length,
                        message: format!("Downloading Basebuild {version}…"),
                    },
                );
            },
            || {
                let _ = app_handle.emit(
                    UPDATER_PROGRESS_EVENT,
                    UpdateProgress {
                        step: UpdateStep::Installing.to_string(),
                        downloaded: 0,
                        total: None,
                        message: "Installing update…".to_string(),
                    },
                );
            },
        )
        .await
        .map_err(|e| {
            let status = UpdateChannelStatus::from_plugin_error(&e);
            let explanation = status.explanation();
            format!("Failed to install update: {e} | channel_status={status:?} | {explanation}")
        })?;

    let _ = app_handle.emit(
        UPDATER_PROGRESS_EVENT,
        UpdateProgress {
            step: UpdateStep::Restarting.to_string(),
            downloaded: 0,
            total: None,
            message: "Restarting Basebuild…".to_string(),
        },
    );

    app.restart();
}

/// Mark a target version as skipped so the startup splash does not
/// prompt for it again (until a newer version appears).
#[tauri::command]
pub fn skip_update_version(version: String) -> Result<(), String> {
    set_skipped_version(&version)
}

/// Clear any previously skipped version record. Called when the user
/// clicks Upgrade or when a newer version is detected.
#[tauri::command]
pub fn clear_skipped_update() -> Result<(), String> {
    clear_skipped_version()
}

/// Returns the version the user last skipped, if any.
#[tauri::command]
pub fn get_skipped_update_version() -> Result<Option<String>, String> {
    get_skipped_version()
}

/// Event name for update progress events emitted to the frontend.
pub const UPDATER_PROGRESS_EVENT: &str = "updater://progress";

/// Steps in the update progress lifecycle.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub step: String,
    pub downloaded: usize,
    pub total: Option<u64>,
    pub message: String,
}

/// Update lifecycle steps, serialized as strings for the frontend.
#[derive(Debug, Clone)]
pub enum UpdateStep {
    Downloading,
    Installing,
    Restarting,
}

impl UpdateStep {
    pub fn to_string(&self) -> String {
        match self {
            Self::Downloading => "downloading".to_string(),
            Self::Installing => "installing".to_string(),
            Self::Restarting => "restarting".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str, target: &str) -> Result<ParsedUpdateManifest, String> {
        let value: serde_json::Value = serde_json::from_str(json).expect("fixture is valid JSON");
        parse_static_update_manifest_value(&value, target)
    }

    #[test]
    fn parses_github_release_latest_json_for_windows() {
        let manifest = parse(
            r#"{
                "version": "0.0.5",
                "notes": "Download the installer below to update Basebuild.",
                "pub_date": "2026-07-01T14:30:00Z",
                "platforms": {
                    "windows-x86_64": {
                        "signature": "trusted minisign signature",
                        "url": "https://github.com/basebuild-net/basebuild/releases/download/v0.0.5/Basebuild_0.0.5_x64-setup.exe"
                    }
                }
            }"#,
            "windows-x86_64",
        )
        .expect("manifest should parse");

        assert_eq!(manifest.version, "0.0.5");
        assert_eq!(manifest.target, "windows-x86_64");
        assert_eq!(
            manifest.url,
            "https://github.com/basebuild-net/basebuild/releases/download/v0.0.5/Basebuild_0.0.5_x64-setup.exe"
        );
        assert_eq!(manifest.signature, "trusted minisign signature");
    }

    #[test]
    fn accepts_leading_v_versions_from_release_tags() {
        let manifest = parse(
            r#"{
                "version": "v0.0.5",
                "platforms": {
                    "windows-x86_64": {
                        "signature": "sig",
                        "url": "https://github.com/basebuild-net/basebuild/releases/download/v0.0.5/Basebuild_0.0.5_x64-setup.exe"
                    }
                }
            }"#,
            "windows-x86_64",
        )
        .expect("manifest should parse");

        assert_eq!(manifest.version, "v0.0.5");
    }

    #[test]
    fn resolves_bare_os_target_to_fully_qualified_platform_key() {
        // Regression: the updater plugin reports `target = "windows"` when
        // no explicit `.target()` is configured, but the manifest uses
        // fully-qualified keys (`windows-x86_64`, `windows-x86_64-nsis`).
        // The parser must not reject a manifest that the plugin already
        // accepted as a valid update.
        let manifest = parse(
            r#"{
                "version": "0.0.7",
                "platforms": {
                    "windows-x86_64": {
                        "signature": "sig",
                        "url": "https://github.com/basebuild-net/basebuild/releases/download/v0.0.7/Basebuild_0.0.7_x64-setup.exe"
                    }
                }
            }"#,
            "windows",
        )
        .expect("bare-OS target should resolve to windows-x86_64");

        assert_eq!(manifest.version, "0.0.7");
        assert_eq!(manifest.target, "windows-x86_64");
    }

    #[test]
    fn resolves_bare_os_target_to_nsis_suffixed_platform_key() {
        // When the manifest carries both the bare and the `-nsis` suffixed
        // key, either is acceptable — the plugin's own `get_urls` already
        // picked the right one. This test just confirms the suffix form
        // does not trip the lookup.
        let manifest = parse(
            r#"{
                "version": "0.0.7",
                "platforms": {
                    "windows-x86_64-nsis": {
                        "signature": "sig",
                        "url": "https://github.com/basebuild-net/basebuild/releases/download/v0.0.7/Basebuild_0.0.7_x64-setup.exe"
                    }
                }
            }"#,
            "windows",
        )
        .expect("bare-OS target should resolve to windows-x86_64-nsis");

        assert_eq!(manifest.target, "windows-x86_64-nsis");
    }

    #[test]
    fn rejects_missing_target_platform() {
        let error = parse(
            r#"{
                "version": "0.0.5",
                "platforms": {
                    "linux-x86_64": {
                        "signature": "sig",
                        "url": "https://example.com/Basebuild.AppImage"
                    }
                }
            }"#,
            "windows-x86_64",
        )
        .expect_err("missing Windows target should fail");

        assert!(error.contains("windows-x86_64"));
    }

    #[test]
    fn rejects_empty_signature() {
        let error = parse(
            r#"{
                "version": "0.0.5",
                "platforms": {
                    "windows-x86_64": {
                        "signature": "",
                        "url": "https://github.com/basebuild-net/basebuild/releases/download/v0.0.5/Basebuild_0.0.5_x64-setup.exe"
                    }
                }
            }"#,
            "windows-x86_64",
        )
        .expect_err("empty signatures should fail");

        assert!(error.contains("empty signature"));
    }

    #[test]
    fn classifies_release_not_found_as_endpoint_unavailable() {
        // This is the observed regression: the latest release has no latest.json,
        // so the updater plugin returns ReleaseNotFound (HTTP 404 / non-success).
        let status = UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::ReleaseNotFound);
        assert_eq!(status, UpdateChannelStatus::EndpointUnavailable);
        assert!(
            status.explanation().contains("404"),
            "explanation should mention HTTP 404 for endpoint unavailable: {}",
            status.explanation()
        );
    }

    #[test]
    fn classifies_serialization_error_as_malformed_manifest() {
        // The endpoint returned something, but it wasn't a valid updater manifest.
        let err = serde_json::from_str::<serde_json::Value>("not json")
            .err()
            .unwrap();
        let status =
            UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::Serialization(err));
        assert_eq!(status, UpdateChannelStatus::MalformedManifest);
        assert!(
            status.explanation().contains("malformed"),
            "explanation should mention malformed manifest: {}",
            status.explanation()
        );
    }

    #[test]
    fn classifies_target_not_found_as_platform_missing() {
        // The manifest parsed but has no windows-x86_64 entry.
        let status = UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::TargetNotFound(
            "windows-x86_64".to_string(),
        ));
        assert_eq!(status, UpdateChannelStatus::PlatformMissing);
        assert!(
            status.explanation().contains("Windows"),
            "explanation should mention Windows platform: {}",
            status.explanation()
        );
    }

    #[test]
    fn classifies_signature_error_as_signature_invalid() {
        // SignatureUtf8 wraps a String and exercises the same SignatureInvalid
        // classification path as Minisign/Base64 errors, without requiring
        // minisign_verify as a direct dependency.
        let status = UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::SignatureUtf8(
            "not base64".to_string(),
        ));
        assert_eq!(status, UpdateChannelStatus::SignatureInvalid);
        assert!(
            status.explanation().contains("signature"),
            "explanation should mention signature: {}",
            status.explanation()
        );
    }

    #[test]
    fn classifies_network_error_as_network_unreachable() {
        let status = UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::Network(
            "connection refused".to_string(),
        ));
        assert_eq!(status, UpdateChannelStatus::NetworkUnreachable);
        assert!(
            status.explanation().contains("network"),
            "explanation should mention network: {}",
            status.explanation()
        );
    }

    #[test]
    fn classifies_unknown_errors_without_panicking() {
        // Any future #[non_exhaustive] variant should fall through to Unknown.
        let status = UpdateChannelStatus::from_plugin_error(&UpdaterPluginError::EmptyEndpoints);
        assert_eq!(status, UpdateChannelStatus::Unknown);
        assert!(
            status.explanation().contains("unexpected"),
            "explanation should mention unexpected error: {}",
            status.explanation()
        );
    }

    #[test]
    fn ok_status_explanation_is_non_actionable() {
        let status = UpdateChannelStatus::Ok;
        assert!(!status.explanation().is_empty());
        // Ok explanation should not contain error-actionable language.
        assert!(
            !status.explanation().contains("404"),
            "Ok status should not mention 404: {}",
            status.explanation()
        );
    }
    #[test]
    fn policy_marks_old_version_as_mandatory() {
        let raw = serde_json::json!({
            "version": "0.1.2",
            "minimumSupportedVersion": "0.1.0"
        });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert!(
            policy.is_mandatory("0.0.3"),
            "0.0.3 < 0.1.0 should be mandatory"
        );
        assert!(
            !policy.is_mandatory("0.1.0"),
            "0.1.0 >= 0.1.0 should be optional"
        );
        assert!(
            !policy.is_mandatory("0.1.5"),
            "0.1.5 >= 0.1.0 should be optional"
        );
    }

    #[test]
    fn policy_with_no_threshold_is_optional() {
        let raw = serde_json::json!({ "version": "0.1.2" });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert!(
            !policy.is_mandatory("0.0.1"),
            "no threshold means always optional"
        );
    }

    #[test]
    fn policy_extracts_release_summary() {
        let raw = serde_json::json!({
            "version": "0.1.2",
            "releaseSummary": "Critical security update"
        });
        let policy = UpdatePolicy::from_raw_json(&raw);
        assert_eq!(
            policy.release_summary.as_deref(),
            Some("Critical security update")
        );
    }

    #[test]
    fn policy_skipped_version_check() {
        // When the user skipped 0.1.2 and the manifest announces 0.1.2,
        // the frontend should suppress the startup prompt.
        let skipped = Some("0.1.2".to_string());
        let target = "0.1.2";
        let is_skipped = skipped.as_deref().map(|v| v == target).unwrap_or(false);
        assert!(is_skipped, "matching skipped version should be true");

        // A newer version (0.1.3) should clear the skip implicitly.
        let target_new = "0.1.3";
        let is_skipped_new = skipped.as_deref().map(|v| v == target_new).unwrap_or(false);
        assert!(
            !is_skipped_new,
            "non-matching version should not be skipped"
        );
    }
}

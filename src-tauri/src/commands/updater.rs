use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

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

    let platform = manifest
        .platforms
        .get(target)
        .ok_or_else(|| format!("Updater manifest is missing required platform `{target}`"))?;

    let url = platform.url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!(
            "Updater manifest platform `{target}` has invalid URL `{}`",
            platform.url
        ));
    }

    let signature = platform.signature.trim();
    if signature.is_empty() {
        return Err(format!(
            "Updater manifest platform `{target}` has an empty signature"
        ));
    }

    Ok(ParsedUpdateManifest {
        version: version.to_string(),
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        target: target.to_string(),
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

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    match update {
        Some(update) => {
            let parsed = parse_static_update_manifest_value(&update.raw_json, &update.target)?;
            Ok(UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
                current_version: Some(update.current_version.clone()),
                notes: update.body.clone().or(parsed.notes),
                date: update.date.map(|d| d.to_string()).or(parsed.pub_date),
                target: Some(update.target.clone()),
                download_url: Some(update.download_url.to_string()),
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
        }),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Failed to get updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?
        .ok_or("No update available")?;

    parse_static_update_manifest_value(&update.raw_json, &update.target)?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Failed to install update: {e}"))?;

    app.restart();
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
}

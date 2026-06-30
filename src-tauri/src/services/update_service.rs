use reqwest::blocking::get;

use crate::models::release::ReleaseManifest;

#[derive(Debug, Default)]
pub struct UpdateService;

impl UpdateService {
    pub fn check(url: &str, current_version: &str) -> Result<UpdateCheckResult, String> {
        let manifest: ReleaseManifest = get(url)
            .map_err(|error| format!("Failed to fetch release manifest: {error}"))?
            .json()
            .map_err(|error| format!("Failed to parse release manifest: {error}"))?;

        let needs_update = Self::is_newer(&manifest.version, current_version);

        Ok(UpdateCheckResult {
            current_version: current_version.to_string(),
            latest_version: manifest.version.clone(),
            needs_update,
            notes: manifest.notes.clone(),
            url: url.to_string(),
            manifest,
        })
    }

    fn is_newer(latest: &str, current: &str) -> bool {
        let latest = Self::parse_semver(latest);
        let current = Self::parse_semver(current);
        latest > current
    }

    fn parse_semver(version: &str) -> (u64, u64, u64) {
        let parts: Vec<&str> = version.trim_start_matches('v').split('.').collect();
        (
            parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
        )
    }
}

#[derive(Debug, Clone)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub needs_update: bool,
    pub notes: String,
    pub url: String,
    pub manifest: ReleaseManifest,
}

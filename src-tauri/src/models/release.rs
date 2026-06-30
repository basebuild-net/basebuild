use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: ReleasePlatforms,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePlatforms {
    #[serde(rename = "windows-x86_64")]
    pub windows_x86_64: Option<ReleaseArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseArtifact {
    pub signature: String,
    pub url: String,
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCard {
    pub id: String,
    pub title: String,
    pub installed_version: Option<String>,
    pub available_version: Option<String>,
    pub source: UpdateSource,
    pub action: UpdateAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateSource {
    App,
    ConfigPack,
    Requirement,
    SkillOrPlugin,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateAction {
    None,
    Install,
    Review,
    OpenUrl,
    Recheck,
}

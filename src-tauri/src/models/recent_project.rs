use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_at: i64,
    pub last_active_session_id: Option<String>,
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementStatus {
    pub id: String,
    pub label: String,
    pub required: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub severity: RequirementSeverity,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequirementSeverity {
    Ok,
    Attention,
    Error,
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: u64,
    pub shell: String,
    pub cwd: Option<String>,
    pub pid: Option<u32>,
    pub rows: u16,
    pub cols: u16,
    pub started_at: u64,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub id: u64,
    pub data: String,
}

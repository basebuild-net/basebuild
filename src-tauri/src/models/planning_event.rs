use serde::{Deserialize, Serialize};

/// Typed planning domain event kinds emitted on the `planning://event` channel.
/// One channel carries every planning mutation so consumers (inspector, flow
/// board, notifications) subscribe once and dispatch on `kind`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanningEventKind {
    // Plan lifecycle
    PlanCreated,
    PlanUpdated,
    PlanStatusChanged,
    // Idea lifecycle
    IdeaCaptured,
    IdeaUpdated,
    IdeaStatusChanged,
    // Category lifecycle
    CategoryCreated,
    CategoryUpdated,
    // Schematic
    SchematicUpdated,
    // Pipeline (generation) stage transitions
    StageStarted,
    StageSucceeded,
    StageFailed,
    StageCancelled,
    // Plan runs
    RunStarted,
    RunFinished,
    RunFailed,
    // Integration queue actions (merge/test/prune)
    IntegrationAction,
    // OpenSpec task progress (tasks.md toggle / agent edit)
    TaskProgressChanged,
}

impl PlanningEventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanningEventKind::PlanCreated => "plan_created",
            PlanningEventKind::PlanUpdated => "plan_updated",
            PlanningEventKind::PlanStatusChanged => "plan_status_changed",
            PlanningEventKind::IdeaCaptured => "idea_captured",
            PlanningEventKind::IdeaUpdated => "idea_updated",
            PlanningEventKind::IdeaStatusChanged => "idea_status_changed",
            PlanningEventKind::CategoryCreated => "category_created",
            PlanningEventKind::CategoryUpdated => "category_updated",
            PlanningEventKind::SchematicUpdated => "schematic_updated",
            PlanningEventKind::StageStarted => "stage_started",
            PlanningEventKind::StageSucceeded => "stage_succeeded",
            PlanningEventKind::StageFailed => "stage_failed",
            PlanningEventKind::StageCancelled => "stage_cancelled",
            PlanningEventKind::RunStarted => "run_started",
            PlanningEventKind::RunFinished => "run_finished",
            PlanningEventKind::RunFailed => "run_failed",
            PlanningEventKind::IntegrationAction => "integration_action",
            PlanningEventKind::TaskProgressChanged => "task_progress_changed",
        }
    }
}

/// Event payload emitted on the `planning://event` channel for every planning
/// domain mutation.
///
/// Contract:
/// - `seq` is a per-app-run monotonic sequence number. Consumers detect gaps
///   (e.g. after webview reload) and refetch the catalog rather than rendering
///   stale counts.
/// - `ts` is epoch milliseconds.
/// - Payloads MUST NOT carry prompt text, file contents, secrets, or raw
///   absolute paths beyond `project_path`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningEvent {
    pub kind: PlanningEventKind,
    pub entity_id: String,
    pub project_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub seq: u64,
    pub ts: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&PlanningEventKind::PlanStatusChanged).unwrap(),
            "\"plan_status_changed\""
        );
        assert_eq!(
            serde_json::to_string(&PlanningEventKind::IdeaCaptured).unwrap(),
            "\"idea_captured\""
        );
        assert_eq!(
            serde_json::to_string(&PlanningEventKind::StageSucceeded).unwrap(),
            "\"stage_succeeded\""
        );
    }

    #[test]
    fn payload_omits_optional_fields_when_none() {
        let event = PlanningEvent {
            kind: PlanningEventKind::PlanCreated,
            entity_id: "plan_x7k2p1".into(),
            project_path: "/repo/app".into(),
            session_id: None,
            title: "Add dark mode".into(),
            detail: None,
            seq: 3,
            ts: 1_720_000_000_000,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(
            !json.contains("sessionId"),
            "sessionId should be omitted: {json}"
        );
        assert!(!json.contains("detail"), "detail should be omitted: {json}");
        assert!(!json.contains("projectId"), "no projectId field");
        assert!(json.contains("\"entityId\":\"plan_x7k2p1\""));
        assert!(json.contains("\"projectPath\":\"/repo/app\""));
        assert!(json.contains("\"seq\":3"));
        assert!(json.contains("\"kind\":\"plan_created\""));
    }

    #[test]
    fn payload_includes_optional_fields_when_present() {
        let event = PlanningEvent {
            kind: PlanningEventKind::IdeaCaptured,
            entity_id: "idea_abc".into(),
            project_path: "/repo/app".into(),
            session_id: Some("sess_1".into()),
            title: "Idea title".into(),
            detail: Some("captured via propose_ideas".into()),
            seq: 5,
            ts: 1_720_000_000_000,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"sessionId\":\"sess_1\""));
        assert!(json.contains("\"detail\":\"captured via propose_ideas\""));
    }

    #[test]
    fn payload_round_trips_through_json() {
        let original = PlanningEvent {
            kind: PlanningEventKind::RunFinished,
            entity_id: "run_42".into(),
            project_path: "/repo/app".into(),
            session_id: Some("sess_9".into()),
            title: "Run finished".into(),
            detail: None,
            seq: 11,
            ts: 1_720_000_000_000,
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: PlanningEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kind, PlanningEventKind::RunFinished);
        assert_eq!(parsed.entity_id, "run_42");
        assert_eq!(parsed.session_id.as_deref(), Some("sess_9"));
        assert_eq!(parsed.seq, 11);
    }
}

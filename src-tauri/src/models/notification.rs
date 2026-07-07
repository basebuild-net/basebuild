use serde::{Deserialize, Serialize};

/// Notification kinds matching `PlanningEventKind` but specialized for
/// notification delivery. One row per notification-worthy planning event.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    PlanCreated,
    PlanStatusChanged,
    IdeaCaptured,
    IdeaStatusChanged,
    CategoryCreated,
    SchematicUpdated,
    StageStarted,
    StageSucceeded,
    StageFailed,
    StageCancelled,
    RunStarted,
    RunFinished,
    RunFailed,
    IntegrationAction,
    PendingQuestion,
    SchematicDriftSuspected,
}

impl NotificationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            NotificationKind::PlanCreated => "plan_created",
            NotificationKind::PlanStatusChanged => "plan_status_changed",
            NotificationKind::IdeaCaptured => "idea_captured",
            NotificationKind::IdeaStatusChanged => "idea_status_changed",
            NotificationKind::CategoryCreated => "category_created",
            NotificationKind::SchematicUpdated => "schematic_updated",
            NotificationKind::StageStarted => "stage_started",
            NotificationKind::StageSucceeded => "stage_succeeded",
            NotificationKind::StageFailed => "stage_failed",
            NotificationKind::StageCancelled => "stage_cancelled",
            NotificationKind::RunStarted => "run_started",
            NotificationKind::RunFinished => "run_finished",
            NotificationKind::RunFailed => "run_failed",
            NotificationKind::IntegrationAction => "integration_action",
            NotificationKind::PendingQuestion => "pending_question",
            NotificationKind::SchematicDriftSuspected => "schematic_drift_suspected",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "plan_created" => Some(NotificationKind::PlanCreated),
            "plan_status_changed" => Some(NotificationKind::PlanStatusChanged),
            "idea_captured" => Some(NotificationKind::IdeaCaptured),
            "idea_status_changed" => Some(NotificationKind::IdeaStatusChanged),
            "category_created" => Some(NotificationKind::CategoryCreated),
            "schematic_updated" => Some(NotificationKind::SchematicUpdated),
            "stage_started" => Some(NotificationKind::StageStarted),
            "stage_succeeded" => Some(NotificationKind::StageSucceeded),
            "stage_failed" => Some(NotificationKind::StageFailed),
            "stage_cancelled" => Some(NotificationKind::StageCancelled),
            "run_started" => Some(NotificationKind::RunStarted),
            "run_finished" => Some(NotificationKind::RunFinished),
            "run_failed" => Some(NotificationKind::RunFailed),
            "integration_action" => Some(NotificationKind::IntegrationAction),
            "pending_question" => Some(NotificationKind::PendingQuestion),
            "schematic_drift_suspected" => Some(NotificationKind::SchematicDriftSuspected),
            _ => None,
        }
    }
}

/// Per-kind delivery setting: where the notification surfaces.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationDelivery {
    /// Toast + notification center (default for high-signal events).
    ToastAndCenter,
    /// Notification center only, no toast (default for idea/category events).
    CenterOnly,
    /// Suppressed entirely.
    Off,
}

impl NotificationDelivery {
    pub fn as_str(&self) -> &'static str {
        match self {
            NotificationDelivery::ToastAndCenter => "toast_and_center",
            NotificationDelivery::CenterOnly => "center_only",
            NotificationDelivery::Off => "off",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "toast_and_center" => NotificationDelivery::ToastAndCenter,
            "off" => NotificationDelivery::Off,
            _ => NotificationDelivery::CenterOnly,
        }
    }

    /// Conservative default delivery per kind. High-signal events (run
    /// finish/fail, plan created, pending questions, integration results) default
    /// to toast + center; idea/category-level events default to center-only.
    pub fn default_for(kind: NotificationKind) -> Self {
        match kind {
            NotificationKind::RunFinished
            | NotificationKind::RunFailed
            | NotificationKind::RunStarted
            | NotificationKind::PlanCreated
            | NotificationKind::PlanStatusChanged
            | NotificationKind::PendingQuestion
            | NotificationKind::IntegrationAction
            | NotificationKind::SchematicDriftSuspected
            | NotificationKind::StageFailed
            | NotificationKind::StageSucceeded => NotificationDelivery::ToastAndCenter,
            NotificationKind::IdeaCaptured
            | NotificationKind::IdeaStatusChanged
            | NotificationKind::CategoryCreated
            | NotificationKind::SchematicUpdated
            | NotificationKind::StageStarted
            | NotificationKind::StageCancelled => NotificationDelivery::CenterOnly,
        }
    }
}

/// A persisted notification row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub kind: NotificationKind,
    pub entity_id: String,
    pub entity_kind: String,
    pub project_path: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub read: bool,
    pub created_at: i64,
}

/// Per-kind delivery settings map. Stored as JSON in `app_defaults`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    /// Maps kind string → delivery setting. Absent = default_for(kind).
    #[serde(default)]
    pub overrides: std::collections::HashMap<String, String>,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            overrides: std::collections::HashMap::new(),
        }
    }
}

impl NotificationSettings {
    /// Resolve the effective delivery for a kind: override if set, else default.
    pub fn effective(&self, kind: NotificationKind) -> NotificationDelivery {
        self.overrides
            .get(kind.as_str())
            .map(|s| NotificationDelivery::from_str(s))
            .unwrap_or_else(|| NotificationDelivery::default_for(kind))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips() {
        for kind in [
            NotificationKind::PlanCreated,
            NotificationKind::RunFinished,
            NotificationKind::PendingQuestion,
            NotificationKind::SchematicDriftSuspected,
        ] {
            let s = kind.as_str();
            assert_eq!(NotificationKind::from_str(s), Some(kind));
        }
        assert_eq!(NotificationKind::from_str("nonsense"), None);
    }

    #[test]
    fn delivery_defaults_are_conservative() {
        // High-signal events default to toast + center.
        assert_eq!(
            NotificationDelivery::default_for(NotificationKind::RunFinished),
            NotificationDelivery::ToastAndCenter
        );
        assert_eq!(
            NotificationDelivery::default_for(NotificationKind::PendingQuestion),
            NotificationDelivery::ToastAndCenter
        );
        // Idea/category events default to center-only.
        assert_eq!(
            NotificationDelivery::default_for(NotificationKind::IdeaCaptured),
            NotificationDelivery::CenterOnly
        );
    }

    #[test]
    fn settings_override_takes_precedence() {
        let mut settings = NotificationSettings::default();
        assert_eq!(
            settings.effective(NotificationKind::RunFinished),
            NotificationDelivery::ToastAndCenter
        );
        settings
            .overrides
            .insert("run_finished".to_string(), "off".to_string());
        assert_eq!(
            settings.effective(NotificationKind::RunFinished),
            NotificationDelivery::Off
        );
    }
}

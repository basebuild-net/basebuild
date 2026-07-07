use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Runtime};

use crate::events::PLANNING_EVENT;
use crate::models::planning_event::{PlanningEvent, PlanningEventKind};

/// Process-wide monotonic sequence counter. Every emitted planning event
/// increments this; consumers detect gaps (e.g. after webview reload) and
/// refetch the catalog rather than rendering stale counts.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Emit a typed planning event on the `planning://event` channel.
///
/// Call this at every planning domain mutation point: plan create/update/
/// status-change, idea capture/status-change, category create/update,
/// schematic write, pipeline stage transition, plan run start/finish/fail,
/// and integration actions.
///
/// Payloads MUST NOT carry prompt text, file contents, secrets, or raw
/// absolute paths beyond `project_path`.
pub fn emit<R: Runtime>(
    app: &AppHandle<R>,
    kind: PlanningEventKind,
    entity_id: impl Into<String>,
    project_path: impl Into<String>,
    session_id: Option<String>,
    title: impl Into<String>,
    detail: Option<String>,
) {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let event = PlanningEvent {
        kind,
        entity_id: entity_id.into(),
        project_path: project_path.into(),
        session_id,
        title: title.into(),
        detail,
        seq,
        ts,
    };
    // Emission is best-effort: a webview that isn't listening yet (early
    // startup, no subscriber) simply drops the event. The seq counter keeps
    // advancing so the first event a late subscriber sees has the correct gap.
    let _ = app.emit(PLANNING_EVENT, event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seq_advances_monotonically() {
        // fetch_add returns the previous value; +1 makes the first emit 1.
        let a = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        let b = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        assert_eq!(b, a + 1, "seq must advance by 1 per emit");
    }

    #[test]
    fn kind_as_str_covers_all_variants() {
        // Smoke-check every variant has a stable string. New variants must
        // update both the enum and as_str or serialization drifts.
        let cases = [
            (PlanningEventKind::PlanCreated, "plan_created"),
            (PlanningEventKind::PlanUpdated, "plan_updated"),
            (PlanningEventKind::PlanStatusChanged, "plan_status_changed"),
            (PlanningEventKind::IdeaCaptured, "idea_captured"),
            (PlanningEventKind::IdeaStatusChanged, "idea_status_changed"),
            (PlanningEventKind::CategoryCreated, "category_created"),
            (PlanningEventKind::CategoryUpdated, "category_updated"),
            (PlanningEventKind::SchematicUpdated, "schematic_updated"),
            (PlanningEventKind::StageStarted, "stage_started"),
            (PlanningEventKind::StageSucceeded, "stage_succeeded"),
            (PlanningEventKind::StageFailed, "stage_failed"),
            (PlanningEventKind::StageCancelled, "stage_cancelled"),
            (PlanningEventKind::RunStarted, "run_started"),
            (PlanningEventKind::RunFinished, "run_finished"),
            (PlanningEventKind::RunFailed, "run_failed"),
            (PlanningEventKind::IntegrationAction, "integration_action"),
        ];
        for (kind, expected) in cases {
            assert_eq!(kind.as_str(), expected);
        }
    }
}

import { useCallback, useEffect, useState } from "react";
import { OptionList } from "../OptionList";
import { SkeletonRows } from "../Loading";
import {
  notificationGetSettings,
  notificationSetSettings,
  type NotificationSettings as NotificationSettingsType,
  type NotificationDelivery,
} from "../../../lib/notifications";

const NOTIFICATION_KIND_LABELS: { kind: string; label: string; defaultDelivery: NotificationDelivery }[] = [
  { kind: "run_finished", label: "Run finished", defaultDelivery: "toast_and_center" },
  { kind: "run_failed", label: "Run failed", defaultDelivery: "toast_and_center" },
  { kind: "run_started", label: "Run started", defaultDelivery: "toast_and_center" },
  { kind: "plan_created", label: "Plan created", defaultDelivery: "toast_and_center" },
  { kind: "plan_status_changed", label: "Plan status changed", defaultDelivery: "toast_and_center" },
  { kind: "pending_question", label: "Pending question", defaultDelivery: "toast_and_center" },
  { kind: "integration_action", label: "Integration results", defaultDelivery: "toast_and_center" },
  { kind: "schematic_drift_suspected", label: "Schematic drift", defaultDelivery: "toast_and_center" },
  { kind: "stage_succeeded", label: "Stage succeeded", defaultDelivery: "toast_and_center" },
  { kind: "stage_failed", label: "Stage failed", defaultDelivery: "toast_and_center" },
  { kind: "idea_status_changed", label: "Idea status changed", defaultDelivery: "center_only" },
  { kind: "category_created", label: "Category created", defaultDelivery: "center_only" },
  { kind: "schematic_updated", label: "Schematic updated", defaultDelivery: "center_only" },
  { kind: "stage_started", label: "Stage started", defaultDelivery: "center_only" },
  { kind: "stage_cancelled", label: "Stage cancelled", defaultDelivery: "center_only" },
];

const DELIVERY_LABELS: { id: NotificationDelivery; label: string; title: string }[] = [
  { id: "toast_and_center", label: "Toast + Center", title: "Toast + Center" },
  { id: "center_only", label: "Center only", title: "Center only" },
  { id: "off", label: "Off", title: "Off" },
];

export function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettingsType | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // A failed read must surface as an error, not as a skeleton that never ends.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void notificationGetSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const effective = (kind: string, defaultDelivery: NotificationDelivery): NotificationDelivery =>
    (settings?.overrides[kind] as NotificationDelivery | undefined) ?? defaultDelivery;
  const save = useCallback(async (kind: string, delivery: NotificationDelivery, defaultDelivery: NotificationDelivery) => {
    if (!settings) return;
    setSaving(kind);
    try {
      const newOverrides = { ...settings.overrides };
      if (delivery === defaultDelivery) {
        delete newOverrides[kind];
      } else {
        newOverrides[kind] = delivery;
      }
      const updated = { overrides: newOverrides };
      await notificationSetSettings(updated);
      setSettings(updated);
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  }, [settings]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Notification delivery</h3>
      <p className="text-muted text-sm" title="Per-kind delivery: toast + center, center only, or off. Changes apply immediately.">
        Control where each event type surfaces. Defaults are conservative (high-signal events toast + center; idea/category events center only).
      </p>
      <div className="settings-list">
        {error ? (
          <p className="text-danger text-sm">{error}</p>
        ) : loading ? (
          <SkeletonRows rows={6} label="Loading notification settings…" />
        ) : NOTIFICATION_KIND_LABELS.map(({ kind, label, defaultDelivery }) => (
          <div key={kind} className="settings-row">
            <span className="settings-label" title={`Default: ${defaultDelivery}`}>{label}</span>
            <OptionList
              label={`Delivery for ${label}`}
              value={effective(kind, defaultDelivery)}
              compact
              disabled={saving === kind}
              onChange={(v) => void save(kind, v, defaultDelivery)}
              options={DELIVERY_LABELS}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

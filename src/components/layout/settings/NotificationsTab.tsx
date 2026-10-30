import { useCallback, useEffect, useState } from "react";
import { OptionList } from "../OptionList";
import { SkeletonRows } from "../Loading";
import {
  notificationGetSettings,
  notificationSetSettings,
  type NotificationSettings as NotificationSettingsType,
  type NotificationDelivery,
} from "../../../lib/notifications";
import { t } from "../../../i18n";

const NOTIFICATION_KIND_LABELS = (): { kind: string; label: string; defaultDelivery: NotificationDelivery }[] => [
  { kind: "run_finished", label: t("notificationsTab.runFinished"), defaultDelivery: "toast_and_center" },
  { kind: "run_failed", label: t("notificationsTab.runFailed"), defaultDelivery: "toast_and_center" },
  { kind: "run_started", label: t("notificationsTab.runStarted"), defaultDelivery: "toast_and_center" },
  { kind: "plan_created", label: t("notificationsTab.planCreated"), defaultDelivery: "toast_and_center" },
  { kind: "plan_status_changed", label: t("notificationsTab.planStatusChanged"), defaultDelivery: "toast_and_center" },
  { kind: "pending_question", label: t("notificationsTab.pendingQuestion"), defaultDelivery: "toast_and_center" },
  { kind: "integration_action", label: t("notificationsTab.integrationResults"), defaultDelivery: "toast_and_center" },
  { kind: "schematic_drift_suspected", label: t("notificationsTab.schematicDrift"), defaultDelivery: "toast_and_center" },
  { kind: "stage_succeeded", label: t("notificationsTab.stageSucceeded"), defaultDelivery: "toast_and_center" },
  { kind: "stage_failed", label: t("notificationsTab.stageFailed"), defaultDelivery: "toast_and_center" },
  { kind: "idea_status_changed", label: t("notificationsTab.ideaStatusChanged"), defaultDelivery: "center_only" },
  { kind: "category_created", label: t("notificationsTab.categoryCreated"), defaultDelivery: "center_only" },
  { kind: "schematic_updated", label: t("notificationsTab.schematicUpdated"), defaultDelivery: "center_only" },
  { kind: "stage_started", label: t("notificationsTab.stageStarted"), defaultDelivery: "center_only" },
  { kind: "stage_cancelled", label: t("notificationsTab.stageCancelled"), defaultDelivery: "center_only" },
];

const DELIVERY_LABELS = (): { id: NotificationDelivery; label: string; title: string }[] => [
  { id: "toast_and_center", label: t("notificationsTab.toastCenter"), title: t("notificationsTab.toastCenter") },
  { id: "center_only", label: t("notificationsTab.centerOnly"), title: t("notificationsTab.centerOnly") },
  { id: "off", label: t("notificationsTab.off"), title: t("notificationsTab.off") },
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
      <h3 className="settings-section-title">{t("notificationsTab.notificationDelivery")}</h3>
      <p className="text-muted text-sm" title={t("notificationsTab.perKindDeliveryToastCenter")}>
        {t("notificationsTab.controlWhereEachEventType")}
      </p>
      <div className="settings-list">
        {error ? (
          <p className="text-danger text-sm">{error}</p>
        ) : loading ? (
          <SkeletonRows rows={6} label={t("notificationsTab.loadingNotificationSettings")} />
        ) : NOTIFICATION_KIND_LABELS().map(({ kind, label, defaultDelivery }) => (
          <div key={kind} className="settings-row">
            <span className="settings-label" title={t("notificationsTab.default", { defaultDelivery: defaultDelivery })}>{label}</span>
            <OptionList
              label={t("notificationsTab.deliveryFor", { label: label })}
              value={effective(kind, defaultDelivery)}
              compact
              disabled={saving === kind}
              onChange={(v) => void save(kind, v, defaultDelivery)}
              options={DELIVERY_LABELS()}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

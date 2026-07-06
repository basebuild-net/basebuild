import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type NotificationKind =
  | "plan_created"
  | "plan_status_changed"
  | "idea_captured"
  | "idea_status_changed"
  | "category_created"
  | "schematic_updated"
  | "stage_started"
  | "stage_succeeded"
  | "stage_failed"
  | "stage_cancelled"
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "integration_action"
  | "pending_question"
  | "schematic_drift_suspected";

export type NotificationDelivery = "toast_and_center" | "center_only" | "off";

export type Notification = {
  id: string;
  kind: NotificationKind;
  entityId: string;
  entityKind: string;
  projectPath: string;
  title: string;
  detail?: string;
  read: boolean;
  createdAt: number;
};

export type NotificationSettings = {
  overrides: Record<string, string>;
};

export async function notificationList(
  limit = 100,
  offset = 0,
): Promise<Notification[]> {
  return invoke<Notification[]>("notification_list", { limit, offset });
}

export async function notificationUnreadCount(): Promise<number> {
  return invoke<number>("notification_unread_count");
}

export async function notificationMarkRead(id: string): Promise<void> {
  await invoke("notification_mark_read", { id });
}

export async function notificationMarkAllRead(): Promise<void> {
  await invoke("notification_mark_all_read");
}

export async function notificationDelete(id: string): Promise<void> {
  await invoke("notification_delete", { id });
}

export async function notificationGetSettings(): Promise<NotificationSettings> {
  return invoke<NotificationSettings>("notification_get_settings");
}

export async function notificationSetSettings(
  settings: NotificationSettings,
): Promise<void> {
  await invoke("notification_set_settings", { settings });
}

/**
 * Subscribe to notification changes. The backend emits
 * `notifications://changed` after any mutation (insert, mark-read, delete).
 * The callback is invoked with no payload; callers should refetch.
 */
export function onNotificationsChanged(
  callback: () => void,
): Promise<UnlistenFn> {
  return listen("notifications://changed", () => callback());
}

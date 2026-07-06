import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import {
  notificationList,
  notificationMarkAllRead,
  notificationMarkRead,
  notificationUnreadCount,
  onNotificationsChanged,
  type Notification,
  type NotificationKind,
} from "../../lib/notifications";

const KIND_LABELS: Partial<Record<NotificationKind, string>> = {
  plan_created: "Plan created",
  plan_status_changed: "Plan status",
  idea_captured: "Idea captured",
  idea_status_changed: "Idea status",
  category_created: "Category",
  schematic_updated: "Schematic",
  stage_started: "Stage started",
  stage_succeeded: "Stage succeeded",
  stage_failed: "Stage failed",
  stage_cancelled: "Stage cancelled",
  run_started: "Run started",
  run_finished: "Run finished",
  run_failed: "Run failed",
  integration_action: "Integration",
  pending_question: "Question",
  schematic_drift_suspected: "Drift",
};

export type NotificationCenterProps = {
  onNavigate?: (notification: Notification) => void;
};

export function NotificationCenter({ onNavigate }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<NotificationKind | "all">("all");

  const refresh = useCallback(async () => {
    try {
      const [count, list] = await Promise.all([
        notificationUnreadCount(),
        notificationList(50, 0),
      ]);
      setUnread(count);
      setNotifications(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    onNotificationsChanged(() => void refresh()).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const handleMarkAllRead = useCallback(async () => {
    await notificationMarkAllRead();
    await refresh();
  }, [refresh]);

  const handleClick = useCallback(
    async (n: Notification) => {
      await notificationMarkRead(n.id);
      await refresh();
      onNavigate?.(n);
      setOpen(false);
    },
    [onNavigate, refresh],
  );

  const filtered =
    filter === "all"
      ? notifications
      : notifications.filter((n) => n.kind === filter);

  const kinds = [...new Set(notifications.map((n) => n.kind))];

  return (
    <>
      <button
        className="btn-icon notification-bell"
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
      >
        <Bell size={14} />
        {unread > 0 ? <span className="notification-badge">{unread}</span> : null}
      </button>
      {open ? (
        <>
          <div className="notification-center-overlay" onClick={() => setOpen(false)} />
          <div className="notification-center">
            <div className="notification-center-header">
              <span className="notification-center-title">Notifications</span>
              <div className="notification-center-actions">
                <button
                  className="btn-text"
                  title="Mark all as read"
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  disabled={unread === 0}
                >
                  Mark all read
                </button>
                <button
                  className="btn-icon"
                  title="Close"
                  type="button"
                  onClick={() => setOpen(false)}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div className="notification-filters">
              <button
                className={`chip ${filter === "all" ? "chip-active" : ""}`}
                title="All kinds"
                type="button"
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {kinds.map((k) => (
                <button
                  key={k}
                  className={`chip ${filter === k ? "chip-active" : ""}`}
                  title={KIND_LABELS[k] ?? k}
                  type="button"
                  onClick={() => setFilter(k)}
                >
                  {KIND_LABELS[k] ?? k}
                </button>
              ))}
            </div>
            <div className="notification-list">
              {filtered.length === 0 ? (
                <p className="text-muted text-sm notification-empty">No notifications</p>
              ) : (
                filtered.map((n) => (
                  <div
                    key={n.id}
                    className={`notification-item ${n.read ? "notification-read" : ""}`}
                    title="Click to open"
                    onClick={() => void handleClick(n)}
                  >
                    <div className="notification-item-kind">
                      {KIND_LABELS[n.kind] ?? n.kind}
                    </div>
                    <div className="notification-item-title">{n.title}</div>
                    {n.detail ? (
                      <div className="notification-item-detail">{n.detail}</div>
                    ) : null}
                    <div className="notification-item-time">
                      {new Date(n.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

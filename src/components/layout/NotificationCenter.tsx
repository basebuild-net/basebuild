import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import {
  notificationList,
  notificationMarkAllRead,
  notificationMarkRead,
  notificationUnreadCount,
  onNotificationsChanged,
  onNotificationAttention,
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
  const [attention, setAttention] = useState<Notification | null>(null);

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
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    void refresh();
    void onNotificationsChanged(() => void refresh()).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    let dismissTimer: number | null = null;
    void onNotificationAttention((notification) => {
      setAttention(notification);
      void refresh();
      if (!document.hasFocus()) {
        void getCurrentWindow().requestUserAttention(UserAttentionType.Critical).catch(() => undefined);
      }
      try {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.setValueAtTime(660, audio.currentTime);
        gain.gain.setValueAtTime(0.045, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.16);
        oscillator.addEventListener("ended", () => void audio.close(), { once: true });
      } catch {
        // Audio may be unavailable before the first user gesture; the toast
        // and platform attention request still surface the event.
      }
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => setAttention(null), 8_000);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
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
    <div className="notification-center-wrap">
      {attention ? (
        <div className="notification-attention" role="status" aria-live="assertive">
          <button
            className="notification-attention-body"
            type="button"
            title="Open this notification"
            onClick={() => {
              setAttention(null);
              void handleClick(attention);
            }}
          >
            <span className="notification-attention-kind">{KIND_LABELS[attention.kind] ?? "Attention"}</span>
            <strong>{attention.title}</strong>
            {attention.detail ? <span>{attention.detail}</span> : null}
          </button>
          <button
            className="btn-icon"
            type="button"
            title="Dismiss notification"
            onClick={() => setAttention(null)}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
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
    </div>
  );
}

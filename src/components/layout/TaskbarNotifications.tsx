import { useCallback, useEffect, useRef, useState } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { AlertTriangle, Bell, CheckCircle, Info, X, XCircle } from "lucide-react";
import {
  notificationList,
  notificationMarkRead,
  notificationMarkAllRead,
  notificationUnreadCount,
  onNotificationsChanged,
  onNotificationAttention,
  type Notification,
  type NotificationKind,
} from "../../lib/notifications";
import type { ToastKind } from "./AppShell";
import { SkeletonRows } from "./Loading";

const BAR_DISMISS_MS = 5000;
const BAR_MAX_VISIBLE = 3;

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

type IconEntry = { icon: typeof CheckCircle; className: string };
const APP_ICONS: Record<ToastKind, IconEntry> = {
  success: { icon: CheckCircle, className: "taskbar-notif-bar-icon-success" },
  warning: { icon: AlertTriangle, className: "taskbar-notif-bar-icon-warning" },
  error: { icon: XCircle, className: "taskbar-notif-bar-icon-error" },
  info: { icon: Info, className: "taskbar-notif-bar-icon-info" },
};

type AppToast = { id: string; title: string; detail?: string; kind: ToastKind };

type BarEntry =
  | { source: "notification"; id: string; notification: Notification }
  | { source: "attention"; id: string; notification: Notification }
  | { source: "app"; id: string; title: string; detail?: string; toastKind: ToastKind };

export type TaskbarNotificationsProps = {
  onNavigate?: (notification: Notification) => void;
  appToasts: AppToast[];
  onDismissAppToast: (id: string) => void;
};

export function TaskbarNotifications({ onNavigate, appToasts, onDismissAppToast }: TaskbarNotificationsProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // False only until the first list fetch settles — `refresh` also runs on
  // every notification event, and those must not flash a skeleton.
  const [listLoaded, setListLoaded] = useState(false);
  const [filter, setFilter] = useState<NotificationKind | "all">("all");
  const [notifToasts, setNotifToasts] = useState<{ id: string; notification: Notification }[]>([]);
  const [attentionToasts, setAttentionToasts] = useState<{ id: string; notification: Notification }[]>([]);

  const timers = useRef<Map<string, number>>(new Map());
  const seenIds = useRef<Set<string>>(new Set());

  // ── Timer helpers ──
  const clearTimer = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
  }, []);

  const scheduleDismiss = useCallback((key: string, onDismiss: () => void) => {
    clearTimer(key);
    const timer = window.setTimeout(onDismiss, BAR_DISMISS_MS);
    timers.current.set(key, timer);
  }, [clearTimer]);

  // ── Dismiss helpers ──
  const dismissNotif = useCallback((id: string) => {
    setNotifToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimer(`notif-${id}`);
  }, [clearTimer]);

  const dismissAttention = useCallback((id: string) => {
    setAttentionToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimer(`attn-${id}`);
  }, [clearTimer]);

  const dismissApp = useCallback((id: string) => {
    onDismissAppToast(id);
    clearTimer(`app-${id}`);
  }, [clearTimer, onDismissAppToast]);

  // ── Notification list refresh ──
  const refresh = useCallback(async () => {
    try {
      const [count, list] = await Promise.all([
        notificationUnreadCount(),
        notificationList(50, 0),
      ]);
      setUnread(count);
      setNotifications(list);
      const unreadNotifs = list.filter((n) => !n.read);
      setNotifToasts((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const newToasts = unreadNotifs
          .filter((n) => !existingIds.has(n.id) && !seenIds.current.has(n.id))
          .map((n) => ({ id: n.id, notification: n }));
        for (const n of unreadNotifs) seenIds.current.add(n.id);
        return [...prev, ...newToasts];
      });
    } catch {
      // non-critical
    } finally {
      setListLoaded(true);
    }
  }, []);

  // ── Subscribe to notification changes ──
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

  // ── Subscribe to high-signal attention notifications ──
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    void onNotificationAttention((notification) => {
      setAttentionToasts((prev) => {
        if (prev.some((t) => t.id === notification.id)) return prev;
        return [{ id: notification.id, notification }, ...prev];
      });
      seenIds.current.add(notification.id);
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
        // Audio may be unavailable before the first user gesture.
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refresh]);

  // ── Auto-dismiss timers for notification toasts ──
  useEffect(() => {
    for (const t of notifToasts) {
      const key = `notif-${t.id}`;
      if (!timers.current.has(key)) {
        scheduleDismiss(key, () => dismissNotif(t.id));
      }
    }
  }, [notifToasts, scheduleDismiss, dismissNotif]);

  // ── Auto-dismiss timers for attention toasts ──
  useEffect(() => {
    for (const t of attentionToasts) {
      const key = `attn-${t.id}`;
      if (!timers.current.has(key)) {
        scheduleDismiss(key, () => dismissAttention(t.id));
      }
    }
  }, [attentionToasts, scheduleDismiss, dismissAttention]);

  // ── Auto-dismiss timers for app toasts ──
  useEffect(() => {
    for (const t of appToasts) {
      const key = `app-${t.id}`;
      if (!timers.current.has(key)) {
        scheduleDismiss(key, () => dismissApp(t.id));
      }
    }
    const appKeys = new Set(appToasts.map((t) => `app-${t.id}`));
    for (const key of timers.current.keys()) {
      if (key.startsWith("app-") && !appKeys.has(key)) {
        clearTimer(key);
      }
    }
  }, [appToasts, scheduleDismiss, dismissApp, clearTimer]);

  // ── Cleanup all timers on unmount ──
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        window.clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, []);

  // ── Bar click handler ──
  const handleBarClick = useCallback(
    async (entry: BarEntry) => {
      if (entry.source === "app") {
        dismissApp(entry.id);
      } else {
        await notificationMarkRead(entry.notification.id);
        if (entry.source === "notification") dismissNotif(entry.id);
        else dismissAttention(entry.id);
        onNavigate?.(entry.notification);
      }
    },
    [dismissApp, dismissNotif, dismissAttention, onNavigate],
  );

  const handlePause = useCallback((key: string) => {
    clearTimer(key);
  }, [clearTimer]);

  const handleResume = useCallback((key: string, onDismiss: () => void) => {
    scheduleDismiss(key, onDismiss);
  }, [scheduleDismiss]);

  const handleMarkAllRead = useCallback(async () => {
    await notificationMarkAllRead();
    await refresh();
  }, [refresh]);

  const handleDropdownClick = useCallback(
    async (n: Notification) => {
      await notificationMarkRead(n.id);
      await refresh();
      onNavigate?.(n);
      setOpen(false);
    },
    [onNavigate, refresh],
  );

  const handleDismissAll = useCallback(() => {
    for (const t of notifToasts) dismissNotif(t.id);
    for (const t of attentionToasts) dismissAttention(t.id);
    for (const t of appToasts) dismissApp(t.id);
  }, [notifToasts, attentionToasts, appToasts, dismissNotif, dismissAttention, dismissApp]);

  // ── Build unified bar list (attention → notification → app) ──
  const bars: BarEntry[] = [
    ...attentionToasts.map((t) => ({ source: "attention" as const, id: t.id, notification: t.notification })),
    ...notifToasts.map((t) => ({ source: "notification" as const, id: t.id, notification: t.notification })),
    ...appToasts.slice().reverse().map((t) => ({
      source: "app" as const,
      id: t.id,
      title: t.title,
      detail: t.detail,
      toastKind: t.kind,
    })),
  ];

  const visibleBars = bars.slice(0, BAR_MAX_VISIBLE);
  const overflow = bars.length - visibleBars.length;

  // ── Dropdown filter ──
  const filtered = filter === "all" ? notifications : notifications.filter((n) => n.kind === filter);
  const kinds = [...new Set(notifications.map((n) => n.kind))];

  // ── Helpers for bar timer keys and dismiss fns ──
  const barTimerKey = (entry: BarEntry): string =>
    entry.source === "app" ? `app-${entry.id}`
    : entry.source === "notification" ? `notif-${entry.id}`
    : `attn-${entry.id}`;

  const barDismissFn = (entry: BarEntry): (() => void) =>
    entry.source === "app" ? () => dismissApp(entry.id)
    : entry.source === "notification" ? () => dismissNotif(entry.id)
    : () => dismissAttention(entry.id);

  return (
    <div className="taskbar-notif-wrap">
      {bars.length > 0 ? (
        <div className="taskbar-notif-feed">
          {visibleBars.map((entry) => {
            const key = barTimerKey(entry);
            const onDismiss = barDismissFn(entry);

            if (entry.source === "app") {
              const { icon: Icon, className: iconClassName } = APP_ICONS[entry.toastKind];
              return (
                <div
                  key={key}
                  className={`taskbar-notif-bar taskbar-notif-bar-${entry.toastKind}`}
                  role="status"
                  aria-live="polite"
                  title={entry.title}
                  onMouseEnter={() => handlePause(key)}
                  onMouseLeave={() => handleResume(key, onDismiss)}
                >
                  <Icon size={13} className={`taskbar-notif-bar-icon ${iconClassName}`} />
                  <span
                    className="taskbar-notif-bar-title"
                    title="Click to dismiss"
                    onClick={() => void handleBarClick(entry)}
                  >
                    {entry.title}
                  </span>
                  {entry.detail ? <span className="taskbar-notif-bar-detail">{entry.detail}</span> : null}
                  <button
                    className="taskbar-notif-bar-x btn-icon"
                    title="Dismiss"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss();
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            }

            // notification or attention bar
            const n = entry.notification;
            return (
              <div
                key={key}
                className="taskbar-notif-bar taskbar-notif-bar-notification"
                title={n.title}
                onMouseEnter={() => handlePause(key)}
                onMouseLeave={() => handleResume(key, onDismiss)}
              >
                <span
                  className="taskbar-notif-bar-title"
                  title="Click to open"
                  onClick={() => void handleBarClick(entry)}
                >
                  {n.title}
                </span>
                {n.detail ? <span className="taskbar-notif-bar-detail">{n.detail}</span> : null}
                <button
                  className="taskbar-notif-bar-x btn-icon"
                  title="Dismiss"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
          {overflow > 0 ? (
            <span className="taskbar-notif-count" title={`${overflow} more notification${overflow === 1 ? "" : "s"}`}>
              +{overflow} more
            </span>
          ) : null}
          {bars.length >= 2 ? (
            <button
              className="taskbar-notif-close-all btn-icon"
              title="Dismiss all"
              type="button"
              onClick={handleDismissAll}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        className="taskbar-notif-bell btn-icon"
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
      >
        <Bell size={14} />
        {unread > 0 ? <span className="taskbar-notif-badge">{unread}</span> : null}
      </button>

      {open ? (
        <>
          <div className="taskbar-notif-dropdown-overlay" onClick={() => setOpen(false)} />
          <section className="taskbar-notif-dropdown" aria-label="Notification center">
            <div className="taskbar-notif-dropdown-header">
              <div className="taskbar-notif-dropdown-heading">
                <Bell className="taskbar-notif-dropdown-icon" size={13} />
                <div>
                  <span className="taskbar-notif-dropdown-title">Notifications</span>
                  <span className="taskbar-notif-dropdown-summary">
                    {unread > 0 ? `${unread} unread` : "You're all caught up"}
                  </span>
                </div>
              </div>
              <div className="taskbar-notif-dropdown-actions">
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
            <div className="taskbar-notif-filters" aria-label="Filter notifications">
              <button
                className={`chip ${filter === "all" ? "chip-active" : ""}`}
                title="Show all notifications"
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {kinds.map((kind) => (
                <button
                  key={kind}
                  className={`chip ${filter === kind ? "chip-active" : ""}`}
                  title={`Show ${KIND_LABELS[kind] ?? kind} notifications`}
                  type="button"
                  aria-pressed={filter === kind}
                  onClick={() => setFilter(kind)}
                >
                  {KIND_LABELS[kind] ?? kind}
                </button>
              ))}
            </div>
            <div className="taskbar-notif-dropdown-list">
              {!listLoaded ? (
                <SkeletonRows rows={4} label="Loading notifications…" />
              ) : filtered.length === 0 ? (
                <div className="taskbar-notif-dropdown-empty">
                  <Bell size={18} />
                  <span>No notifications here</span>
                </div>
              ) : (
                filtered.map((notification) => (
                  <button
                    key={notification.id}
                    className={`taskbar-notif-dropdown-item ${notification.read ? "taskbar-notif-read" : ""}`}
                    title={`Open notification: ${notification.title}`}
                    type="button"
                    onClick={() => void handleDropdownClick(notification)}
                  >
                    <span className="taskbar-notif-dropdown-item-heading">
                      <span
                        className={`taskbar-notif-dropdown-item-dot ${notification.read ? "" : "taskbar-notif-dropdown-item-dot-unread"}`}
                        aria-hidden="true"
                      />
                      <span className="taskbar-notif-dropdown-item-kind">
                        {KIND_LABELS[notification.kind] ?? notification.kind}
                      </span>
                      <time className="taskbar-notif-dropdown-item-time" dateTime={new Date(notification.createdAt).toISOString()}>
                        {new Date(notification.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </span>
                    <span className="taskbar-notif-dropdown-item-title">{notification.title}</span>
                    {notification.detail ? (
                      <span className="taskbar-notif-dropdown-item-detail">{notification.detail}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

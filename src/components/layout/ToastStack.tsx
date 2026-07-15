import { useCallback, useEffect, useRef, useState } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import {
  notificationList,
  notificationMarkRead,
  onNotificationsChanged,
  type Notification,
} from "../../lib/notifications";
import type { ToastKind } from "./AppShell";

const TOAST_DISMISS_MS = 5000;
const TOAST_MAX_VISIBLE = 6;

type ToastEntry =
  | { kind: "notification"; id: string; notification: Notification; dismissed: boolean }
  | { kind: "app"; id: string; title: string; detail?: string; toastKind: ToastKind; dismissed: boolean };

export type ToastStackProps = {
  onNavigate?: (notification: Notification) => void;
  /** App-level toasts pushed from AppShell via handleShowToast. */
  appToasts: { id: string; title: string; detail?: string; kind: ToastKind }[];
  /** Called when an app toast is dismissed (by timeout or click). */
  onDismissAppToast: (id: string) => void;
};

export function ToastStack({ onNavigate, appToasts, onDismissAppToast }: ToastStackProps) {
  const [notifToasts, setNotifToasts] = useState<{ id: string; notification: Notification; dismissed: boolean }[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seenIds = useRef<Set<string>>(new Set());

  const dismissNotif = useCallback((id: string) => {
    setNotifToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const refreshToasts = useCallback(async () => {
    try {
      const all = await notificationList(TOAST_MAX_VISIBLE, 0);
      const unread = all.filter((n) => !n.read);
      setNotifToasts((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const newToasts = unread
          .filter((n) => !existingIds.has(n.id) && !seenIds.current.has(n.id))
          .map((n) => ({ id: n.id, notification: n, dismissed: false }));
        for (const n of unread) seenIds.current.add(n.id);
        return [...prev, ...newToasts].slice(0, TOAST_MAX_VISIBLE);
      });
    } catch {
      // ignore — toasts are non-critical
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    onNotificationsChanged(() => void refreshToasts()).then((fn) => {
      unlisten = fn;
    });
    void refreshToasts();
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshToasts]);

  const scheduleDismiss = useCallback((id: string) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => dismissNotif(id), TOAST_DISMISS_MS);
    timers.current.set(id, timer);
  }, [dismissNotif]);

  const handleClick = useCallback(
    async (notification: Notification) => {
      await notificationMarkRead(notification.id);
      dismissNotif(notification.id);
      onNavigate?.(notification);
    },
    [dismissNotif, onNavigate],
  );

  const handlePause = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const handleResume = useCallback((id: string) => {
    scheduleDismiss(id);
  }, [scheduleDismiss]);

  // Auto-dismiss app toasts after TOAST_DISMISS_MS.
  useEffect(() => {
    for (const t of appToasts) {
      if (!timers.current.has(`app-${t.id}`)) {
        const timer = setTimeout(() => onDismissAppToast(t.id), TOAST_DISMISS_MS);
        timers.current.set(`app-${t.id}`, timer);
      }
    }
    // Clean up timers for removed app toasts.
    const appIds = new Set(appToasts.map((t) => `app-${t.id}`));
    for (const key of timers.current.keys()) {
      if (key.startsWith("app-") && !appIds.has(key)) {
        const timer = timers.current.get(key);
        if (timer) clearTimeout(timer);
        timers.current.delete(key);
      }
    }
  }, [appToasts, onDismissAppToast]);

  const allToasts: ToastEntry[] = [
    ...notifToasts.map((t) => ({ kind: "notification" as const, ...t })),
    ...appToasts.map((t) => ({ kind: "app" as const, id: t.id, title: t.title, detail: t.detail, toastKind: t.kind, dismissed: false })),
  ];

  if (allToasts.length === 0) return null;

  const APP_ICONS: Record<ToastKind, { icon: typeof CheckCircle; className: string }> = {
    success: { icon: CheckCircle, className: "toast-icon-success" },
    warning: { icon: AlertTriangle, className: "toast-icon-warning" },
    error: { icon: XCircle, className: "toast-icon-error" },
    info: { icon: Info, className: "toast-icon-info" },
  };

  return (
    <div className="toast-stack">
      {allToasts.map((toast) => {
        if (toast.kind === "notification") {
          const { id, notification, dismissed } = toast;
          if (!seenIds.current.has(id)) {
            seenIds.current.add(id);
            scheduleDismiss(id);
          }
          return (
            <div
              key={id}
              className={`toast ${dismissed ? "toast-dismissed" : ""}`}
              title={notification.title}
              onMouseEnter={() => handlePause(id)}
              onMouseLeave={() => handleResume(id)}
            >
              <div
                className="toast-content"
                onClick={() => void handleClick(notification)}
                title="Click to open"
              >
                <span className="toast-title">{notification.title}</span>
                {notification.detail ? (
                  <span className="toast-detail">{notification.detail}</span>
                ) : null}
              </div>
              <button
                className="toast-dismiss btn-icon"
                title="Dismiss"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissNotif(id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        // App toast
        const { icon: ToastIcon, className: iconClassName } = APP_ICONS[toast.toastKind];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.toastKind}`}
            role="status"
            aria-live="polite"
            onMouseEnter={() => handlePause(`app-${toast.id}`)}
            onMouseLeave={() => handleResume(`app-${toast.id}`)}
          >
            <ToastIcon size={13} className={`toast-icon ${iconClassName}`} />
            <div className="toast-content">
              <span className="toast-title">{toast.title}</span>
              {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
            </div>
            <button
              className="toast-dismiss btn-icon"
              title="Dismiss"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismissAppToast(toast.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {allToasts.length > 1 ? (
        <button
          className="toast-dismiss-all"
          title="Dismiss all"
          type="button"
          onClick={() => {
            for (const t of allToasts) {
              if (t.kind === "notification") dismissNotif(t.id);
              else onDismissAppToast(t.id);
            }
          }}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

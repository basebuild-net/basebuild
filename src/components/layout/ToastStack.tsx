import { useCallback, useEffect, useRef, useState } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import {
  notificationList,
  notificationMarkRead,
  onNotificationsChanged,
  type Notification,
} from "../../lib/notifications";

const TOAST_DISMISS_MS = 6000;
const TOAST_MAX_VISIBLE = 4;

type Toast = {
  notification: Notification;
  dismissed: boolean;
};

export type ToastStackProps = {
  onNavigate?: (notification: Notification) => void;
};

export function ToastStack({ onNavigate }: ToastStackProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seenIds = useRef<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.notification.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const refreshToasts = useCallback(async () => {
    try {
      // Fetch the latest unread notifications and show the newest as toasts.
      const all = await notificationList(TOAST_MAX_VISIBLE, 0);
      const unread = all.filter((n) => !n.read);
      setToasts((prev) => {
        const existingIds = new Set(prev.map((t) => t.notification.id));
        const newToasts = unread
          .filter((n) => !existingIds.has(n.id) && !seenIds.current.has(n.id))
          .map((n) => ({ notification: n, dismissed: false }));
        // Mark seen so we don't re-toast the same notification.
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
    return () => {
      if (unlisten) unlisten();
      // Clear all timers on unmount.
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, [refreshToasts]);

  const scheduleDismiss = useCallback(
    (id: string) => {
      // Don't double-schedule.
      if (timers.current.has(id)) return;
      const timer = setTimeout(() => dismiss(id), TOAST_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const handleClick = useCallback(
    async (notification: Notification) => {
      await notificationMarkRead(notification.id);
      dismiss(notification.id);
      onNavigate?.(notification);
    },
    [dismiss, onNavigate],
  );

  const handlePause = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const handleResume = useCallback(
    (id: string) => {
      scheduleDismiss(id);
    },
    [scheduleDismiss],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map(({ notification, dismissed }) => {
        if (!seenIds.current.has(notification.id)) {
          seenIds.current.add(notification.id);
          scheduleDismiss(notification.id);
        }
        return (
          <div
            key={notification.id}
            className={`toast ${dismissed ? "toast-dismissed" : ""}`}
            title={notification.title}
            onMouseEnter={() => handlePause(notification.id)}
            onMouseLeave={() => handleResume(notification.id)}
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
                dismiss(notification.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

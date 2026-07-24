import { useCallback, useEffect, useState } from "react";
import {
  listenUsageSyncStatus,
  usageSyncRetry,
  usageSyncProjectedUsage,
  usageSyncSetEnabled,
  usageSyncSetMode,
  usageSyncStatus,
  usageSyncTrigger,
  type AutoSyncStatus,
  type ProjectedUsage,
  type SyncResult,
} from "../lib/usageSync";
import { useLogs } from "./log";
import { useAccount } from "./account";

export type UsageSyncState = {
  status: AutoSyncStatus | null;
  projected: ProjectedUsage | null;
  loading: boolean;
  error: string | null;
  lastSyncResult: SyncResult | null;
  refresh: () => Promise<void>;
  fetchProjected: () => Promise<void>;
  triggerSync: (reason?: string) => Promise<void>;
  retrySync: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setMode: (mode: "rows" | "summary") => Promise<void>;
};

export function useUsageSync(): UsageSyncState {
  const [status, setStatus] = useState<AutoSyncStatus | null>(null);
  const [projected, setProjected] = useState<ProjectedUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useAccount();
  const signedIn = !!profile;
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const { addLog } = useLogs();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await usageSyncStatus());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog("error", "Usage sync status failed", msg);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  const fetchProjected = useCallback(async () => {
    setError(null);
    try {
      setProjected(await usageSyncProjectedUsage());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog("error", "Usage sync projected fetch failed", msg);
    }
  }, [addLog]);

  const retrySync = useCallback(async () => {
    setError(null);
    addLog("debug", "Usage sync retry requested", "Retrying pending aggregate source windows");
    try {
      await usageSyncRetry();
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog("error", "Usage sync retry failed", msg);
    }
  }, [refresh, addLog]);

  const triggerSync = useCallback(async (reason?: string) => {
    setError(null);
    addLog("debug", "Usage sync requested", reason ?? "manual");
    try {
      await usageSyncTrigger(reason);
      // The backend trigger is fire-and-forget: it spawns a worker thread and
      // returns immediately. When the push actually runs it emits a
      // usage-sync://status event (handled by the listener below) which
      // refreshes the status. But when the trigger is coalesced (single-flight
      // already in progress) or debounced (last sync < MIN_INTER_SYNC_GAP_SECS,
      // which the 60s autosync loop makes very likely) the backend returns
      // early WITHOUT emitting any event, so the UI would stay stale. Refresh
      // here so "Sync now" always reflects the current backend status.
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog("error", "Usage sync trigger failed", msg);
    }
  }, [refresh, addLog]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setError(null);
      addLog("debug", "Usage auto-sync changed", enabled ? "enabled" : "disabled");
      try {
        await usageSyncSetEnabled(enabled);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        addLog("error", "Usage sync toggle failed", msg);
      }
    },
    [refresh, addLog],
  );

  const setMode = useCallback(
    async (mode: "rows" | "summary") => {
      setError(null);
      try {
        await usageSyncSetMode(mode);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        addLog("error", "Usage sync mode change failed", msg);
      }
    },
    [refresh, addLog],
  );

  useEffect(() => {
    void refresh();
    if (signedIn) void fetchProjected();
  }, [refresh, fetchProjected, signedIn]);

  // Listen for sync status events from the backend.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listenUsageSyncStatus((event) => {
      setLastSyncResult(event.payload);
      void refresh();
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  return {
    status,
    projected,
    loading,
    error,
    lastSyncResult,
    refresh,
    fetchProjected,
    triggerSync,
    retrySync,
    setEnabled,
    setMode,
  };
}

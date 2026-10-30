import { useCallback, useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  listenOpenSpecRuntimeProgress,
  openspecRuntimeInstall,
  openspecRuntimeStatus,
  openspecRuntimeUpdate,
  type OpenSpecRuntimeAction,
  type OpenSpecRuntimeStatus,
} from "../lib/openspecRuntime";

/** Caps the progress panel so long npm output cannot grow state without bound. */
const MAX_PROGRESS_LINES = 200;

export type OpenSpecRuntimeState = {
  status: OpenSpecRuntimeStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Action awaiting user confirmation; null when no confirmation is open. */
  pendingAction: OpenSpecRuntimeAction | null;
  /** Action currently running; null when idle. */
  activeAction: OpenSpecRuntimeAction | null;
  /** npm output from the current or most recent install/update run. */
  progressLines: string[];
  /** Error from the most recent install/update run. */
  actionError: string | null;
  requestAction: (action: OpenSpecRuntimeAction) => void;
  cancelPendingAction: () => void;
  confirmPendingAction: () => Promise<void>;
};

export function useOpenSpecRuntime(projectPath: string | null): OpenSpecRuntimeState {
  const [status, setStatus] = useState<OpenSpecRuntimeStatus | null>(null);
  // True until the mount fetch settles. `status ?? "missing"` rendered a
  // definitive "OpenSpec: missing" badge plus manual-install instructions
  // during every normal load.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<OpenSpecRuntimeAction | null>(null);
  const [activeAction, setActiveAction] = useState<OpenSpecRuntimeAction | null>(null);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await openspecRuntimeStatus(projectPath);
      setStatus(s);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestAction = useCallback((action: OpenSpecRuntimeAction) => {
    setActionError(null);
    setPendingAction(action);
  }, []);

  const cancelPendingAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  const confirmPendingAction = useCallback(async () => {
    if (pendingAction === null) return;
    const action = pendingAction;
    setPendingAction(null);
    setActiveAction(action);
    setProgressLines([]);
    setActionError(null);
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listenOpenSpecRuntimeProgress((progress) => {
        if (progress.action !== action) return;
        setProgressLines((lines) => [...lines, progress.message].slice(-MAX_PROGRESS_LINES));
      });
      const next =
        action === "install"
          ? await openspecRuntimeInstall(projectPath)
          : await openspecRuntimeUpdate(projectPath);
      setStatus(next);
    } catch (e) {
      setActionError(String(e));
    } finally {
      unlisten?.();
      setActiveAction(null);
    }
  }, [pendingAction, projectPath]);

  return {
    status,
    loading,
    error,
    refresh,
    pendingAction,
    activeAction,
    progressLines,
    actionError,
    requestAction,
    cancelPendingAction,
    confirmPendingAction,
  };
}

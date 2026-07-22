import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadWorkspaceState,
  saveWorkspaceState,
  type WorkspaceRestoreState,
} from "../lib/workspace";
import {
  closeSurface as closeSurfacePure,
  createSurface as createSurfacePure,
  deleteSurfaceFromHistory as deleteSurfaceFromHistoryPure,
  emptyWorkspaceState,
  focusSurface as focusSurfacePure,
  reopenSurface as reopenSurfacePure,
  removeSurfaceFromLayout as removeSurfaceFromLayoutPure,
  replaceFocusedSurface as replaceFocusedSurfacePure,
  splitFocusedSurface as splitFocusedSurfacePure,
  type CreateSurfaceInput,
  type SplitDirection,
  type WorkspaceDiagnostic,
  type WorkspaceState,
} from "../lib/workspaceState";

/** The live set of backing resource ids (chat session ids + stringified PTY
 *  ids) that currently exist. Passed in so load-time normalization can flag
 *  stale surfaces without deleting them. */
export type WorkspaceStateOptions = {
  /** When provided, surfaces whose `resourceId` is absent from this set are
   *  flagged with a `stale-resource` diagnostic on load but retained. */
  validResourceIds?: ReadonlySet<string>;
  /** Optional log sink for diagnostics and persistence errors. */
  log?: (level: "debug" | "warn", message: string, detail?: string) => void;
};

/** The workspace state hook: loads, mutates, and persists the versioned
 *  active-registry / single-surface-leaf model. Normal mutations write the
 *  new model directly — no legacy compatibility branches. The old
 *  `PanelGridState` renderer remains until the cutover phase; this hook
 *  coexists and is the read/write path for the new model. */
export function useWorkspaceState(
  projectPath: string | null,
  options: WorkspaceStateOptions = {},
): WorkspaceStateController {
  const { validResourceIds, log } = options;
  const [state, setState] = useState<WorkspaceState>(emptyWorkspaceState(projectPath ?? ""));
  const [diagnostics, setDiagnostics] = useState<WorkspaceDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const restoreRef = useRef<WorkspaceRestoreState | null>(null);
  const projectRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const validResourceIdsRef = useRef(validResourceIds);
  validResourceIdsRef.current = validResourceIds;

  // Load on project switch.
  useEffect(() => {
    if (!projectPath) {
      setState(emptyWorkspaceState(""));
      setDiagnostics([]);
      restoreRef.current = null;
      projectRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadWorkspaceState(projectPath, validResourceIdsRef.current).then(({ result, restore }) => {
      if (cancelled) return;
      setState(result.state);
      setDiagnostics(result.diagnostics);
      restoreRef.current = restore;
      projectRef.current = projectPath;
      setLoading(false);
      if (result.repaired) {
        for (const d of result.diagnostics) {
          log?.("debug", "Workspace state repaired", d.message);
        }
      }
    }).catch((caught) => {
      if (cancelled) return;
      setLoading(false);
      const message = caught instanceof Error ? caught.message : String(caught);
      log?.("warn", "Failed to load workspace state", message);
      setState(emptyWorkspaceState(projectPath));
    });
    return () => { cancelled = true; };
  }, [projectPath, log]);

  // Debounced persistence. Captures the project + state so a project switch
  // before the timer fires writes against the captured project. Nothing is
  // written on parse failure (the old blob is preserved by not saving).
  const persist = useCallback((next: WorkspaceState) => {
    const project = projectRef.current;
    const restore = restoreRef.current;
    if (!project || !restore) return;
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      const write = () => {
        void saveWorkspaceState(project, next, restore).catch((caught) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          log?.("warn", "Failed to persist workspace state", message);
        });
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(write, { timeout: 1000 });
      } else {
        write();
      }
    }, 250);
  }, [log]);

  const mutate = useCallback((fn: (prev: WorkspaceState) => WorkspaceState) => {
    setState((prev) => {
      const next = fn(prev);
      if (next !== prev) persist(next);
      return next;
    });
  }, [persist]);

  const createSurface = useCallback((input: CreateSurfaceInput) => {
    let surfaceId = "";
    setState((prev) => {
      const { state: next, surfaceId: id } = createSurfacePure(prev, input);
      surfaceId = id;
      persist(next);
      return next;
    });
    return surfaceId;
  }, [persist]);

  const focusSurface = useCallback((surfaceId: string) => {
    mutate((prev) => focusSurfacePure(prev, surfaceId));
  }, [mutate]);

  const replaceFocusedSurface = useCallback((surfaceId: string) => {
    mutate((prev) => replaceFocusedSurfacePure(prev, surfaceId));
  }, [mutate]);

  const splitFocusedSurface = useCallback((surfaceId: string, direction: SplitDirection) => {
    mutate((prev) => splitFocusedSurfacePure(prev, surfaceId, direction));
  }, [mutate]);

  const removeSurfaceFromLayout = useCallback((surfaceId: string) => {
    mutate((prev) => removeSurfaceFromLayoutPure(prev, surfaceId));
  }, [mutate]);

  const closeSurface = useCallback((surfaceId: string) => {
    mutate((prev) => closeSurfacePure(prev, surfaceId));
  }, [mutate]);

  const reopenSurface = useCallback((surfaceId: string) => {
    mutate((prev) => reopenSurfacePure(prev, surfaceId));
  }, [mutate]);

  const deleteSurfaceFromHistory = useCallback((surfaceId: string) => {
    mutate((prev) => deleteSurfaceFromHistoryPure(prev, surfaceId));
  }, [mutate]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, []);

  return {
    state,
    diagnostics,
    loading,
    createSurface,
    focusSurface,
    replaceFocusedSurface,
    splitFocusedSurface,
    removeSurfaceFromLayout,
    closeSurface,
    reopenSurface,
    deleteSurfaceFromHistory,
  };
}

/** Controller surface returned by `useWorkspaceState`. */
export type WorkspaceStateController = {
  state: WorkspaceState;
  diagnostics: WorkspaceDiagnostic[];
  loading: boolean;
  createSurface: (input: CreateSurfaceInput) => string;
  focusSurface: (surfaceId: string) => void;
  replaceFocusedSurface: (surfaceId: string) => void;
  splitFocusedSurface: (surfaceId: string, direction: SplitDirection) => void;
  removeSurfaceFromLayout: (surfaceId: string) => void;
  closeSurface: (surfaceId: string) => void;
  reopenSurface: (surfaceId: string) => void;
  deleteSurfaceFromHistory: (surfaceId: string) => void;
};


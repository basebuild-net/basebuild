import { invoke } from "@tauri-apps/api/core";
import type { ChatGrid } from "./gridMath";
import {
  migrateFromLegacyBlob,
  serializeWorkspaceState,
  type NormalizeWorkspaceResult,
  type WorkspaceState,
} from "./workspaceState";

/** Per-tab chat grid layouts, keyed by tab id. On the wire this is a JSON
 *  string (the backend column is TEXT); parse it at the state boundary. */
export type TabGridStates = Record<string, ChatGrid>;

export type WorkspaceRestoreState = {
  projectPath: string;
  lastSessionId: string | null;
  lastTabId: string | null;
  sideSection: string | null;
  sidebarCollapsed: boolean;
  sideCollapsed: boolean;
  sideWidth: number;
  /** JSON string of `TabGridStates` (backend TEXT column). Null on legacy
   *  restore states. Parse with `parseTabGridStates`. */
  tabGridStates?: string | null;
  /** JSON string of `PanelGridState` (the unified panel grid split tree +
   *  closed panels + active panel id). Null on legacy restore states. Parse
   *  with `parsePanelGrid` from `panelGrid.ts`. */
  panelGrid?: string | null;
  updatedAt: number;
};

/** Parse the `tabGridStates` JSON string; returns `{}` on null/invalid. */
export function parseTabGridStates(raw: string | null | undefined): TabGridStates {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Serialize `TabGridStates` to the wire JSON string. */
export function serializeTabGridStates(states: TabGridStates): string {
  return JSON.stringify(states);
}

export async function getWorkspaceRestoreState(projectPath: string): Promise<WorkspaceRestoreState> {
  return invoke<WorkspaceRestoreState>("get_workspace_restore_state", { projectPath });
}

export async function saveWorkspaceRestoreState(state: WorkspaceRestoreState): Promise<WorkspaceRestoreState> {
  return invoke<WorkspaceRestoreState>("save_workspace_restore_state", { state });
}

/** The `panelGrid` TEXT column doubles as the versioned workspace blob: a
 *  v2 `WorkspaceState` JSON (when its `version` field is `2`) or a legacy
 *  `PanelGridState` JSON (no version field). `loadWorkspaceState` reads the
 *  blob and migrates legacy shapes in memory; it never writes, so a parse
 *  failure preserves the pre-migration persisted blob. */
export type LoadedWorkspaceState = {
  result: NormalizeWorkspaceResult;
  /** The raw restore state — pass to `saveWorkspaceState` to persist the new
   *  model while preserving the other restore fields. */
  restore: WorkspaceRestoreState;
};

/** Load and migrate the persisted workspace blob for a project. The blob is
 *  parsed and normalized (or migrated from legacy `PanelGridState`) in
 *  memory; nothing is written. On parse failure the returned state is empty
 *  with a `quarantined` diagnostic and the caller must NOT save — the old
 *  blob remains untouched. */
export async function loadWorkspaceState(
  projectPath: string,
  validResourceIds?: ReadonlySet<string>,
): Promise<LoadedWorkspaceState> {
  const restore = await getWorkspaceRestoreState(projectPath);
  const result = migrateFromLegacyBlob(restore.panelGrid ?? null, projectPath, validResourceIds);
  return { result, restore };
}

/** Persist a v2 `WorkspaceState` into the `panelGrid` field of the restore
 *  state, preserving every other restore field. The caller passes the
 *  `base` restore state returned by `loadWorkspaceState` (or the current
 *  restore snapshot) so non-workspace fields survive the save. */
export async function saveWorkspaceState(
  projectPath: string,
  state: WorkspaceState,
  base: WorkspaceRestoreState,
): Promise<WorkspaceRestoreState> {
  return saveWorkspaceRestoreState({
    ...base,
    projectPath,
    panelGrid: serializeWorkspaceState(state),
    updatedAt: Date.now(),
  });
}

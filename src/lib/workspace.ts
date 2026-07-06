import { invoke } from "@tauri-apps/api/core";
import type { ChatGrid } from "./gridMath";

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

import { invoke } from "@tauri-apps/api/core";

export type WorkspaceRestoreState = {
  projectPath: string;
  lastSessionId: string | null;
  lastTabId: string | null;
  sideSection: string | null;
  sidebarCollapsed: boolean;
  sideCollapsed?: boolean;
  sideWidth?: number;
  updatedAt: number;
};

export async function getWorkspaceRestoreState(projectPath: string): Promise<WorkspaceRestoreState> {
  return invoke<WorkspaceRestoreState>("get_workspace_restore_state", { projectPath });
}

export async function saveWorkspaceRestoreState(state: WorkspaceRestoreState): Promise<WorkspaceRestoreState> {
  return invoke<WorkspaceRestoreState>("save_workspace_restore_state", { state });
}

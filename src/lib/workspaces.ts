import { invoke } from "@tauri-apps/api/core";

export type Workspace = {
  id: string;
  projectPath: string;
  planId?: string;
  branch: string;
  path: string;
  createdAt: number;
  prunedAt?: number;
};

export async function createWorkspace(
  projectPath: string,
  planId: string | null,
  referenceId: string,
  slug: string,
): Promise<Workspace> {
  return invoke<Workspace>("workspace_create", {
    projectPath,
    planId,
    referenceId,
    slug,
  });
}

export async function listWorkspaces(projectPath: string): Promise<Workspace[]> {
  return invoke<Workspace[]>("workspace_list", { projectPath });
}

export async function removeWorkspace(id: string, force: boolean): Promise<void> {
  return invoke<void>("workspace_remove", { id, force });
}

export async function isWorkspaceSupported(projectPath: string): Promise<boolean> {
  return invoke<boolean>("workspace_is_supported", { projectPath });
}

import { invoke } from "@tauri-apps/api/core";

export type IntegrationEntry = {
  runId: string;
  planId: string;
  planTitle: string;
  sessionId: string;
  workspacePath?: string;
  branch?: string;
  status: string;
  aheadBehind?: string;
  merged: boolean;
  prState?: string;
  prUrl?: string;
  finishedAt?: number;
};

export async function integrationList(sessionId: string, projectPath: string): Promise<IntegrationEntry[]> {
  return invoke<IntegrationEntry[]>("integration_list", { sessionId, projectPath });
}

export async function integrationCleanup(runId: string, force: boolean, sessionId: string): Promise<void> {
  await invoke("integration_cleanup", { runId, force, sessionId });
}

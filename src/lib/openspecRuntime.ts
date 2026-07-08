import { invoke } from "@tauri-apps/api/core";

export type OpenSpecRuntimeStatus = {
  state: "missing" | "ready" | "installing" | "error";
  version: string | null;
  executablePath: string | null;
  schema: string | null;
  projectReady: boolean;
  message: string | null;
};

export async function openspecRuntimeStatus(
  projectPath: string | null,
): Promise<OpenSpecRuntimeStatus> {
  return invoke<OpenSpecRuntimeStatus>("openspec_runtime_status", {
    projectPath,
  });
}

export async function openspecRuntimeInstall(
  projectPath: string | null,
): Promise<OpenSpecRuntimeStatus> {
  return invoke<OpenSpecRuntimeStatus>("openspec_runtime_install", {
    projectPath,
  });
}

export async function openspecRuntimeUpdate(
  projectPath: string | null,
): Promise<OpenSpecRuntimeStatus> {
  return invoke<OpenSpecRuntimeStatus>("openspec_runtime_update", {
    projectPath,
  });
}

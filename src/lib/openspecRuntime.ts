import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type OpenSpecRuntimeStatus = {
  state: "missing" | "ready" | "installing" | "error";
  version: string | null;
  executablePath: string | null;
  schema: string | null;
  projectReady: boolean;
  message: string | null;
};

export type OpenSpecRuntimeAction = "install" | "update";

/** One progress step from the backend. `phase` is started, output, or finished. */
export type OpenSpecRuntimeProgress = {
  action: OpenSpecRuntimeAction;
  phase: "started" | "output" | "finished";
  message: string;
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

/** Subscribe to install/update progress events. Returns the unlisten function. */
export async function listenOpenSpecRuntimeProgress(
  handler: (progress: OpenSpecRuntimeProgress) => void,
): Promise<UnlistenFn> {
  return listen<OpenSpecRuntimeProgress>("openspec://runtime-progress", (event) => {
    handler(event.payload);
  });
}

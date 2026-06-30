import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type OmpStatus = {
  installed: boolean;
  version: string | null;
  configPath: string | null;
  message: string | null;
};

export type OmpCommandResult = {
  command: string[];
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  json: unknown | null;
};

export type OmpStreamEventLine = {
  id: number;
  kind: "line";
  line: string;
  json: unknown | null;
};

export type OmpStreamEventDone = {
  id: number;
  kind: "done";
  success: boolean;
  exitCode: number | null;
};

export type OmpStreamEventError = {
  id: number;
  kind: "error";
  error: string;
};

export type OmpStreamEvent = OmpStreamEventLine | OmpStreamEventDone | OmpStreamEventError;

export async function ompStatus(): Promise<OmpStatus> {
  return invoke<OmpStatus>("omp_status");
}

export async function ompConfigList(): Promise<OmpCommandResult> {
  return invoke<OmpCommandResult>("omp_config_list");
}

export async function startOmpStream(args: string[]): Promise<number> {
  return invoke<number>("omp_stream_command", { args });
}

export async function listenOmpEvents(handler: EventCallback<OmpStreamEvent>): Promise<UnlistenFn> {
  return listen<OmpStreamEvent>("omp://event", handler);
}

export async function ompStats(): Promise<unknown> {
  return invoke<unknown>("omp_stats");
}

export async function ompUsage(): Promise<unknown> {
  return invoke<unknown>("omp_usage");
}

export async function ompDebugContext(): Promise<{ stats: unknown; usage: unknown; config: unknown }> {
  return invoke<{ stats: unknown; usage: unknown; config: unknown }>("omp_debug_context");
}

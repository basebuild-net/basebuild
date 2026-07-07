import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type OmpRpcStatus = "starting" | "running" | "exited" | "none";

export type OmpRpcStatusEvent = {
  sessionId: string;
  status: "running" | "exited";
};

export type OmpRpcQuestionEvent = {
  sessionId: string;
  interactionId: string;
  prompt: string;
  options: string[];
  frameId: string;
};

export async function ompRpcProbe(): Promise<string> {
  return invoke<string>("omp_rpc_probe");
}

export async function ompRpcStart(sessionId: string, provider: string, model: string): Promise<void> {
  await invoke("omp_rpc_start", { sessionId, provider, model });
}

export async function ompRpcSend(sessionId: string, message: string): Promise<void> {
  await invoke("omp_rpc_send", { sessionId, message });
}

export async function ompRpcCancel(sessionId: string): Promise<void> {
  await invoke("omp_rpc_cancel", { sessionId });
}

export async function ompRpcShutdown(sessionId: string): Promise<void> {
  await invoke("omp_rpc_shutdown", { sessionId });
}

export async function ompRpcResolve(sessionId: string, frameId: string, answer: string): Promise<void> {
  await invoke("omp_rpc_resolve", { sessionId, frameId, answer });
}

export async function ompRpcStatus(sessionId: string): Promise<OmpRpcStatus> {
  return invoke<OmpRpcStatus>("omp_rpc_status", { sessionId });
}

export function onOmpRpcStatus(callback: (event: OmpRpcStatusEvent) => void): Promise<UnlistenFn> {
  return listen<OmpRpcStatusEvent>("omp-rpc://status", (e) => callback(e.payload));
}

export function onOmpRpcQuestion(callback: (event: OmpRpcQuestionEvent) => void): Promise<UnlistenFn> {
  return listen<OmpRpcQuestionEvent>("omp-rpc://question", (e) => callback(e.payload));
}

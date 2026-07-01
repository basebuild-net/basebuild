import { invoke } from "@tauri-apps/api/core";

export async function agentStart(cwd: string): Promise<number> {
  return invoke<number>("agent_start", { cwd });
}

export async function agentSend(id: number, message: string): Promise<void> {
  return invoke("agent_send", { id, message });
}

export async function agentStop(id: number): Promise<void> {
  return invoke("agent_stop", { id });
}

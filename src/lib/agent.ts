import { invoke } from "@tauri-apps/api/core";
import type { AgentCapability, RuntimeProfile } from "./settings";

export type AgentStartOptions = {
  cwd: string;
  profileId?: string | null;
  model?: string | null;
};

export async function agentStart(options: AgentStartOptions): Promise<number> {
  return invoke<number>("agent_start", {
    cwd: options.cwd,
    profileId: options.profileId ?? null,
    model: options.model ?? null,
  });
}

export async function agentSend(id: number, message: string): Promise<void> {
  return invoke("agent_send", { id, message });
}

export async function agentStop(id: number): Promise<void> {
  return invoke("agent_stop", { id });
}

export async function agentCapabilities(profileId: string): Promise<AgentCapability[]> {
  return invoke<AgentCapability[]>("agent_capabilities", { profileId });
}

export async function agentListProfiles(): Promise<RuntimeProfile[]> {
  return invoke<RuntimeProfile[]>("list_runtime_profiles");
}

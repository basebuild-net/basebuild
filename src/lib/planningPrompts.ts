import { invoke } from "@tauri-apps/api/core";

export type PlanningPromptEntry = {
  key: string;
  value: string;
  default: string;
  isModified: boolean;
};

export const PLANNING_PROMPT_KEYS = {
  chatSystem: "chat_system",
  ideaGeneration: "idea_generation",
  planGeneration: "plan_generation",
  categoryGeneration: "category_generation",
} as const;

export async function listPlanningPrompts(): Promise<PlanningPromptEntry[]> {
  return invoke<PlanningPromptEntry[]>("planning_prompt_list");
}

export async function setPlanningPrompt(key: string, value: string): Promise<void> {
  return invoke("planning_prompt_set", { key, value });
}

export async function resetPlanningPrompt(key: string): Promise<void> {
  return invoke("planning_prompt_reset", { key });
}

import { invoke } from "@tauri-apps/api/core";

export type FinalTouchStepKind = "shell" | "validate" | "commit" | "pull_request";

export type FinalTouchStep = {
  id: string;
  projectPath: string;
  kind: FinalTouchStepKind;
  label: string;
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type FinalTouchStepInput = {
  projectPath: string;
  kind: string;
  label: string;
  enabled?: boolean;
  sortOrder?: number;
  config?: Record<string, unknown>;
};

export async function listFinalTouchSteps(
  projectPath: string,
): Promise<FinalTouchStep[]> {
  return invoke<FinalTouchStep[]>("final_touch_list_steps", { projectPath });
}

export async function createFinalTouchStep(
  input: FinalTouchStepInput,
): Promise<FinalTouchStep> {
  return invoke<FinalTouchStep>("final_touch_create_step", { input });
}

export async function updateFinalTouchStep(
  id: string,
  input: FinalTouchStepInput,
): Promise<FinalTouchStep> {
  return invoke<FinalTouchStep>("final_touch_update_step", { id, input });
}

export async function setFinalTouchStepEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("final_touch_set_enabled", { id, enabled });
}

export async function reorderFinalTouchStep(
  id: string,
  newOrder: number,
): Promise<void> {
  return invoke<void>("final_touch_reorder_step", { id, newOrder });
}

export async function deleteFinalTouchStep(id: string): Promise<void> {
  return invoke<void>("final_touch_delete_step", { id });
}

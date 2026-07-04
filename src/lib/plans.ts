import { invoke } from "@tauri-apps/api/core";

export type PlanStatus = "draft" | "openspec" | "ready" | "running" | "finished" | "cancelled";

export type PlanFocusContext = {
  notes: string;
  files: string[];
  terminalOutputTail?: string;
};

export type Plan = {
  id: string;
  sessionId: string;
  referenceId: string;
  title: string;
  description: string;
  goal: string | null;
  status: PlanStatus;
  priority: number;
  tags: string[];
  aiEnhanced: boolean;
  context: PlanFocusContext | null;
  /** Linked idea id when promoted from an idea. Undefined for manual plans. */
  ideaId?: string;
  /** OpenSpec change name once artifacts have been generated. */
  changeName?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

export type NewPlan = {
  title: string;
  description: string;
  goal?: string | null;
  status?: PlanStatus;
  priority?: number;
  tags?: string[];
  /** Optional idea id when promoting an idea into a draft plan. */
  ideaId?: string;
};

export async function createPlan(sessionId: string, plan: NewPlan): Promise<Plan> {
  return invoke<Plan>("create_plan", {
    input: {
      sessionId,
      title: plan.title,
      description: plan.description,
      goal: plan.goal ?? null,
      status: plan.status ?? "draft",
      priority: plan.priority ?? 50,
      tags: plan.tags ?? [],
      ideaId: plan.ideaId ?? null,
    },
  });
}

export async function listPlans(sessionId: string): Promise<Plan[]> {
  return invoke<Plan[]>("list_plans", { sessionId });
}

export async function getPlan(id: string): Promise<Plan | null> {
  return invoke<Plan | null>("get_plan", { id });
}

export async function updatePlan(id: string, plan: NewPlan): Promise<Plan> {
  return invoke<Plan>("update_plan", {
    id,
    input: {
      title: plan.title,
      description: plan.description,
      goal: plan.goal ?? null,
      status: plan.status ?? "draft",
      priority: plan.priority ?? 50,
      tags: plan.tags ?? [],
    },
  });
}

export async function setPlanStatus(id: string, status: PlanStatus): Promise<Plan> {
  return invoke<Plan>("set_plan_status", { id, status });
}

export async function setPlanContext(id: string, context: PlanFocusContext): Promise<Plan> {
  return invoke<Plan>("set_plan_context", { id, context });
}

export async function deletePlan(id: string): Promise<void> {
  return invoke("delete_plan", { id });
}

export const PLAN_STATUSES: PlanStatus[] = ["draft", "openspec", "ready", "running", "finished", "cancelled"];

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  openspec: "OpenSpec",
  ready: "Ready",
  running: "Running",
  finished: "Finished",
  cancelled: "Cancelled",
};

export function isTerminalStatus(status: PlanStatus): boolean {
  return status === "finished" || status === "cancelled";
}

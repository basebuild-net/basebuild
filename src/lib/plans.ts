import { invoke } from "@tauri-apps/api/core";
import type { PlanAssessment } from "./planning-assessment";

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
  assessment?: PlanAssessment;
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

export async function listProjectPlans(projectPath: string): Promise<Plan[]> {
  return invoke<Plan[]>("list_project_plans", { projectPath });
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

export type BatchPromoteError = {
  ideaId: string;
  error: string;
};

export type BatchPromoteResult = {
  created: Plan[];
  errors: BatchPromoteError[];
};

/** Batch-promote multiple ideas to plans in one call. Per-idea errors are captured. */
export async function batchPromoteIdeas(
  sessionId: string,
  ideaIds: string[],
): Promise<BatchPromoteResult> {
  return invoke<BatchPromoteResult>("batch_promote_ideas", { sessionId, ideaIds });
}
export const PLAN_STATUSES: PlanStatus[] = ["draft", "openspec", "ready", "running", "finished", "cancelled"];

/** Display order for plan lanes/lists — active work first (running, ready,
 *  openspec), drafts next, terminal statuses last. */
export const PLAN_STATUS_DISPLAY_ORDER: PlanStatus[] = ["running", "ready", "openspec", "draft", "finished", "cancelled"];

/** Sort plans by display priority (running/ready/openspec first), stable within a status. */
export function sortPlansForDisplay(plans: Plan[]): Plan[] {
  return [...plans].sort(
    (a, b) => PLAN_STATUS_DISPLAY_ORDER.indexOf(a.status) - PLAN_STATUS_DISPLAY_ORDER.indexOf(b.status),
  );
}

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
export type PlanningIntegrityIssue = {
  kind: string;
  entityId: string;
  title: string;
  detail: string;
};

/** Load-time planning-data self check — desyncs (deleted source ideas,
 *  orphaned rows, dangling categories) surfaced as UI warnings instead of
 *  opaque action failures. */
export async function planningIntegrityCheck(projectPath: string): Promise<PlanningIntegrityIssue[]> {
  return invoke<PlanningIntegrityIssue[]>("planning_integrity_check", { projectPath });
}

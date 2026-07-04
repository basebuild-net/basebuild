import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type PlanRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused";

export type RunnerKind = "native" | "omp";

export type PlanQueueEntry = {
  id: string;
  sessionId: string;
  planId: string;
  sortOrder: number;
  createdAt: number;
};

export type ExecutionProfile = {
  concurrency: number;
  providerId: string;
  modelId: string;
  effortLevel?: string;
};

export type PlanOverride = {
  planId: string;
  providerId: string;
  modelId: string;
  effortLevel?: string;
};

export type PlanRun = {
  id: string;
  planId: string;
  sessionId: string;
  chatSessionId?: string;
  workspacePath?: string;
  status: PlanRunStatus;
  runnerKind: RunnerKind;
  error?: string;
  stepsOutput: PlanRunStepOutput[];
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
};

export type PlanRunStepOutput = {
  stepId: string;
  kind: string;
  status: string;
  output?: string;
  error?: string;
};

export type PlanRunEvent = {
  runId: string;
  sessionId: string;
  planId: string;
  status: PlanRunStatus;
  chatSessionId?: string;
  error?: string;
};

export type EnqueuePlanRequest = {
  sessionId: string;
  planId: string;
};

export type StartQueueRequest = {
  sessionId: string;
  profile: ExecutionProfile;
  planOverrides?: PlanOverride[];
};

export async function enqueuePlan(
  request: EnqueuePlanRequest,
): Promise<PlanQueueEntry> {
  return invoke<PlanQueueEntry>("plan_run_enqueue", { request });
}

export async function listPlanQueue(
  sessionId: string,
): Promise<PlanQueueEntry[]> {
  return invoke<PlanQueueEntry[]>("plan_run_list_queue", { sessionId });
}

export async function reorderPlanRun(
  sessionId: string,
  entryId: string,
  newOrder: number,
): Promise<void> {
  return invoke<void>("plan_run_reorder", { sessionId, entryId, newOrder });
}

export async function removePlanRun(entryId: string): Promise<void> {
  return invoke<void>("plan_run_remove", { entryId });
}

export async function startQueue(request: StartQueueRequest): Promise<void> {
  return invoke<void>("plan_run_start", { request });
}

export async function pauseQueue(sessionId: string): Promise<void> {
  return invoke<void>("plan_run_pause", { sessionId });
}

export async function startOmpPlanRun(
  sessionId: string,
  planId: string,
): Promise<PlanRun> {
  return invoke<PlanRun>("plan_run_start_omp", { sessionId, planId });
}

export async function cancelPlanRun(
  runId: string,
  cancelPlan: boolean,
): Promise<void> {
  return invoke<void>("plan_run_cancel", { runId, cancelPlan });
}

export async function completePlanRun(
  runId: string,
  succeeded: boolean,
): Promise<void> {
  return invoke<void>("plan_run_complete", { runId, succeeded });
}

export async function checkPlanRunCompletion(
  runId: string,
): Promise<[number, number]> {
  return invoke<[number, number]>("plan_run_check_completion", { runId });
}


export async function listPlanRuns(sessionId: string): Promise<PlanRun[]> {
  return invoke<PlanRun[]>("plan_run_list", { sessionId });
}

export async function getPlanRun(runId: string): Promise<PlanRun | null> {
  return invoke<PlanRun | null>("plan_run_get", { runId });
}

/// Listen for plan_run:// events. Returns an unlisten function.
export function onPlanRunEvent(
  cb: (event: PlanRunEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlanRunEvent>("plan_run://event", (e) => cb(e.payload));
}

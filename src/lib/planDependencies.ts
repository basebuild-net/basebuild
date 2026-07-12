import { invoke } from "@tauri-apps/api/core";
import type { Plan } from "./plans";
import type { PlanRun } from "./planRuns";

export type SchedulingMode = "safe" | "yolo";
export type WorkspacePolicy = "isolated_worktrees" | "sequential_primary";
export type EngineKind = "openspec" | "native";
export type FinishPolicy = "hold" | "auto_commit" | "auto_commit_pr" | "queue_merge_review";

export type PlanDependencies = {
  planId: string;
  prerequisites: string[];
  affectedPaths: string[];
  priority: number;
  schedulingMode: string;
  workspacePolicy: string;
};

export type DependencyNode = {
  planId: string;
  referenceId: string;
  title: string;
  status: string;
  priority: number;
  prerequisites: string[];
  affectedPaths: string[];
  readiness: string;
  blockReason?: string;
  collisions: string[];
  dispatchable: boolean;
  yoloConfirmed: boolean;
};

export type DependencyGraph = {
  sessionId: string;
  nodes: DependencyNode[];
  cycles: string[][];
};

export type ValidationResult = {
  planId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type FileClaim = {
  id: string;
  runId: string;
  planId: string;
  sessionId: string;
  path: string;
  action: string;
  createdAt: number;
  releasedAt?: number;
};

export type CoordinationEvent = {
  id: string;
  sessionId: string;
  runId: string;
  planId: string;
  kind: string;
  payload: string;
  createdAt: number;
};

export type LaunchProfile = {
  projectPath: string;
  engine: string;
  providerId: string;
  modelId: string;
  effortLevel?: string;
  skillId?: string;
  workerCount: number;
  workspacePolicy: string;
  schedulingMode: string;
  finishPolicy: string;
  updatedAt: number;
};

export type MergeReviewEntry = {
  id: string;
  runId: string;
  planId: string;
  sessionId: string;
  status: string;
  collisionReviewRequired: boolean;
  overlappingPlans: string[];
  reviewedAt?: number;
  createdAt: number;
};

export type SetDependenciesRequest = {
  planId: string;
  prerequisites: string[];
  affectedPaths: string[];
  priority?: number;
  schedulingMode?: string;
  workspacePolicy?: string;
};

export type PublishEventRequest = {
  sessionId: string;
  runId: string;
  planId: string;
  kind: string;
  payload?: string;
};

export type SetFileClaimRequest = {
  runId: string;
  planId: string;
  sessionId: string;
  paths: string[];
  action: "claim" | "release";
};

export type AssignWithProfileRequest = {
  planId: string;
  chatSessionId: string;
  profile: LaunchProfile;
};

export async function setDependencies(
  request: SetDependenciesRequest,
): Promise<Plan> {
  return invoke<Plan>("plan_set_dependencies", { request });
}

export async function getDependencies(planId: string): Promise<PlanDependencies> {
  return invoke<PlanDependencies>("plan_get_dependencies", { planId });
}

export async function getDependencyGraph(sessionId: string): Promise<DependencyGraph> {
  return invoke<DependencyGraph>("plan_dependency_graph", { sessionId });
}

export async function validateReadiness(planId: string): Promise<ValidationResult> {
  return invoke<ValidationResult>("plan_validate_readiness", { planId });
}

export async function setFileClaims(request: SetFileClaimRequest): Promise<void> {
  return invoke<void>("plan_file_claims_set", { request });
}

export async function listFileClaims(sessionId: string): Promise<FileClaim[]> {
  return invoke<FileClaim[]>("plan_file_claims_list", { sessionId });
}

export async function publishCoordinationEvent(
  request: PublishEventRequest,
): Promise<CoordinationEvent> {
  return invoke<CoordinationEvent>("plan_coordination_event_publish", { request });
}

export async function listCoordinationEvents(
  sessionId: string,
  since?: number,
): Promise<CoordinationEvent[]> {
  return invoke<CoordinationEvent[]>("plan_coordination_events", { sessionId, since });
}

export async function setLaunchProfile(profile: LaunchProfile): Promise<void> {
  return invoke<void>("plan_set_launch_profile", { profile });
}

export async function getLaunchProfile(projectPath: string): Promise<LaunchProfile | null> {
  return invoke<LaunchProfile | null>("plan_get_launch_profile", { projectPath });
}

export async function listMergeQueue(sessionId: string): Promise<MergeReviewEntry[]> {
  return invoke<MergeReviewEntry[]>("plan_merge_queue_list", { sessionId });
}

export async function reviewMergeEntry(
  entryId: string,
  decision: "approved" | "rejected" | "merged",
): Promise<MergeReviewEntry> {
  return invoke<MergeReviewEntry>("plan_merge_queue_review", { entryId, decision });
}

export async function assignPlanWithProfile(
  request: AssignWithProfileRequest,
): Promise<PlanRun> {
  return invoke<PlanRun>("plan_assign_with_profile", { request });
}

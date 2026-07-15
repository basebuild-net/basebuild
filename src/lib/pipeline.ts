import { invoke } from "@tauri-apps/api/core";

export type PipelineStageKind =
  | "generate_categories"
  | "generate_ideas"
  | "enhance_idea"
  | "generate_openspec";

export type PipelineRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PipelineRun = {
  id: string;
  sessionId: string;
  projectPath: string;
  kind: string;
  ideaId: string | null;
  planId: string | null;
  inputSummary: string;
  sessionChatId: string | null;
  status: string;
  error: string | null;
  outputRefs: string[];
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  /** Provider the stage runs with; null for legacy rows. */
  providerId: string | null;
  /** Model the stage runs with; null for legacy rows. */
  modelId: string | null;
};

export type PipelineStartRequest = {
  sessionId: string;
  projectPath: string;
  kind: PipelineStageKind;
  ideaId?: string | null;
  planId?: string | null;
  input?: string | null;
  chatSessionId?: string | null;
};

export function isTerminalRunStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export async function pipelineStart(request: PipelineStartRequest): Promise<PipelineRun> {
  return invoke<PipelineRun>("pipeline_start", { request });
}

export async function pipelineCancel(runId: string): Promise<void> {
  return invoke("pipeline_cancel", { runId });
}

export async function pipelineListRuns(sessionId: string): Promise<PipelineRun[]> {
  return invoke<PipelineRun[]>("pipeline_list_runs", { sessionId });
}

export async function pipelineListRunsByProject(projectPath: string): Promise<PipelineRun[]> {
  return invoke<PipelineRun[]>("pipeline_list_runs_by_project", { projectPath });
}

export async function pipelineGetRun(runId: string): Promise<PipelineRun | null> {
  return invoke<PipelineRun | null>("pipeline_get_run", { runId });
}

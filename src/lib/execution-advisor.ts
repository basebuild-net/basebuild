import { invoke } from "@tauri-apps/api/core";

export type ExecutionRole = "planner" | "coder";
export type EvidenceConfidence = "low" | "medium" | "high";

export type AdviceFactor = {
  name: string;
  score: number;
  maxScore: number;
  explanation: string;
};

export type RouteRecommendation = {
  providerId: string;
  modelId: string;
  label: string;
  score: number;
  confidence: EvidenceConfidence;
  factors: AdviceFactor[];
  reasons: string[];
  sourceFreshness: string[];
  userOverride: boolean;
};

export type ExcludedRoute = {
  providerId: string;
  modelId: string;
  reasons: string[];
};

export type RoleExecutionAdvice = {
  role: ExecutionRole;
  recommendation: RouteRecommendation | null;
  alternatives: RouteRecommendation[];
  excluded: ExcludedRoute[];
  confidence: EvidenceConfidence;
  generatedAt: number;
};

export type ExecutionAdviceBundle = {
  schemaVersion: number;
  assessmentSource: string;
  assessmentStale: boolean;
  planner: RoleExecutionAdvice;
  coder: RoleExecutionAdvice;
};

export async function getExecutionAdvice(input: {
  projectPath: string;
  planId?: string;
  ideaId?: string;
}): Promise<ExecutionAdviceBundle> {
  return invoke<ExecutionAdviceBundle>("execution_advice_get", { input });
}

export async function setExecutionAdviceOverride(input: {
  projectPath: string;
  role: ExecutionRole;
  providerId: string;
  modelId: string;
}): Promise<void> {
  await invoke("execution_advice_set_override", { input });
}

export async function clearExecutionAdviceOverride(input: {
  projectPath: string;
  role: ExecutionRole;
}): Promise<void> {
  await invoke("execution_advice_clear_override", { input });
}

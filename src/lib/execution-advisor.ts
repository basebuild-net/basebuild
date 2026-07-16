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
  difficultyBucket: number;
  effortBucket: AdvisorFeedbackEvent["effortBucket"];
  planner: RoleExecutionAdvice;
  coder: RoleExecutionAdvice;
};

export type AdvisorFeedbackConsent = {
  enabled: boolean;
  updatedAt: number | null;
};

export type AdvisorFeedbackEvent = {
  id: string;
  schemaVersion: number;
  role: ExecutionRole;
  recommendedProviderId: string;
  recommendedModelId: string;
  selectedProviderId: string;
  selectedModelId: string;
  outcome: "accepted" | "overridden";
  confidence: EvidenceConfidence;
  difficultyBucket: number;
  effortBucket: "under_4h" | "same_day" | "multi_day" | "multi_week";
  createdAt: number;
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

export async function getExecutionAdviceFeedbackConsent(): Promise<AdvisorFeedbackConsent> {
  return invoke<AdvisorFeedbackConsent>("execution_advice_feedback_consent");
}

export async function setExecutionAdviceFeedbackConsent(enabled: boolean): Promise<AdvisorFeedbackConsent> {
  return invoke<AdvisorFeedbackConsent>("execution_advice_set_feedback_consent", {
    input: { enabled },
  });
}

export async function recordExecutionAdviceFeedback(
  input: Omit<AdvisorFeedbackEvent, "id" | "schemaVersion" | "createdAt">,
): Promise<AdvisorFeedbackEvent> {
  return invoke<AdvisorFeedbackEvent>("execution_advice_record_feedback", { input });
}

export async function listExecutionAdviceFeedback(): Promise<AdvisorFeedbackEvent[]> {
  return invoke<AdvisorFeedbackEvent[]>("execution_advice_list_feedback");
}

export async function exportExecutionAdviceFeedback(): Promise<string> {
  return invoke<string>("execution_advice_export_feedback");
}

export async function deleteExecutionAdviceFeedback(): Promise<number> {
  return invoke<number>("execution_advice_delete_feedback");
}

import { invoke } from "@tauri-apps/api/core";

export type QuestionKind = "options" | "multi" | "confirm" | "text";

export type QuestionOption = {
  label: string;
  description?: string;
};

export type Question = {
  id: string;
  prompt: string;
  kind: QuestionKind;
  options?: QuestionOption[];
  recommended?: number;
  allowFreeText?: boolean;
  /** Optional read-only preview/context (e.g. prefilled field content the
   *  user is being asked to confirm). Rendered as a block in the card. */
  detail?: string;
};

export type InteractionStatus = "pending" | "answered" | "cancelled";

export type PendingInteraction = {
  id: string;
  sessionId: string;
  runId?: string;
  questions: Question[];
  status: InteractionStatus;
  answers?: unknown;
  createdAt: number;
  resolvedAt?: number;
};

export type QuestionAnswer = {
  questionId: string;
  selected?: string[];
  text?: string;
};

export type ResolveInteractionRequest = {
  answers: QuestionAnswer[];
};

export async function nativeInteractionListPending(
  sessionId: string,
): Promise<PendingInteraction[]> {
  return invoke<PendingInteraction[]>("native_interaction_list_pending", {
    sessionId,
  });
}

export async function nativeInteractionListAll(
  sessionId: string,
): Promise<PendingInteraction[]> {
  return invoke<PendingInteraction[]>("native_interaction_list_all", {
    sessionId,
  });
}

export async function nativeInteractionResolve(
  id: string,
  answers: QuestionAnswer[],
): Promise<PendingInteraction> {
  return invoke<PendingInteraction>("native_interaction_resolve", {
    id,
    request: { answers },
  });
}

export async function nativeInteractionCancel(id: string): Promise<void> {
  await invoke("native_interaction_cancel", { id });
}

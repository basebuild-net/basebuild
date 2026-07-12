import { invoke } from "@tauri-apps/api/core";

/** One idea-generation round: a pipeline run of kind `idea_round` with
 *  per-status counts of the ideas it captured (via `ideas.batch_id`). */
export type IdeaRound = {
  id: string;
  sessionId: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  conceptCount: number;
  pickedCount: number;
  rejectedCount: number;
  archivedCount: number;
};

/** Start a generation round; returns the round id. Ideas captured while the
 *  round is active are tagged with it. */
export async function startIdeaRound(sessionId: string): Promise<string> {
  return invoke<string>("start_idea_round", { sessionId });
}

/** Finish the session's active round (idempotent). */
export async function finishIdeaRound(sessionId: string): Promise<string | null> {
  return invoke<string | null>("finish_idea_round", { sessionId });
}

/** List a session's rounds, newest first, with idea outcome counts. */
export async function listIdeaRounds(sessionId: string): Promise<IdeaRound[]> {
  return invoke<IdeaRound[]>("list_idea_rounds", { sessionId });
}

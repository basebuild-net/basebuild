import { invoke } from "@tauri-apps/api/core";

export type PlanProposal = {
  id: string;
  sessionId: string;
  runId: string | null;
  title: string;
  description: string;
  goal: string;
  suggestedChangeName: string;
  state: "proposed" | "accepted" | "dismissed";
  planId: string | null;
  createdAt: number;
};

export async function listPlanProposals(sessionId: string): Promise<PlanProposal[]> {
  return invoke<PlanProposal[]>("plan_proposal_list", { sessionId });
}

export async function acceptPlanProposal(proposalId: string): Promise<PlanProposal> {
  return invoke<PlanProposal>("plan_proposal_accept", { proposalId });
}

export async function dismissPlanProposal(proposalId: string): Promise<PlanProposal> {
  return invoke<PlanProposal>("plan_proposal_dismiss", { proposalId });
}

export async function resolveToolApproval(
  toolCallId: string,
  decision: "allow" | "allow_session" | "deny",
  commandPrefix?: string,
): Promise<boolean> {
  return invoke<boolean>("native_chat_resolve_approval", {
    toolCallId,
    decision,
    commandPrefix: commandPrefix ?? null,
  });
}

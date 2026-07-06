import { invoke } from "@tauri-apps/api/core";

/** Pull-request recommendation + creation (`plan-final-touches`).
 *  Mirrors `src-tauri/src/services/pull_request_service.rs`. */

export type PrRecommendation = {
  branch: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  ghAvailable: boolean;
  ghAuthed: boolean;
  compareUrl: string | null;
};

export type PrCreateResult = {
  success: boolean;
  url: string | null;
  error: string | null;
  method: "gh" | "browser" | "push";
};

/** Build a PR recommendation for a finished worktree run. */
export async function prRecommend(projectPath: string, branch: string): Promise<PrRecommendation> {
  return invoke<PrRecommendation>("pr_recommend", { projectPath, branch });
}

/** Create a PR: push the branch, then `gh pr create` (if available+authed)
 *  else open the GitHub compare URL. Confirm-gated by the caller. */
export async function prCreate(
  projectPath: string,
  branch: string,
  title: string,
  body: string,
): Promise<PrCreateResult> {
  return invoke<PrCreateResult>("pr_create", { projectPath, branch, title, body });
}

/** Probe `gh` availability + auth status. Returns `[available, authed]`. */
export async function prGhStatus(): Promise<[boolean, boolean]> {
  return invoke<[boolean, boolean]>("pr_gh_status");
}

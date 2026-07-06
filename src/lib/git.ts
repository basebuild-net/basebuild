import { invoke } from "@tauri-apps/api/core";

export type FileChangeType = "added" | "modified" | "deleted" | "renamed" | "untracked" | "unmerged" | "other";

export type FileEntry = {
  path: string;
  indexStatus: string | null;
  worktreeStatus: string | null;
  changeType: FileChangeType;
  staged: boolean;
};

export type BranchInfo = {
  branch: string;
  ahead: number;
  behind: number;
  upstream: string | null;
};

export type GitStatus = {
  branch: BranchInfo;
  staged: FileEntry[];
  unstaged: FileEntry[];
  untracked: FileEntry[];
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
};

export type GitBranch = {
  name: string;
  upstream: string | null;
  isCurrent: boolean;
};

export async function gitStatus(path: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { path });
}

export async function gitDiff(path: string, file: string, staged = false): Promise<string> {
  return invoke<string>("git_diff", { path, staged, file });
}

export async function gitAdd(path: string, file: string): Promise<void> {
  return invoke("git_add", { path, file });
}

export async function gitReset(path: string, file: string): Promise<void> {
  return invoke("git_reset", { path, file });
}

export async function gitDiscard(path: string, file: string): Promise<void> {
  return invoke("git_discard", { path, file });
}

export async function gitStageAll(path: string): Promise<void> {
  return invoke("git_stage_all", { path });
}

export async function gitUnstageAll(path: string): Promise<void> {
  return invoke("git_unstage_all", { path });
}

export async function gitPull(path: string): Promise<string> {
  return invoke<string>("git_pull", { path });
}

export async function gitPush(path: string): Promise<string> {
  return invoke<string>("git_push", { path });
}

export async function gitFetch(path: string): Promise<string> {
  return invoke<string>("git_fetch", { path });
}

export async function gitBranchList(path: string): Promise<GitBranch[]> {
  return invoke<GitBranch[]>("git_branch_list", { path });
}

export async function gitBranchCreate(path: string, name: string): Promise<void> {
  return invoke("git_branch_create", { path, name });
}

export async function gitBranchSwitch(path: string, name: string): Promise<void> {
  return invoke("git_branch_switch", { path, name });
}

export async function gitCommit(path: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitLog(path: string, limit = 20): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_log", { path, limit });
}

export async function gitCurrentBranch(path: string): Promise<string | null> {
  return invoke<string | null>("git_current_branch", { path });
}

export async function gitDefaultBranch(path: string): Promise<string | null> {
  return invoke<string | null>("git_default_branch", { path });
}

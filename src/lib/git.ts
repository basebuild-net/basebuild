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

export async function gitCommit(path: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitLog(path: string, limit = 20): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_log", { path, limit });
}

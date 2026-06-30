import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function pickProjectDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Basebuild project",
  });

  return typeof selected === "string" ? selected : null;
}

export type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

export type ProjectDetection = {
  path: string;
  gitRoot: string | null;
  hasGit: boolean;
  hasOpenSpec: boolean;
  hasBasebuild: boolean;
};

export async function rememberRecentProject(path: string): Promise<RecentProject> {
  return invoke<RecentProject>("remember_recent_project", { path });
}

export async function listRecentProjects(limit = 10): Promise<RecentProject[]> {
  return invoke<RecentProject[]>("list_recent_projects", { limit });
}

export async function detectProject(path: string): Promise<ProjectDetection> {
  return invoke<ProjectDetection>("detect_project", { path });
}

export async function createProjectBasebuildConfig(path: string): Promise<ProjectDetection> {
  return invoke<ProjectDetection>("create_project_basebuild_config", { path });
}

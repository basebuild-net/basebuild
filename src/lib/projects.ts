import { invoke } from "@tauri-apps/api/core";

export async function pickProjectDirectory(): Promise<string | null> {
  return invoke<string | null>("pick_project_directory");
}

export type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: number;
  lastActiveSessionId: string | null;
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

export async function getLastFocusedProject(): Promise<RecentProject | null> {
  return invoke<RecentProject | null>("get_last_focused_project");
}

export async function setLastFocusedProject(path: string): Promise<RecentProject> {
  return invoke<RecentProject>("set_last_focused_project", { path });
}

export async function detectProject(path: string): Promise<ProjectDetection> {
  return invoke<ProjectDetection>("detect_project", { path });
}

export async function createProjectBasebuildConfig(path: string): Promise<ProjectDetection> {
  return invoke<ProjectDetection>("create_project_basebuild_config", { path });
}

export async function removeRecentProject(path: string): Promise<void> {
  return invoke("remove_recent_project", { path });
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

export async function basebuildDataDir(): Promise<string> {
  return invoke<string>("basebuild_data_dir");
}

/** Initialize (or reuse) the Test Run Mode project: creates an empty folder
 *  with a basic `index.html` and the Basebuild config, then remembers it as
 *  a recent project. Returns the absolute project path. */
export async function testRunModeInit(): Promise<string> {
  return invoke<string>("test_run_mode_init");
}

export async function setLastActiveSession(projectPath: string, sessionId: string): Promise<void> {
  return invoke("set_last_active_session", { projectPath, sessionId });
}

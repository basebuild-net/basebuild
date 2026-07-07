import { invoke } from "@tauri-apps/api/core";

export type TaskProgress = {
  completed: number;
  total: number;
};

export async function openspecDeriveChangeName(title: string): Promise<string> {
  return invoke<string>("openspec_derive_change_name", { title });
}

export async function openspecResolveChangeName(
  projectPath: string,
  title: string,
): Promise<string> {
  return invoke<string>("openspec_resolve_change_name", { projectPath, title });
}

export async function openspecTaskProgress(
  projectPath: string,
  changeName: string,
): Promise<TaskProgress> {
  const [completed, total] = await invoke<[number, number]>("openspec_task_progress", {
    projectPath,
    changeName,
  });
  return { completed, total };
}

export async function openspecParseTaskProgress(content: string): Promise<TaskProgress> {
  const [completed, total] = await invoke<[number, number]>("openspec_parse_task_progress", {
    content,
  });
  return { completed, total };
}

export type StructuredTask = {
  line: number;
  checked: boolean;
  id?: string;
  text: string;
};

export type TaskPhase = {
  name: string;
  line: number;
  tasks: StructuredTask[];
};

export type StructuredTasks = {
  phases: TaskPhase[];
  total: number;
  completed: number;
};

export type ChangeCatalogEntry = {
  name: string;
  hasProposal: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
  hasSpecs: boolean;
  completed: number;
  total: number;
  linkedPlanReferenceId?: string;
  archived: boolean;
  createdAt: number;
};

export async function openspecListChanges(projectPath: string): Promise<ChangeCatalogEntry[]> {
  return invoke<ChangeCatalogEntry[]>("openspec_list_changes", { projectPath });
}

export async function openspecParseTasksStructured(content: string): Promise<StructuredTasks> {
  return invoke<StructuredTasks>("openspec_parse_tasks_structured", { content });
}

export async function openspecReadTasksStructured(
  projectPath: string,
  changeName: string,
): Promise<StructuredTasks> {
  return invoke<StructuredTasks>("openspec_read_tasks_structured", { projectPath, changeName });
}

export async function openspecToggleTask(
  projectPath: string,
  changeName: string,
  line: number,
  makeChecked: boolean,
): Promise<void> {
  await invoke<void>("openspec_toggle_task", { projectPath, changeName, line, makeChecked });
}

export async function openspecArchiveChange(
  projectPath: string,
  changeName: string,
): Promise<void> {
  await invoke<void>("openspec_archive_change", { projectPath, changeName });
}

export async function openspecLinkChangeToPlan(changeName: string, planId: string): Promise<void> {
  await invoke<void>("openspec_link_change_to_plan", { changeName, planId });
}

export async function openspecUnlinkPlanFromChange(planId: string): Promise<void> {
  await invoke<void>("openspec_unlink_plan_from_change", { planId });
}

export async function openspecRefreshTaskProgress(
  projectPath: string,
  changeName: string,
  lastCompleted: number,
  lastTotal: number,
): Promise<boolean> {
  return invoke<boolean>("openspec_refresh_task_progress", {
    projectPath,
    changeName,
    lastCompleted,
    lastTotal,
  });
}

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

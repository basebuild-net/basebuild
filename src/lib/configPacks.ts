import { invoke } from "@tauri-apps/api/core";

export type PackSource = "builtIn" | "user" | "project" | "installed";

export type PackManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  source: PackSource;
  prompts: string[];
};

export type ConfigPack = {
  manifest: PackManifest;
  path: string;
};

export async function listConfigPacks(projectPath?: string): Promise<ConfigPack[]> {
  return invoke<ConfigPack[]>("list_config_packs", { projectPath });
}

export async function createUserConfigPack(name: string): Promise<ConfigPack> {
  return invoke<ConfigPack>("create_user_config_pack", { name });
}

import { invoke } from "@tauri-apps/api/core";

export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
};

export async function listFiles(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_files", { path });
}

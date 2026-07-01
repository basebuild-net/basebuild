import { invoke } from "@tauri-apps/api/core";

export type UpdateInfo = {
  available: boolean;
  version: string | null;
  notes: string | null;
  downloadUrl: string | null;
};

export async function checkForUpdates(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_updates");
}

export async function installUpdate(): Promise<void> {
  return invoke("install_update");
}

import { invoke } from "@tauri-apps/api/core";

export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

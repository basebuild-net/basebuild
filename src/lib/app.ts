import { invoke } from "@tauri-apps/api/core";

export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** Open a URL in the system browser. Used for provider API-key pages. */
export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

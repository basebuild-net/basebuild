import { invoke } from "@tauri-apps/api/core";

export async function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** Open a URL in the system browser. Used for provider API-key pages. */
export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

/** Fully restart the Basebuild process. The last-resort recovery action when
 *  reloading the webview cannot recover the UI or a wedged backend. Never
 *  resolves — the process re-execs into a fresh instance. */
export async function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}

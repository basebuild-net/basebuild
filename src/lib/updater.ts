import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type UpdateChannelStatus =
  | "ok"
  | "endpointUnavailable"
  | "malformedManifest"
  | "platformMissing"
  | "signatureInvalid"
  | "networkUnreachable"
  | "unknown";

export type UpdatePolicyInfo = {
  mandatory: boolean;
  minimumSupportedVersion: string | null;
  releaseSummary: string | null;
};

export type UpdateInfo = {
  available: boolean;
  version: string | null;
  currentVersion: string | null;
  notes: string | null;
  date: string | null;
  target: string | null;
  downloadUrl: string | null;
  channelStatus: UpdateChannelStatus;
  channelExplanation: string;
  rawError: string | null;
  policy: UpdatePolicyInfo;
  skipped: boolean;
};

export type UpdateStep = "downloading" | "downloaded" | "installing" | "restarting";

export type UpdateProgress = {
  step: string;
  downloaded: number;
  total: number | null;
  message: string;
};

export async function checkForUpdates(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_updates");
}

/** Download and stage an update in the background. Does NOT install or
 *  restart — the update applies only via `applyDownloadedUpdate`.
 *  Resolves with the staged version. */
export async function downloadUpdate(): Promise<string> {
  return invoke<string>("download_update");
}

/** Install the staged update and restart the app. User-triggered only. */
export async function applyDownloadedUpdate(): Promise<void> {
  return invoke("apply_downloaded_update");
}

export async function clearSkippedUpdate(): Promise<void> {
  return invoke("clear_skipped_update");
}

export async function getSkippedUpdateVersion(): Promise<string | null> {
  return invoke<string | null>("get_skipped_update_version");
}

/// Subscribe to update progress events. Returns an unlisten function.
export function onUpdaterProgress(
  callback: (progress: UpdateProgress) => void,
): Promise<UnlistenFn> {
  return listen<UpdateProgress>("updater://progress", (event) => {
    callback(event.payload);
  });
}

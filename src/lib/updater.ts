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

export type UpdateStep = "downloading" | "installing" | "restarting";

export type UpdateProgress = {
  step: string;
  downloaded: number;
  total: number | null;
  message: string;
};

export async function checkForUpdates(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_updates");
}

export async function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export async function installUpdateWithProgress(): Promise<void> {
  return invoke("install_update_with_progress");
}

export async function skipUpdateVersion(version: string): Promise<void> {
  return invoke("skip_update_version", { version });
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

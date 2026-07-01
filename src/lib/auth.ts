import { invoke } from "@tauri-apps/api/core";

export type NativeProfile = {
  id: string;
  username: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
  isEditor: boolean;
};

export type StoredAuth = {
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  user: NativeProfile | null;
};

export type DeviceStartResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type PollResult =
  | { status: "pending"; interval: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "success"; accessToken: string; expiresAt: string; scopes: string[]; user: NativeProfile };

export async function authStatus(): Promise<StoredAuth | null> {
  return invoke<StoredAuth | null>("auth_status");
}

export async function authStartDeviceFlow(opts?: {
  clientName?: string;
  clientVersion?: string;
  platform?: string;
}): Promise<DeviceStartResult> {
  return invoke<DeviceStartResult>("auth_start_device_flow", {
    clientName: opts?.clientName ?? "Basebuild Desktop",
    clientVersion: opts?.clientVersion ?? null,
    platform: opts?.platform ?? null,
  });
}

export async function authPollDeviceFlow(deviceCode: string): Promise<PollResult> {
  return invoke<PollResult>("auth_poll_device_flow", { deviceCode });
}

export async function authFetchProfile(): Promise<NativeProfile> {
  return invoke<NativeProfile>("auth_fetch_profile");
}

export async function authSignOut(): Promise<void> {
  return invoke("auth_sign_out");
}

export async function authGetToken(): Promise<string | null> {
  return invoke<string | null>("auth_get_token");
}

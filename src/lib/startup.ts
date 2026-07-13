import { invoke } from "@tauri-apps/api/core";

// ─── Types ───

export type LaunchMode = "foreground" | "background";

export type RegistrationState = "enabled" | "disabled" | "unsupported";

export type RegistrationError = "osDenied" | "staleEntry" | "internal";

export type ReconciliationAction = "noop" | "repaired" | "removed" | "failed";

export type ReconciliationResult = {
  success: boolean;
  action: ReconciliationAction;
  error: RegistrationError | null;
};

export type StartupRegistrationStatus = {
  desired: boolean;
  effective: RegistrationState;
  platformSupported: boolean;
  lastReconciliation: ReconciliationResult | null;
};

// ─── Invoke wrappers ───

export async function startupGetStatus(): Promise<StartupRegistrationStatus> {
  return invoke<StartupRegistrationStatus>("startup_get_status");
}

export async function startupEnable(): Promise<StartupRegistrationStatus> {
  return invoke<StartupRegistrationStatus>("startup_enable");
}

export async function startupDisable(): Promise<StartupRegistrationStatus> {
  return invoke<StartupRegistrationStatus>("startup_disable");
}

export async function startupReconcile(): Promise<StartupRegistrationStatus> {
  return invoke<StartupRegistrationStatus>("startup_reconcile");
}

export async function startupLaunchMode(): Promise<LaunchMode> {
  return invoke<LaunchMode>("startup_launch_mode");
}

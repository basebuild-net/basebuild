import { invoke } from "@tauri-apps/api/core";

// Stability report and telemetry lib wrappers.

export type StabilityReport = {
  id: string;
  kind: string;
  timestamp: number;
  summary: string;
  details: string;
  seen: boolean;
};

export type CommandTelemetryEntry = {
  command: string;
  durationMs: number;
  timestamp: number;
  violation: boolean;
};

export async function stabilityListReports(): Promise<StabilityReport[]> {
  return invoke<StabilityReport[]>("stability_list_reports");
}

export async function stabilityReadReport(id: string): Promise<StabilityReport> {
  return invoke<StabilityReport>("stability_read_report", { id });
}

export async function stabilityDeleteReport(id: string): Promise<void> {
  return invoke("stability_delete_report", { id });
}

export async function stabilityMarkSeen(id: string): Promise<void> {
  return invoke("stability_mark_seen", { id });
}

export async function stabilityUnseenCount(): Promise<number> {
  return invoke<number>("stability_unseen_count");
}

export async function stabilityRecentTelemetry(limit?: number): Promise<CommandTelemetryEntry[]> {
  return invoke<CommandTelemetryEntry[]>("stability_recent_telemetry", { limit });
}

export async function stabilityViolations(): Promise<CommandTelemetryEntry[]> {
  return invoke<CommandTelemetryEntry[]>("stability_violations");
}

export async function stabilityRendererHeartbeat(): Promise<void> {
  return invoke("stability_renderer_heartbeat");
}

/** Persist a renderer crash so it survives the recovery reload/restart and
 *  appears in the Debug panel alongside Rust panics and freezes. Best-effort;
 *  callers ignore failures so recovery is never blocked. */
export async function stabilityRecordRendererCrash(
  source: string,
  message: string,
  details: string,
): Promise<void> {
  return invoke("stability_record_renderer_crash", { source, message, details });
}

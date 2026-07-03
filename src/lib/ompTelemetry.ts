import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type OmpAttachmentState =
  | { state: "attached" }
  | { state: "detached"; reason?: string | null }
  | { state: "stale"; reason?: string | null };

export type PlanSource = "local" | "account";

export type OmpMessageTelemetry = {
  sessionId?: string;
  provider?: string;
  model?: string;
  planTier?: string;
  planSource?: PlanSource;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  costTotal?: number;
  avgTtftMs?: number;
  avgDurationMs?: number;
  requests?: number;
  errorRate?: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
};

export type OmpUsageWindow = {
  window: string;
  usedFraction: number;
  remainingFraction: number;
  resetsAt?: string;
  severity: string;
  measuredAt?: number;
  ageMinutes?: number;
  isStale: boolean;
};

export type OmpLiveContext = {
  attachment: OmpAttachmentState;
  provider?: string;
  model?: string;
  planTier?: string;
  planSource?: PlanSource;
  effort?: string;
  sessionId?: string;
  windows: OmpUsageWindow[];
  recentMessages: OmpMessageTelemetry[];
  assembledAt: number;
};

export async function ompTelemetryStart(): Promise<void> {
  await invoke("omp_telemetry_start");
}

export async function ompTelemetryStop(): Promise<void> {
  await invoke("omp_telemetry_stop");
}

export async function ompTelemetrySnapshot(): Promise<OmpLiveContext> {
  return invoke<OmpLiveContext>("omp_telemetry_snapshot");
}

export async function ompTelemetryRefresh(): Promise<OmpLiveContext> {
  return invoke<OmpLiveContext>("omp_telemetry_refresh");
}

export async function listenOmpTelemetry(
  handler: EventCallback<OmpLiveContext>,
): Promise<UnlistenFn> {
  return listen<OmpLiveContext>("omp-telemetry://update", handler);
}

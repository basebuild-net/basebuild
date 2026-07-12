import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type LiveUsageRow = {
  provider: string;
  window: string;
  usedFraction: number;
  remainingFraction: number;
  resetsAt?: string;
  severity: string;
  fetchedAgoMin?: number;
  isStale: boolean;
};

export type LiveUsage = {
  rows: LiveUsageRow[];
  shouldSync: boolean;
};

export type UsageSnapshotRow = {
  provider: string;
  model: string;
  requestsPerDay: number;
  hoursPerDay: number;
  costPerDay?: number;
  avgDurationMs?: number;
  avgTtftMs?: number;
  errorRate?: number;
};

export type UsageSnapshot = {
  rows: UsageSnapshotRow[];
};

export type PlanSummary = {
  provider: string;
  monthlyRequests?: number;
  dominantModel?: string;
  looksLikeSubscription?: boolean;
  inferredTier?: string;
  confidence: string;
};

export type PlanSummaries = {
  plans: PlanSummary[];
};

export type PlanTimelineWindow = {
  provider: string;
  tier?: string;
  startedAt?: string;
  endedAt?: string;
  hadExhaustionEvent: boolean;
  isCurrent: boolean;
};

export type PlanTimeline = {
  windows: PlanTimelineWindow[];
};

export type ProjectedUsage = {
  live: LiveUsage;
  snapshot: UsageSnapshot;
  plans: PlanSummaries;
  timeline: PlanTimeline;
  assembledAt: number;
};

export type AutoSyncStatus = {
  enabled: boolean;
  gatesPass: boolean;
  intervalMinutes: number;
  lastSyncAt?: number;
  lastError?: string;
  /** Usage sync detail mode: "rows" (server rolls up) or "summary". */
  syncMode?: string;
};

export type SyncResult = {
  ok: boolean;
  message: string;
  completedAt: number;
};

export async function usageSyncTrigger(reason?: string): Promise<void> {
  await invoke("usage_sync_trigger", { reason: reason ?? null });
}

export async function usageSyncSetEnabled(enabled: boolean): Promise<void> {
  await invoke("usage_sync_set_enabled", { enabled });
}

export async function usageSyncSetMode(mode: "rows" | "summary"): Promise<void> {
  await invoke("usage_sync_set_mode", { mode });
}

export async function usageSyncStatus(): Promise<AutoSyncStatus> {
  return invoke<AutoSyncStatus>("usage_sync_status");
}

export async function usageSyncProjectedUsage(): Promise<ProjectedUsage> {
  return invoke<ProjectedUsage>("usage_sync_projected_usage");
}

export async function listenUsageSyncStatus(
  handler: EventCallback<SyncResult>,
): Promise<UnlistenFn> {
  return listen<SyncResult>("usage-sync://status", handler);
}

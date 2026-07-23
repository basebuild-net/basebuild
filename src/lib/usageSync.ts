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

export type SyncAttribution = "account" | "private_installation";

export type SyncOffReason =
  | "usage_sharing_disabled"
  | "auto_sync_disabled"
  | "consent_required"
  | "no_sources_available"
  | "retry_backoff";

export type SyncOverallOutcome = "success" | "partial" | "failed" | "nothing_to_sync";

export type UsageSyncSource = "native" | "omp" | "claude-code" | "codex" | "opencode";

export type SourceSyncStatus = {
  source: UsageSyncSource;
  available: boolean;
  availabilityReason?: string;
  pendingRetry: boolean;
  lastSuccessAt?: number;
  lastProcessedAt?: number;
  lastError?: string;
};

export type AutoSyncStatus = {
  enabled: boolean;
  gatesPass: boolean;
  offReason?: SyncOffReason;
  attribution: SyncAttribution;
  intervalMinutes: number;
  lastSyncAt?: number;
  lastError?: string;
  /** Usage sync detail mode: "rows" (server rolls up) or "summary". */
  syncMode?: string;
  overallOutcome?: SyncOverallOutcome;
  sources: SourceSyncStatus[];
};

export type SyncResult = {
  ok: boolean;
  message: string;
  completedAt: number;
};

export async function usageSyncTrigger(reason?: string): Promise<void> {
  await invoke("usage_sync_trigger", { reason: reason ?? null });
}

export async function usageSyncRetry(): Promise<void> {
  await invoke("usage_sync_retry");
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

export type DetectedProviderPlan = {
  provider: string;
  ompProvider: string;
  accountEmail: string | null;
  detectedPlanType: string | null;
  confidence: string;
  source: string;
  needsDeclaration: boolean;
  note: string | null;
};

export type ProviderPlanOption = {
  id: string;
  provider: string;
  name: string;
  tier: string | null;
  price: number | null;
  period: string | null;
  label: string;
};

export async function usageDetectProviderPlans(): Promise<DetectedProviderPlan[]> {
  return invoke<DetectedProviderPlan[]>("usage_detect_provider_plans");
}

export async function usageListProviderPlans(provider?: string): Promise<ProviderPlanOption[]> {
  return invoke<ProviderPlanOption[]>("usage_list_provider_plans", { provider: provider ?? null });
}

export async function usageDeclareProviderPlans(plans: Record<string, string>): Promise<string> {
  return invoke<string>("usage_declare_provider_plans", { plans });
}

export async function listenUsageSyncStatus(
  handler: EventCallback<SyncResult>,
): Promise<UnlistenFn> {
  return listen<SyncResult>("usage-sync://status", handler);
}

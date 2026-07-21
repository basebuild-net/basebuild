import { invoke } from "@tauri-apps/api/core";
import type { ImplementationAssessment } from "./planning-assessment";

export type NativeChatSession = {
  id: string;
  projectPath: string;
  title: string;
  profileId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
  status: string;
  runState: string;
  createdAt: number;
  updatedAt: number;
};

export type NativeChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string | null;
  sortOrder: number;
  providerId: string | null;
  modelId: string | null;
  effortLevel: string | null;
  createdAt: number;
};

export type NativeToolEvent = {
  id: string;
  sessionId: string;
  messageId: string | null;
  kind: string;
  status: string;
  summary: string;
  /** Raw arguments JSON the model passed to the tool (file path, command, pattern, etc.). */
  arguments: string | null;
  /** Unified line diff for edit_file/write_file results. */
  diff: string | null;
  /** How the approval decision was made: "approved", "denied", "auto", "rule". */
  decision: string | null;
  /** The rule pattern that matched, if any. */
  ruleSource: string | null;
  sequence: number;
  createdAt: number;
};

export type NativeProvider = {
  id: string;
  label: string;
  status: string;
  credentialOwner: string;
  configured: boolean;
  /** How the stored credential authenticates: native OAuth, Oh My Pi, or API key. */
  connectedVia?: "oauth" | "omp" | "api" | null;
  localOnly: boolean;
  detail: string;
  authMethod: "local" | "api_key" | "oauth" | string;
  apiKeyUrl: string | null;
  /** Suggested API base URL for key-based connects (prefills the endpoint field). */
  defaultBaseUrl?: string | null;
  modelCount: number;
  /** Number of attached accounts (stored + Oh My Pi virtual). */
  accountCount: number;
  /** Attached accounts using Basebuild-native OAuth. */
  oauthCount: number;
  /** Attached accounts using a plain API key. */
  apiKeyCount: number;
  /** Aggregate account health: "healthy" | "degraded" | "broken". */
  aggregateHealth: "healthy" | "degraded" | "broken" | string;
  lastSyncedAt: number | null;
  source: "bundled" | "provider_discovered" | "cli_discovered" | "hosted_fallback" | "stale_cache" | "unavailable" | string;
  error: string | null;
};

/** One attached provider account (secret-free). */
export type ProviderAccount = {
  id: string;
  providerId: string;
  label: string;
  authMethod: "oauth" | "api" | "omp" | string;
  health: "healthy" | "rate_limited" | "auth_expired" | "error" | string;
  cooldownUntil?: number | null;
  lastError?: string | null;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Per-account usage aggregate over a trailing window. */
export type ProviderAccountUsage = {
  /** Null aggregates pre-migration rows ("unattributed"). */
  accountId: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costTotal: number;
  /** Share of the provider's requests in the window, 0..1. */
  requestShare: number;
};

/** Account selection strategy for splitting usage across accounts. */
export type ProviderAccountStrategy = "round_robin" | "sticky_session" | "fill_first";

export type NativeModel = {
  id: string;
  providerId: string;
  label: string;
  supportsEffort: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  localOnly: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  supportsReasoning: boolean;
  supportedEfforts: string[];
  supportsImages: boolean;
  source: string;
  /** Wire-protocol kind from the model catalog (e.g. "devin-agent"). Empty
   *  for legacy rows; resolveClient treats empty as "openai-completions". */
  apiKind?: string;
  /** Model's API base URL from the model catalog. Empty for legacy rows. */
  baseUrl?: string;
  /** Per-million-token input cost (USD), null when unknown. */
  costInput?: number | null;
  /** Per-million-token output cost (USD), null when unknown. */
  costOutput?: number | null;
  /** Every catalog source that lists this model, cross-referenced during
   *  refresh: "catalog_sync" (basebuild.net), "bundled" (shipped static
   *  catalog), "provider_discovered" (provider /v1/models), "omp_cli"
   *  (`omp models`), "hosted_fallback". A live source (provider_discovered /
   *  omp_cli) means the model was confirmed available, not just catalogued. */
  detectedBy?: string[];
};

export type NativeEffortLevel = {
  id: string;
  label: string;
  description: string;
};

export type NativeProviderCatalog = {
  providers: NativeProvider[];
  models: NativeModel[];
  effortLevels: NativeEffortLevel[];
  defaultProviderId: string;
  defaultModelId: string;
  defaultEffortLevel: string;
  fetchedAt: number;
  stale: boolean;
};

export type NativeChatBootstrap = {
  catalog: NativeProviderCatalog;
  resolved: ResolvedChatModelDefault;
};

export type NativeRequestMetric = {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  ttftMs: number | null;
  ttltMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokensPerSecond: number | null;
  costTotal: number | null;
  outcome: string;
  errorClass: string | null;
  createdAt: number;
};

export type NativeRequestMetricsSummary = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgTokensPerSecond: number | null;
  avgTtftMs: number | null;
  avgTtltMs: number | null;
  lastProviderId: string | null;
  lastModelId: string | null;
  lastEffortLevel: string | null;
};

export type NativeSetupRequired = {
  providerId: string;
  providerLabel: string;
  message: string;
};

export type NativeChatSendResult = {
  userMessage: NativeChatMessage;
  assistantMessage: NativeChatMessage | null;
  metrics: NativeRequestMetric | null;
  toolEvents: NativeToolEvent[];
  setupRequired: NativeSetupRequired | null;
  offline: boolean;
};

export type NativeGeneratedIdea = {
  title: string;
  description: string;
  grounding: string;
  anchor?: string;
  assessment?: ImplementationAssessment;
};

export type GroundingMetadata = {
  schematicSections: string[];
  finishedPlans: string[];
  finishedPlanCount: number;
  pickedCount: number;
  rejectedCount: number;
  digestEmpty: boolean;
};

export type NativeGenerateIdeasResult = {
  ideas: NativeGeneratedIdea[];
  setupRequired: NativeSetupRequired | null;
  grounding: GroundingMetadata | null;
  userMessage?: NativeChatMessage | null;
  assistantMessage?: NativeChatMessage | null;
};


export async function nativeProviderCatalog(): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_catalog");
}

/** Resolve the cache-first provider catalog and project model default from one snapshot. */
export async function nativeChatBootstrap(projectPath: string): Promise<NativeChatBootstrap> {
  return invoke<NativeChatBootstrap>("native_chat_bootstrap", { projectPath });
}

export async function nativeProviderCatalogRefresh(input?: {
  providerId?: string | null;
  force?: boolean;
}): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_catalog_refresh", { request: input ?? null });
}
export type CatalogSyncResult = {
  synced: number;
  skipped: number;
  error: string | null;
};

export async function nativeCatalogSync(): Promise<CatalogSyncResult> {
  return invoke<CatalogSyncResult>("native_catalog_sync");
}
export async function nativeChatStart(input: {
  projectPath: string;
  title?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  effortLevel?: string | null;
}): Promise<NativeChatSession> {
  return invoke<NativeChatSession>("native_chat_start", { request: input });
}

export async function nativeChatGet(sessionId: string): Promise<NativeChatSession | null> {
  return invoke<NativeChatSession | null>("native_chat_get", { sessionId });
}


export async function renameNativeChatSession(sessionId: string, title: string): Promise<void> {
  return invoke("native_chat_rename", { sessionId, title });
}



export type NativeProviderCredentialInput = {
  providerId: string;
  label: string;
  apiKey: string;
  baseUrl?: string | null;
};

export async function nativeSaveProviderCredential(input: NativeProviderCredentialInput): Promise<void> {
  return invoke("native_save_provider_credential", { input });
}

export async function nativeDeleteProviderCredential(providerId: string): Promise<void> {
  return invoke("native_delete_provider_credential", { providerId });
}

// ─── Provider accounts (multi-account) ───

/** List every attached account for a provider (OAuth, API key, Oh My Pi). */
export async function nativeProviderAccountsList(providerId: string): Promise<ProviderAccount[]> {
  return invoke<ProviderAccount[]>("native_provider_accounts_list", { providerId });
}

/** Log out one account; sibling accounts on the provider stay attached. */
export async function nativeProviderAccountLogout(accountId: string): Promise<void> {
  return invoke("native_provider_account_logout", { accountId });
}

/** Rename an account's display label. */
export async function nativeProviderAccountSetLabel(accountId: string, label: string): Promise<void> {
  return invoke("native_provider_account_set_label", { accountId, label });
}

/** Run a minimal authenticated request and return the account with refreshed health. */
export async function nativeProviderAccountTest(accountId: string): Promise<ProviderAccount> {
  return invoke<ProviderAccount>("native_provider_account_test", { accountId });
}

/** Per-account usage aggregates for a provider over a trailing window (seconds). */
export async function nativeProviderAccountUsage(providerId: string, windowSecs: number): Promise<ProviderAccountUsage[]> {
  return invoke<ProviderAccountUsage[]>("native_provider_account_usage", { providerId, windowSecs });
}

/** Read the account selection strategy (provider-specific, falling back to global). */
export async function nativeProviderAccountStrategy(providerId?: string | null): Promise<ProviderAccountStrategy> {
  return invoke<ProviderAccountStrategy>("native_provider_account_strategy", { providerId: providerId ?? null });
}

/** Set the account selection strategy; omit providerId to set the global default. */
export async function nativeProviderAccountStrategySet(providerId: string | null, strategy: ProviderAccountStrategy): Promise<void> {
  return invoke("native_provider_account_strategy_set", { providerId, strategy });
}
export async function nativeChatList(projectPath: string): Promise<NativeChatSession[]> {
  return invoke<NativeChatSession[]>("native_chat_list", { projectPath });
}

export type NativeChatHistoryEntry = NativeChatSession & { messageCount: number };

export async function nativeChatHistory(limit?: number): Promise<NativeChatHistoryEntry[]> {
  return invoke<NativeChatHistoryEntry[]>("native_chat_history", { limit: limit ?? null });
}

export async function nativeChatMessages(sessionId: string): Promise<NativeChatMessage[]> {
  return invoke<NativeChatMessage[]>("native_chat_messages", { sessionId });
}

/** Persist provider/model/effort on an existing session so the selection
 * survives restart. Called when the user changes the selection in the
 * composer. Also persists the project default for new sessions. */
export async function nativeChatUpdateSessionModel(input: {
  sessionId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
}): Promise<NativeChatSession> {
  return invoke<NativeChatSession>("native_chat_update_session_model", input);
}

export async function nativeChatSend(input: {
  sessionId: string;
  content: string;
  providerId?: string | null;
  modelId?: string | null;
  effortLevel?: string | null;
}): Promise<NativeChatSendResult> {
  return invoke<NativeChatSendResult>("native_chat_send", { request: input });
}

export async function nativeRequestMetrics(limit?: number): Promise<NativeRequestMetric[]> {
  return invoke<NativeRequestMetric[]>("native_request_metrics", { limit: limit ?? 100 });
}

export async function nativeRequestMetricsSummary(): Promise<NativeRequestMetricsSummary> {
  return invoke<NativeRequestMetricsSummary>("native_request_metrics_summary");
}

export async function nativeSessionLatestMetric(sessionId: string): Promise<NativeRequestMetric | null> {
  return invoke<NativeRequestMetric | null>("native_session_latest_metric", { sessionId });
}

export async function nativeGenerateIdeas(input: {
  sessionId: string;
  schematic?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  effortLevel?: string | null;
  planningSessionId: string;
  categoryIds?: string[];
  ideaCount?: number;
  /** Compact transcript row shown while the native skill runs. */
  displayMessage?: string | null;
  /** User-authored steering passed as native skill arguments. */
  direction?: string | null;
}): Promise<NativeGenerateIdeasResult> {
  return invoke<NativeGenerateIdeasResult>("native_generate_ideas", { request: input });
}


export type NativeProviderLoginState = {
  providerId: string;
  status: "starting" | "waiting" | "waiting_browser" | "waiting_input" | "complete" | "error" | "cancelled";
  message: string;
  prompt: string | null;
  complete: boolean;
  error: string | null;
};

export async function nativeProviderLoginStart(
  providerId: string,
): Promise<NativeProviderLoginState> {
  return invoke<NativeProviderLoginState>("native_provider_login_start", { providerId });
}

export async function nativeProviderLoginPoll(
  providerId: string,
): Promise<NativeProviderLoginState> {
  return invoke<NativeProviderLoginState>("native_provider_login_poll", { providerId });
}

export async function nativeProviderLoginSubmit(
  providerId: string,
  value: string,
): Promise<NativeProviderLoginState> {
  return invoke<NativeProviderLoginState>("native_provider_login_submit", { providerId, value });
}

export async function nativeProviderLoginCancel(
  providerId: string,
): Promise<NativeProviderLoginState> {
  return invoke<NativeProviderLoginState>("native_provider_login_cancel", { providerId });
}

export async function nativeProviderRefreshOmpCredentials(
  providerId?: string | null,
): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_refresh_omp_credentials", {
    providerId: providerId ?? null,
  });
}

// ─── Chat Model Defaults ───

export type ChatModelDefault = {
  providerId: string;
  modelId: string;
  effortLevel: string;
};

export type ResolvedChatModelDefault = {
  providerId: string;
  modelId: string;
  effortLevel: string;
  /** Where the resolved value came from: "project", "global", or "fallback". */
  source: string;
  /** Non-empty when the stored default was unavailable and a fallback was used. */
  notice: string | null;
};

/** Resolve the chat model default for a project (project → global → fallback). */
export async function nativeChatModelDefault(projectPath: string): Promise<ResolvedChatModelDefault> {
  return invoke<ResolvedChatModelDefault>("native_chat_model_default", { projectPath });
}

/** Cancel a running agent loop for a session. Returns true if a run was found. */
export async function nativeChatCancel(sessionId: string): Promise<boolean> {
  return invoke<boolean>("native_chat_cancel", { sessionId });
}

/** Delete all persisted messages and tool events for a session.
 * Preserves the session record and provider/model/effort selection.
 * Returns the count of deleted messages. */
export async function nativeChatClearMessages(sessionId: string): Promise<number> {
  return invoke<number>("native_chat_clear_messages", { sessionId });
}

/** List tool events for a session (tool calls, approvals, metrics). */
export async function nativeChatToolEvents(sessionId: string): Promise<NativeToolEvent[]> {
  return invoke<NativeToolEvent[]>("native_chat_tool_events", { sessionId });
}

/** Persist the per-project chat model default (called on manual composer selection). */
export async function nativeChatSetProjectModelDefault(
  projectPath: string,
  defaultModel: ChatModelDefault,
): Promise<void> {
  return invoke("native_chat_set_project_model_default", { projectPath, default: defaultModel });
}

/** Persist the global chat model default. */
export async function nativeChatSetGlobalModelDefault(defaultModel: ChatModelDefault): Promise<void> {
  return invoke("native_chat_set_global_model_default", { default: defaultModel });
}

/** Resolve a pending tool approval request (allow once / allow session / deny). */
export async function resolveToolApproval(
  toolCallId: string,
  decision: "allow" | "allow_session" | "deny",
  commandPrefix?: string,
): Promise<boolean> {
  return invoke<boolean>("native_chat_resolve_approval", {
    toolCallId,
    decision,
    commandPrefix: commandPrefix ?? null,
  });
}

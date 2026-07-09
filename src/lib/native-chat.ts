import { invoke } from "@tauri-apps/api/core";

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
  /** Stable per-session monotonic order. */
  sequence: number;
  createdAt: number;
};

export type NativeProvider = {
  id: string;
  label: string;
  status: string;
  credentialOwner: string;
  configured: boolean;
  localOnly: boolean;
  detail: string;
  authMethod: "local" | "api_key" | "oauth" | string;
  apiKeyUrl: string | null;
  modelCount: number;
  lastSyncedAt: number | null;
  source: "bundled" | "provider_discovered" | "cli_discovered" | "hosted_fallback" | "stale_cache" | "unavailable" | string;
  error: string | null;
};

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
  /** Wire-protocol kind from the OMP catalog (e.g. "devin-agent"). Empty
   *  for legacy rows; resolveClient treats empty as "openai-completions". */
  apiKind?: string;
  /** Model's API base URL from the OMP catalog. Empty for legacy rows. */
  baseUrl?: string;
  /** Per-million-token input cost (USD), null when unknown. */
  costInput?: number | null;
  /** Per-million-token output cost (USD), null when unknown. */
  costOutput?: number | null;
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
};

export type NativeGenerateIdeasResult = {
  ideas: NativeGeneratedIdea[];
  setupRequired: NativeSetupRequired | null;
};

export type ProviderLoginStart = {
  providerId: string;
  providerLabel: string;
  landingUrl: string;
  providerUrl: string;
};

export type ProviderLoginPoll = {
  status: "pending" | "success" | "error" | "cancelled";
  message: string | null;
};

export async function nativeProviderCatalog(): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_catalog");
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


export type NativeProviderCredential = {
  providerId: string;
  label: string;
  apiKey: string;
  baseUrl: string | null;
  updatedAt: number;
};

export type NativeProviderCredentialInput = {
  providerId: string;
  label: string;
  apiKey: string;
  baseUrl?: string | null;
};

export async function nativeSaveProviderCredential(input: NativeProviderCredentialInput): Promise<NativeProviderCredential> {
  return invoke<NativeProviderCredential>("native_save_provider_credential", { input });
}

export async function nativeListProviderCredentials(): Promise<NativeProviderCredential[]> {
  return invoke<NativeProviderCredential[]>("native_list_provider_credentials");
}

export async function nativeDeleteProviderCredential(providerId: string): Promise<void> {
  return invoke("native_delete_provider_credential", { providerId });
}
export async function nativeChatList(projectPath: string): Promise<NativeChatSession[]> {
  return invoke<NativeChatSession[]>("native_chat_list", { projectPath });
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

export async function nativeGenerateIdeas(input: {
  sessionId: string;
  schematic?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  effortLevel?: string | null;
  categoryId?: string | null;
}): Promise<NativeGenerateIdeasResult> {
  return invoke<NativeGenerateIdeasResult>("native_generate_ideas", { request: input });
}

export async function nativeProviderLoginStart(providerId: string): Promise<ProviderLoginStart> {
  return invoke<ProviderLoginStart>("native_provider_login_start", { providerId });
}

export async function nativeProviderLoginPoll(providerId: string): Promise<ProviderLoginPoll> {
  return invoke<ProviderLoginPoll>("native_provider_login_poll", { providerId });
}

export async function nativeProviderLoginCancel(providerId: string): Promise<void> {
  return invoke("native_provider_login_cancel", { providerId });
}

export async function nativeProviderOmpLoginCommand(providerId: string): Promise<string> {
  return invoke<string>("native_provider_omp_login_command", { providerId });
}

export async function nativeProviderRefreshOmpCredentials(
  providerId: string,
): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_refresh_omp_credentials", { providerId });
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

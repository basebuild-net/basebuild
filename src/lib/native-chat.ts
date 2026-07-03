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
  createdAt: number;
  updatedAt: number;
};

export type NativeChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
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
  localOnly: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  supportsReasoning: boolean;
  supportedEfforts: string[];
  supportsImages: boolean;
  source: string;
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

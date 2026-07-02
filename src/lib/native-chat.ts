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
};

export type NativeModel = {
  id: string;
  providerId: string;
  label: string;
  supportsEffort: boolean;
  supportsStreaming: boolean;
  localOnly: boolean;
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

export type NativeChatSendResult = {
  userMessage: NativeChatMessage;
  assistantMessage: NativeChatMessage;
  metrics: NativeRequestMetric;
  toolEvents: NativeToolEvent[];
};

export async function nativeProviderCatalog(): Promise<NativeProviderCatalog> {
  return invoke<NativeProviderCatalog>("native_provider_catalog");
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

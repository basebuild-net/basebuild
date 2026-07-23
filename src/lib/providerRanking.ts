import type { NativeProvider } from "./native-chat";

export const LOCAL_PROVIDER_ID = "basebuild-local";

/**
 * Curated popularity order for providers with no per-user recency or global
 * usage signal yet — the ones most people look for first. Real catalog ids.
 * When a global popularity map (aggregated anonymous app usage from
 * basebuild.net) is available it takes precedence over this static list.
 */
export const POPULAR_PROVIDER_IDS = [
  "openai-codex",
  "anthropic",
  "google",
  "openai",
  "xai",
  "deepseek",
  "groq",
  "openrouter",
  "mistral",
  "github-copilot",
] as const;

/** Index of a provider in the curated popular list, or +∞ when absent. */
export function popularRank(id: string): number {
  const index = (POPULAR_PROVIDER_IDS as readonly string[]).indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export type ProviderRankInputs = {
  /** providerId → epoch ms of last use (personal recency). */
  recency?: Record<string, number>;
  /** providerId → global anonymous usage count (from basebuild.net). */
  popularity?: Record<string, number>;
};

/**
 * Ordering for the provider list, shared by the chat picker and Settings:
 * 1. Local ("None") sentinel first.
 * 2. Connected remote providers, most-recently-used first (the user's active
 *    accounts stay on top).
 * 3. Detected local LLM servers (`local-*`): reachable before disconnected.
 * 4. Unconnected remote providers by global usage popularity (desc) when
 *    known, else the curated popular order, else alphabetical.
 *
 * Detected local servers rank ahead of the large unconnected-remote wall so a
 * running LM Studio / Ollama surfaces immediately (issue #48), but behind
 * remote accounts the user actively connected.
 */
export function compareProviders(
  a: NativeProvider,
  b: NativeProvider,
  inputs: ProviderRankInputs = {},
): number {
  const { recency = {}, popularity = {} } = inputs;

  // Coarse tier: sentinel < connected-remote < local-connected <
  // local-disconnected < unconnected-remote.
  const tier = (p: NativeProvider): number => {
    if (p.id === LOCAL_PROVIDER_ID) return 0;
    const isLocal = p.id.startsWith("local-");
    if (p.configured) return isLocal ? 2 : 1;
    return isLocal ? 3 : 4;
  };
  const tierA = tier(a);
  const tierB = tier(b);
  if (tierA !== tierB) return tierA - tierB;

  if (tierA === 1) {
    // Connected remote: most-recently-used first.
    const byRecency = (recency[b.id] ?? 0) - (recency[a.id] ?? 0);
    if (byRecency !== 0) return byRecency;
    return a.label.localeCompare(b.label);
  }

  // Detected local servers: stable alphabetical within their tiers.
  if (tierA === 2 || tierA === 3) return a.label.localeCompare(b.label);

  // Unconnected remote: global popularity first, then curated, then alphabetical.
  const byPopularity = (popularity[b.id] ?? 0) - (popularity[a.id] ?? 0);
  if (byPopularity !== 0) return byPopularity;
  const byCurated = popularRank(a.id) - popularRank(b.id);
  if (byCurated !== 0) return byCurated;
  return a.label.localeCompare(b.label);
}

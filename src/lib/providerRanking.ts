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
  "openai",
  "anthropic",
  "google",
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
 * 1. Local ("None") first.
 * 2. Connected providers next, most-recently-used first.
 * 3. Unconnected providers by global usage popularity (desc) when known,
 *    else the curated popular order, else alphabetical.
 *
 * This is what surfaces OpenAI / Anthropic / Google at the top for a fresh
 * install where nothing is connected yet, instead of an alphabetical wall.
 */
export function compareProviders(
  a: NativeProvider,
  b: NativeProvider,
  inputs: ProviderRankInputs = {},
): number {
  const { recency = {}, popularity = {} } = inputs;

  const localRank = (p: NativeProvider) => (p.id === LOCAL_PROVIDER_ID ? 0 : 1);
  if (localRank(a) !== localRank(b)) return localRank(a) - localRank(b);

  const connRank = (p: NativeProvider) => (p.configured ? 0 : 1);
  if (connRank(a) !== connRank(b)) return connRank(a) - connRank(b);

  if (a.configured && b.configured) {
    const byRecency = (recency[b.id] ?? 0) - (recency[a.id] ?? 0);
    if (byRecency !== 0) return byRecency;
    return a.label.localeCompare(b.label);
  }

  // Unconnected: global popularity first, then curated, then alphabetical.
  const byPopularity = (popularity[b.id] ?? 0) - (popularity[a.id] ?? 0);
  if (byPopularity !== 0) return byPopularity;
  const byCurated = popularRank(a.id) - popularRank(b.id);
  if (byCurated !== 0) return byCurated;
  return a.label.localeCompare(b.label);
}

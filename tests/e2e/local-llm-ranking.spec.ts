import { expect, test } from "@playwright/test";
import { compareProviders, LOCAL_PROVIDER_ID } from "../../src/lib/providerRanking";
import type { NativeProvider } from "../../src/lib/native-chat";

// ─── Unit tests for local-LLM provider ordering (issue #48) ───

function provider(overrides: Partial<NativeProvider> & Pick<NativeProvider, "id" | "label" | "configured">): NativeProvider {
  return {
    status: overrides.configured ? "ready" : "setup_required",
    credentialOwner: "user",
    connectedVia: null,
    localOnly: false,
    detail: "",
    authMethod: "api_key",
    apiKeyUrl: null,
    defaultBaseUrl: null,
    modelCount: 1,
    accountCount: 0,
    oauthCount: 0,
    apiKeyCount: 0,
    aggregateHealth: "healthy",
    lastSyncedAt: null,
    source: "bundled",
    error: null,
    ...overrides,
  };
}

function order(list: NativeProvider[]): string[] {
  return list
    .slice()
    .sort((a, b) => compareProviders(a, b))
    .map((p) => p.id);
}

test.describe("compareProviders — local LLM tiers", () => {
  test("Local Models ranks above unconnected remote providers", () => {
    const sentinel = provider({ id: LOCAL_PROVIDER_ID, label: "None", configured: true, localOnly: true });
    const local = provider({ id: "local-models", label: "Local Models", configured: true });
    const openai = provider({ id: "openai", label: "OpenAI API", configured: false });
    const anthropic = provider({ id: "anthropic", label: "Anthropic", configured: false });

    expect(order([openai, anthropic, local, sentinel])).toEqual([
      LOCAL_PROVIDER_ID,
      "local-models",
      // unconnected remotes follow, curated-popular order (anthropic before openai)
      "anthropic",
      "openai",
    ]);
  });

  test("connected remote provider ranks above Local Models", () => {
    const anthropic = provider({ id: "anthropic", label: "Anthropic", configured: true });
    const local = provider({ id: "local-models", label: "Local Models", configured: true });

    expect(order([local, anthropic])).toEqual(["anthropic", "local-models"]);
  });

  test("connected Local Models ranks above disconnected Local Models (tier tiebreak)", () => {
    const connected = provider({ id: "local-models", label: "Local Models", configured: true });
    const disconnected = provider({ id: "local-other", label: "Local Other", configured: false });

    expect(order([disconnected, connected])).toEqual(["local-models", "local-other"]);
  });

  test("the None sentinel is always first", () => {
    const sentinel = provider({ id: LOCAL_PROVIDER_ID, label: "None", configured: true, localOnly: true });
    const anthropic = provider({ id: "anthropic", label: "Anthropic", configured: true });
    const local = provider({ id: "local-models", label: "Local Models", configured: true });

    expect(order([anthropic, local, sentinel])[0]).toBe(LOCAL_PROVIDER_ID);
  });
});

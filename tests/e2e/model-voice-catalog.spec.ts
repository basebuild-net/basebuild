import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";
import { isSubscriptionOAuthRoute, voiceBillingMismatch } from "../../src/components/panels/chat/chatFormat";
import type { NativeModel, NativeProvider } from "../../src/lib/native-chat";

// ─── Unit: the subscription-versus-API-billing rule ───

function provider(overrides: Partial<NativeProvider> & Pick<NativeProvider, "id" | "label">): NativeProvider {
  return {
    status: "ready",
    credentialOwner: "user",
    configured: true,
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

function model(overrides: Partial<NativeModel> & Pick<NativeModel, "id" | "providerId">): NativeModel {
  return {
    label: overrides.id,
    supportsEffort: false,
    supportsStreaming: true,
    supportsTools: true,
    localOnly: false,
    contextWindow: null,
    maxTokens: null,
    supportsReasoning: false,
    supportedEfforts: [],
    supportsImages: false,
    source: "bundled",
    supportsAudioInput: false,
    supportsAudioOutput: false,
    voice: null,
    ...overrides,
  };
}

const realtimeApiKey = model({
  id: "gpt-realtime-2.1",
  providerId: "openai",
  supportsAudioInput: true,
  supportsAudioOutput: true,
  voice: { level: "realtime", billing: "api_key", bargeIn: true },
});

test.describe("isSubscriptionOAuthRoute", () => {
  test("an OAuth-only provider is a subscription route", () => {
    expect(isSubscriptionOAuthRoute(provider({ id: "openai-codex", label: "OpenAI Codex", authMethod: "oauth" }))).toBe(true);
  });

  test("a signed-in OAuth account is a subscription route even when the provider also takes keys", () => {
    const anthropic = provider({
      id: "anthropic",
      label: "Anthropic",
      authMethod: "oauth",
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
      connectedVia: "oauth",
    });
    expect(isSubscriptionOAuthRoute(anthropic)).toBe(true);
  });

  test("an OAuth-capable provider connected with an API key is not a subscription route", () => {
    const anthropic = provider({
      id: "anthropic",
      label: "Anthropic",
      authMethod: "oauth",
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
      connectedVia: "api",
    });
    expect(isSubscriptionOAuthRoute(anthropic)).toBe(false);
  });

  test("a plain API-key provider is not a subscription route", () => {
    expect(isSubscriptionOAuthRoute(provider({ id: "openai", label: "OpenAI API" }))).toBe(false);
  });
});

test.describe("voiceBillingMismatch", () => {
  test("names the mismatch when an API-billed realtime model sits under a subscription sign-in", () => {
    const xai = provider({ id: "xai", label: "xAI (Grok)", authMethod: "oauth", connectedVia: "oauth" });
    const note = voiceBillingMismatch(model({ ...realtimeApiKey, providerId: "xai" }), xai);
    expect(note).toContain("gpt-realtime-2.1");
    expect(note).toContain("API billing");
    expect(note).toContain("xAI (Grok)");
  });

  test("stays quiet when the provider is billed by API key anyway", () => {
    expect(voiceBillingMismatch(realtimeApiKey, provider({ id: "openai", label: "OpenAI API" }))).toBeNull();
  });

  test("stays quiet for a subscription-billed realtime model", () => {
    const covered = model({
      ...realtimeApiKey,
      voice: { level: "realtime", billing: "subscription" },
    });
    const route = provider({ id: "openai-codex", label: "OpenAI Codex", authMethod: "oauth", connectedVia: "oauth" });
    expect(voiceBillingMismatch(covered, route)).toBeNull();
  });

  test("stays quiet below realtime, where there is no duplex session to pay for", () => {
    const dictation = model({
      ...realtimeApiKey,
      voice: { level: "stt", billing: "api_key" },
    });
    const route = provider({ id: "openai-codex", label: "OpenAI Codex", authMethod: "oauth", connectedVia: "oauth" });
    expect(voiceBillingMismatch(dictation, route)).toBeNull();
  });

  test("stays quiet for a text-only model", () => {
    const route = provider({ id: "openai-codex", label: "OpenAI Codex", authMethod: "oauth", connectedVia: "oauth" });
    expect(voiceBillingMismatch(model({ id: "gpt-5.5", providerId: "openai-codex" }), route)).toBeNull();
  });
});

// ─── UI: voice capability in the provider/model catalog ───

async function openCatalog(page: Page): Promise<void> {
  await ensureChatPanel(page);
  await page.locator(".chat-column-model-chip").first().click();
  await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 10_000 });
}

async function browseProvider(page: Page, label: string): Promise<void> {
  await page.locator(".provider-card", { hasText: label }).first().locator(".provider-card-select").click();
  await expect(page.locator(".provider-catalog-section-heading", { hasText: `${label} models` })).toBeVisible({
    timeout: 5_000,
  });
}

function voiceFilter(page: Page) {
  return page.locator(".provider-model-filters .option-list");
}

test.describe("Provider catalog: voice capability", () => {
  test("a realtime model is badged apart from text-only models and names its billing route", async ({ page }) => {
    await openFixtureProject(page);
    await openCatalog(page);
    await browseProvider(page, "OpenAI API");

    const realtimeRow = page.locator(".provider-model-row", { hasText: "gpt-realtime-2.1" }).first();
    await expect(realtimeRow).toBeVisible({ timeout: 5_000 });

    // Realtime carries the filled treatment reserved for a duplex session.
    const levelBadge = realtimeRow.locator(".provider-capability.is-voice-realtime");
    await expect(levelBadge).toHaveText(/realtime voice/i);
    await expect(levelBadge).toHaveAttribute("title", /barge-in/);

    // The billing truth sits right beside it.
    const billingBadge = realtimeRow.locator(".provider-capability.is-billing-api");
    await expect(billingBadge).toHaveText(/api billing/i);
    await expect(billingBadge).toHaveAttribute("title", /subscription does not cover it/);

    // A text-only sibling in the same list carries neither badge.
    const textRow = page.locator(".provider-model-row", { hasText: "gpt-5.1" }).first();
    await expect(textRow).toBeVisible();
    await expect(textRow.locator(".provider-capability.is-voice")).toHaveCount(0);
    await expect(textRow.locator(".provider-capability.is-billing-api")).toHaveCount(0);
  });

  test("Realtime only narrows the list to the realtime model", async ({ page }) => {
    await openFixtureProject(page);
    await openCatalog(page);
    await browseProvider(page, "OpenAI API");

    await expect(page.locator(".provider-model-row")).toHaveCount(2);

    await voiceFilter(page).getByRole("button", { name: "Realtime only" }).click();

    await expect(page.locator(".provider-model-row")).toHaveCount(1);
    await expect(page.locator(".provider-model-row").first()).toContainText("gpt-realtime-2.1");
  });

  test("Voice capable keeps voice models and drops the rest", async ({ page }) => {
    await openFixtureProject(page);
    await openCatalog(page);
    await browseProvider(page, "OpenAI API");

    await voiceFilter(page).getByRole("button", { name: "Voice capable" }).click();

    await expect(page.locator(".provider-model-row")).toHaveCount(1);
    await expect(page.locator(".provider-model-row").first()).toContainText("gpt-realtime-2.1");
  });

  test("Realtime only under the ChatGPT subscription route names the next step", async ({ page }) => {
    await openFixtureProject(page);
    await openCatalog(page);
    await browseProvider(page, "OpenAI Codex");

    await voiceFilter(page).getByRole("button", { name: "Realtime only" }).click();

    // No realtime model exists on a consumer subscription route. Say so, and
    // say what to do about it, instead of blanking the pane.
    await expect(page.locator(".provider-model-row")).toHaveCount(0);
    const empty = page.locator(".provider-model-empty-state");
    await expect(empty).toBeVisible({ timeout: 5_000 });
    await expect(empty).toContainText("OpenAI Codex");
    await expect(empty).toContainText("pick another provider");

    // The empty state carries its own fix.
    await empty.getByRole("button", { name: "Show all models" }).click();
    await expect(page.locator(".provider-model-row", { hasText: "gpt-5.5" })).toHaveCount(1);
  });

  test("the voice filter survives a provider switch so the empty state's advice works", async ({ page }) => {
    await openFixtureProject(page);
    await openCatalog(page);
    await browseProvider(page, "OpenAI Codex");

    await voiceFilter(page).getByRole("button", { name: "Realtime only" }).click();
    await expect(page.locator(".provider-model-empty-state")).toBeVisible({ timeout: 5_000 });

    await browseProvider(page, "OpenAI API");

    await expect(page.locator(".provider-model-empty-state")).toHaveCount(0);
    await expect(page.locator(".provider-model-row")).toHaveCount(1);
    await expect(page.locator(".provider-model-row").first()).toContainText("gpt-realtime-2.1");
  });
});

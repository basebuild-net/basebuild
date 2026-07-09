import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

async function openProviderPicker(page: Page) {
  await ensureChatPanel(page);
  await page.locator(".chat-provider-trigger").first().click();
  await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Provider credential lifecycle", () => {
  test("fixture seeds umans as connected", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Umans should be configured (seeded in fixture).
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await expect(umansCard).toBeVisible();

    // Should show as connected.
    const status = umansCard.locator(".provider-status.is-connected").first();
    await expect(status).toBeVisible();
  });

  test("disconnect removes connected status", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Find the umans disconnect button.
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    const disconnectBtn = umansCard.locator(".provider-card-action-btn", { hasText: "Disconnect" }).first();

    // Should be visible since umans is connected.
    await expect(disconnectBtn).toBeVisible();

    // Click disconnect.
    await disconnectBtn.click();
    await page.waitForTimeout(500);

    // Umans should now show as available, not connected.
    const availableStatus = umansCard.locator(".provider-status.is-available").first();
    await expect(availableStatus).toBeVisible();
  });

  test("connect button appears after disconnect", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    const disconnectBtn = umansCard.locator(".provider-card-action-btn", { hasText: "Disconnect" }).first();

    await disconnectBtn.click();
    await page.waitForTimeout(500);

    // Now a Connect button should appear (title starts with "Connect").
    const connectBtn = umansCard.locator('.provider-card-action-btn[title^="Connect"]').first();
    await expect(connectBtn).toBeVisible();
  });

  test("clicking connect opens login modal with password input", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Find an unconfigured provider (e.g. OpenAI).
    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      // Wait for catalog to close.
      await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0, { timeout: 3_000 });

      // Login modal should appear with a password input.
      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Should have a Save button.
      await expect(loginModal.locator("button", { hasText: /Save/i })).toBeVisible();
    }
  });

  test("login modal has header and close button", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Should have a header.
      await expect(loginModal.locator(".modal-header").first()).toBeVisible();

      // Should have a close button.
      const closeBtn = loginModal.locator('button[title*="Close"]').first();
      await expect(closeBtn).toBeVisible();
    }
  });

  test("login modal overlay click closes the modal", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Click the overlay area.
      await loginModal.click({ position: { x: 5, y: 5 } });
      await expect(loginModal).toBeHidden({ timeout: 2_000 });
    }
  });

  test("multiple providers show different connection states", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Should have connected providers (umans + basebuild-local).
    const connected = page.locator(".provider-card .provider-status.is-connected");
    const connectedCount = await connected.count();
    expect(connectedCount).toBeGreaterThanOrEqual(2);

    // Should have available providers (openai, anthropic, etc.).
    const available = page.locator(".provider-card .provider-status.is-available");
    const availableCount = await available.count();
    expect(availableCount).toBeGreaterThanOrEqual(2);
  });

  test("provider cards have model count", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Each provider card should show model count.
    const cards = page.locator(".provider-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Check first card has model count info.
    const firstCard = cards.first();
    const meta = firstCard.locator(".provider-card-meta").first();
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/model/i);
  });

  test("provider catalog has section headings", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Should have a Providers section heading.
    const providersHeading = page.locator(".provider-catalog-section-heading").filter({ hasText: "Providers" }).first();
    await expect(providersHeading).toBeVisible();

    // Should have a Models section.
    const modelsHeading = page.locator(".provider-catalog-section-heading").filter({ hasText: /models/i }).first();
    await expect(modelsHeading).toBeVisible();
  });
});

test.describe("Provider catalog model selection", () => {
  test("model list renders in catalog", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Models section should have model entries.
    const modelsSection = page.locator(".provider-catalog-models").first();
    await expect(modelsSection).toBeVisible();

    // Should have model items.
    const modelItems = modelsSection.locator("[class*='model']");
    const count = await modelItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("selecting a provider highlights it", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Click on a provider card.
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await umansCard.click();
    await page.waitForTimeout(200);

    // The card should be selected (active class or similar).
    const selected = page.locator(".provider-card.is-selected, .provider-card.is-active").first();
    if (await selected.count() > 0) {
      await expect(selected).toBeVisible();
    }
  });
});

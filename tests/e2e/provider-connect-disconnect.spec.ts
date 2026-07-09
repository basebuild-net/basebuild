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

test.describe("Provider connect/disconnect via modal", () => {
  test("provider picker modal opens with provider cards", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);
    await expect(page.locator(".provider-card").first()).toBeVisible();
  });

  test("each provider card has a title tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const cards = page.locator(".provider-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const title = await cards.nth(i).getAttribute("title");
      expect(title).toBeTruthy();
    }
  });

  test("disconnect button is present for connected non-local providers", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const disconnectBtns = page.locator(".provider-card-action-btn", { hasText: "Disconnect" });
    const count = await disconnectBtns.count();

    // The fixture seeds umans as connected, so there should be at least one.
    expect(count).toBeGreaterThan(0);

    const firstBtn = disconnectBtns.first();
    const title = await firstBtn.getAttribute("title");
    expect(title).toBeTruthy();
  });

  test("connect/reconnect button is present for non-local providers", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // The button includes an icon + text, so use a flexible matcher.
    // "Connect" for unconfigured providers, "Reconnect" for configured ones.
    const connectBtns = page.locator(".provider-card-action-btn").filter({ hasText: /Connect|Reconnect/ });
    const count = await connectBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking connect opens a login modal", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Click a Connect button on an unconnected provider.
    // Use title^= to distinguish from "Disconnect" buttons.
    const connectBtn = page.locator(".provider-card-action-btn[title^='Connect']").first();
    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      await expect(page.locator(".provider-catalog-overlay").first()).toBeHidden({ timeout: 3_000 });

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });
    }
  });

  test("disconnect then provider shows as not connected", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const disconnectBtn = page.locator(".provider-card-action-btn", { hasText: "Disconnect" }).first();
    expect(await disconnectBtn.count()).toBeGreaterThan(0);

    await disconnectBtn.click();

    // After disconnect, a Connect button should appear for that provider.
    const connectBtn = page.locator(".provider-card-action-btn", { hasText: "Connect" });
    await expect.poll(async () => connectBtn.count(), { timeout: 3_000 }).toBeGreaterThan(0);
  });
});

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

test.describe("Login form is a modal, not inline", () => {
  test("login form renders as a modal-overlay with modal class, not chat-login-form", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Use title^= to match "Connect" but not "Disconnect".
    const connectBtn = page.locator(".provider-card-action-btn[title^='Connect']").first();
    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      await expect(page.locator(".provider-catalog-overlay").first()).toBeHidden({ timeout: 3_000 });

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      await expect(page.locator(".chat-login-form")).toHaveCount(0);
      await expect(loginModal.locator("button", { hasText: /Save key/i })).toBeVisible();
      await expect(loginModal.locator(".modal-header")).toBeVisible();
    }
  });

  test("login modal closes on overlay click", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const connectBtn = page.locator(".provider-card-action-btn[title^='Connect']").first();
    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      await loginModal.click({ position: { x: 5, y: 5 } });
      await expect(loginModal).toBeHidden({ timeout: 2_000 });
    }
  });
});

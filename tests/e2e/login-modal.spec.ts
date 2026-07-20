import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

async function openProviderPicker(page: Page) {
  await ensureChatPanel(page);
  await page.locator(".chat-column-model-chip").first().click();
  await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Login form is a modal, not inline", () => {
  test("login form renders as a modal-overlay with modal class, not chat-login-form", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Use title^= to match "Connect" but not "Disconnect".
    const connectBtn = page.locator(".provider-card[title^='OpenAI API:'] .provider-card-action-btn[title^='Manage']").first();
    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      await expect(page.locator(".provider-catalog-overlay").first()).toBeHidden({ timeout: 3_000 });

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      await expect(page.locator(".chat-login-form")).toHaveCount(0);
      await expect(loginModal.locator("button", { hasText: /Log in with API key/i })).toBeVisible();
      await expect(loginModal.locator(".modal-header")).toBeVisible();
    }
  });

  test("login modal closes on overlay click", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const connectBtn = page.locator(".provider-card[title^='OpenAI API:'] .provider-card-action-btn[title^='Manage']").first();
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

  test("login modal back button returns to the provider catalog", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const connectBtn = page.locator(".provider-card[title^='Anthropic:'] .provider-card-action-btn[title^='Manage']").first();
    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("button[title='Back to the provider & model catalog']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });
      await expect(loginModal.locator("button", { hasText: /Log in to Anthropic/i })).toBeVisible();
      await expect(loginModal.locator("button[title='Open the Anthropic API key page in your browser']")).toBeVisible();

      await loginModal.locator("button[title='Back to the provider & model catalog']").click();
      await expect(loginModal).toBeHidden({ timeout: 2_000 });
      await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 3_000 });
    }
  });
});

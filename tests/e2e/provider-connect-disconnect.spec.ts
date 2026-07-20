import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

async function openProviderPicker(page: Page) {
  await ensureChatPanel(page);
  await page.locator(".chat-column-model-chip").first().click();
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
    const titles = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("title")));
    expect(titles.length).toBeGreaterThan(0);
    titles.forEach((title) => {
      expect(title).toBeTruthy();
    });
  });

  test("Manage button is present for connected non-local providers", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const disconnectBtns = page.locator(".provider-card-action-btn", { hasText: "Manage" });
    const count = await disconnectBtns.count();

    // The fixture seeds umans as connected, so there should be at least one.
    expect(count).toBeGreaterThan(0);

    const firstBtn = disconnectBtns.first();
    const title = await firstBtn.getAttribute("title");
    expect(title).toBeTruthy();
  });

  test("Manage button is present for all non-local providers", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // All non-local provider cards now show a single Manage button.
    const manageBtns = page.locator(".provider-card-action-btn").filter({ hasText: /Manage/ });
    const count = await manageBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking Manage opens a login/manage modal", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const manageBtn = page.locator(".provider-card[title^='OpenAI API:'] .provider-card-action-btn[title^='Manage']").first();
    if (await manageBtn.count() > 0) {
      await manageBtn.click();

      await expect(page.locator(".provider-catalog-overlay").first()).toBeHidden({ timeout: 3_000 });

      const manageModal = page.locator(".modal-overlay").filter({
        has: page.locator("h2", { hasText: "Manage" }),
      });
      await expect(manageModal).toBeVisible({ timeout: 3_000 });
    }
  });

  test("log out from manage modal then provider shows as not connected", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const manageBtn = page.locator(".provider-card-action-btn", { hasText: "Manage" }).first();
    expect(await manageBtn.count()).toBeGreaterThan(0);
    await manageBtn.click();
    await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0, { timeout: 3_000 });

    // Log out from the manage modal.
    const manageModal = page.locator(".modal-overlay").filter({ has: page.locator("h2", { hasText: "Manage" }) }).first();
    const logoutBtn = manageModal.locator(".provider-account-actions button", { hasText: "Log out" }).first();
    if (await logoutBtn.count() > 0) {
      await logoutBtn.click();
      const confirm = page.locator(".modal-overlay").filter({ has: page.locator(".confirm-dialog-modal") });
      await confirm.getByRole("button", { name: "Log out" }).click();
      // After logout, the account row disappears from the manage modal.
      await expect(manageModal.locator(".provider-account-row")).toHaveCount(0, { timeout: 5_000 });
      await expect(manageModal.getByText(/No account connected yet/)).toBeVisible();
    }
  });
});

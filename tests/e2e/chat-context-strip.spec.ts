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

test.describe("Compact chat header context", () => {
  test("header renders model, run state, permissions, and context usage", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".chat-column-model-chip").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-header-run-state").first()).toContainText("idle");
    await expect(page.locator(".chat-header-select[aria-label='Permission mode']").first()).toBeVisible();
    const context = page.locator(".chat-header-context").first();
    await expect(context).toBeVisible();
    await expect(context).toHaveAttribute("title", /Context usage: 0 .*tokens/);
  });

  test("header context controls have title tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    for (const control of [
      page.locator(".chat-column-model-chip").first(),
      page.locator(".chat-header-run-state").first(),
      page.locator(".chat-header-context").first(),
      page.locator(".chat-header-select[aria-label='Permission mode']").first(),
    ]) {
      await expect(control).toHaveAttribute("title", /.+/);
    }
  });
});

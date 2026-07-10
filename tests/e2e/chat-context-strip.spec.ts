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

test.describe("Chat context strip", () => {
  test("context strip renders under the composer with model and run state", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Context strip should be visible under the input.
    const strip = page.locator(".chat-context-strip").first();
    await expect(strip).toBeVisible({ timeout: 5_000 });

    // Run state should show "idle" (no active run).
    await expect(strip.locator(".chat-context-run-state", { hasText: "idle" })).toBeVisible();

    // Model chip should be present.
    await expect(strip.locator(".chat-context-chip-label", { hasText: "model" })).toBeVisible();
  });

  test("context strip chips have title tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const chips = page.locator(".chat-context-chip").first();
    const count = await chips.count();
    // At least the model chip should be present.
    expect(count).toBeGreaterThan(0);

    // Each chip must have a title attribute.
    for (let i = 0; i < count; i++) {
      const title = await chips.nth(i).getAttribute("title");
      expect(title).toBeTruthy();
    }
  });
});

import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name", { hasText: "project" }),
  ).toBeVisible();
}

test.describe("Chat context strip", () => {
  test("context strip renders under the composer with model and run state", async ({ page }) => {
    await openFixtureProject(page);

    // Create a new chat panel.
    await page.getByRole("button", { name: /New chat/i }).first().click();
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    // Context strip should be visible under the input.
    const strip = page.locator(".chat-context-strip");
    await expect(strip).toBeVisible({ timeout: 5_000 });

    // Run state should show "idle" (no active run).
    await expect(strip.locator(".chat-context-run-state", { hasText: "idle" })).toBeVisible();

    // Model chip should be present.
    await expect(strip.locator(".chat-context-chip-label", { hasText: "model" })).toBeVisible();
  });

  test("context strip chips have title tooltips", async ({ page }) => {
    await openFixtureProject(page);

    await page.getByRole("button", { name: /New chat/i }).first().click();
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    const chips = page.locator(".chat-context-chip");
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

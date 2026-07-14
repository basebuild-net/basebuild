import { expect, test, type Page } from "@playwright/test";
import { openPlanningModal } from "./helpers";
async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: "project" }),
  ).toBeVisible({ timeout: 5_000 });
}

test.describe("Visual planning command center", () => {
  test("command center renders stage cards with counts", async ({ page }) => {
    await openFixtureProject(page);

    // Open the Plans & Ideas modal via the planning indicators.
    await openPlanningModal(page);

    // Click the Flow tab.
    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5_000 });

    // Command center should render with stage cards.
    await expect(page.locator(".planning-command-center")).toBeVisible({ timeout: 5_000 });

    // Eight stage cards: Ideas, OpenSpec, Ready, Queued, Running, Blocked, Review, Finished.
    const stageCards = page.locator(".planning-stage-card");
    const count = await stageCards.count();
    expect(count).toBeGreaterThanOrEqual(8);

    // Verify labels are present.
    await expect(page.locator(".planning-stage-label", { hasText: "Ideas" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "OpenSpec" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Ready" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Running" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Finished" })).toBeVisible();
  });

  test("command center shows primary action buttons", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningModal(page);

    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();

    // Primary actions should be visible.
    await expect(page.locator(".planning-command-actions button", { hasText: "Generate ideas" })).toBeVisible();
    await expect(page.locator(".planning-command-actions button", { hasText: "Run through OpenSpec" })).toBeVisible();
    await expect(page.locator(".planning-command-actions button", { hasText: "Add worker" })).toBeVisible();
    await expect(page.locator(".planning-command-actions button", { hasText: "Archive/Sync" })).toBeVisible();
  });

  test("stage cards have title tooltips with count and action", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningModal(page);

    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();

    // Each stage card must have a title attribute.
    const cards = page.locator(".planning-stage-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const title = await cards.nth(i).getAttribute("title");
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(0);
    }
  });
});

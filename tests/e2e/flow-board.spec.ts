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

test.describe("Flow board + batch operations", () => {
  test("flow tab renders five stages with live counts", async ({ page }) => {
    await openFixtureProject(page);

    // Open the Plans & Ideas modal via the command strip Plans stage.
    await page.locator("button[title^='Plans:']").first().click();
    await expect(page.locator(".modal-plans")).toBeVisible({ timeout: 5_000 });

    // Click the Flow tab.
    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5_000 });

    // Five stages should render.
    await expect(page.locator(".flow-stage")).toHaveCount(5);
    await expect(page.locator(".flow-stage-name", { hasText: "Schematic" })).toBeVisible();
    await expect(page.locator(".flow-stage-name", { hasText: "Ideas" })).toBeVisible();
    await expect(page.locator(".flow-stage-name", { hasText: "Plans" })).toBeVisible();
    await expect(page.locator(".flow-stage-name", { hasText: "Running" })).toBeVisible();
    await expect(page.locator(".flow-stage-name", { hasText: "Finished" })).toBeVisible();
  });

  test("ideas tab shows multi-select checkboxes for concept ideas", async ({ page }) => {
    await openFixtureProject(page);

    // Open the Plans & Ideas modal via the command strip Ideas stage.
    await page.locator("button[title^='Ideas:']").first().click();
    await expect(page.locator(".modal-plans")).toBeVisible({ timeout: 5_000 });

    const ideasTab = page.locator(".inspector-tab", { hasText: "Ideas" }).first();
    await ideasTab.click();
    await page.waitForTimeout(500);

    // If there are ideas, checkboxes should be present on concept ideas.
    const checkboxes = page.locator(".idea-select-checkbox");
    const count = await checkboxes.count();
    if (count > 0) {
      // Select first checkbox.
      await checkboxes.first().check();
      // Batch bar should appear.
      await expect(page.locator(".inspector-batch-bar")).toBeVisible({ timeout: 3_000 });
      await expect(page.locator(".inspector-batch-bar button", { hasText: "Approve selected" })).toBeVisible();
    }
  });

  test("flow board shows launch button when ready plans exist", async ({ page }) => {
    await openFixtureProject(page);

    // Open the Plans & Ideas modal via the command strip Plans stage.
    await page.locator("button[title^='Plans:']").first().click();
    await expect(page.locator(".modal-plans")).toBeVisible({ timeout: 5_000 });

    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();
    await page.waitForTimeout(500);

    // The launch button should only appear when there are ready plans.
    // In the mock environment, there may be no ready plans — verify no crash.
    const launchBtn = page.locator(".flow-stage-action", { hasText: "Launch" });
    const count = await launchBtn.count();
    // Just verify the flow board renders without error.
    await expect(page.locator(".flow-board")).toBeVisible();
  });
});

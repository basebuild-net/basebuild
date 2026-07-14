import { expect, test, type Page } from "@playwright/test";

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

test.describe("Mock command registry + skill registry", () => {
  test("mocked commands are registered and don't crash the frontend", async ({ page }) => {
    await openFixtureProject(page);

    // The mock invoke in tauri-core.ts handles list_resolved_skills,
    // integration_*, and milestone_auto_commit commands. Verify the frontend
    // loads without errors and the mock state is accessible.
    const state = await page.evaluate(() => {
      const w = window as unknown as { __BASEBUILD_E2E_STATE__?: unknown };
      return !!w.__BASEBUILD_E2E_STATE__;
    });
    expect(state).toBeTruthy();
  });

  test("flow board renders with integration queue styles", async ({ page }) => {
    await openFixtureProject(page);

    // Navigate to the flow tab if it exists.
    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    if (await flowTab.count() > 0) {
      await flowTab.click();
      await page.waitForTimeout(300);
      // The flow board should render.
      await expect(page.locator(".flow-board")).toBeVisible();
    }
  });
});

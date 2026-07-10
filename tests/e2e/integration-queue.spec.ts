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

test.describe("Integration queue + milestone auto-commit", () => {
  test("frontend loads with integration queue commands mocked", async ({ page }) => {
    await openFixtureProject(page);

    // The mock invoke in tauri-core.ts handles integration_list,
    // integration_cleanup, get/set_milestone_auto_commit. Verify the
    // frontend loads without errors.
    const state = await page.evaluate(() => {
      const w = window as unknown as { __BASEBUILD_E2E_STATE__?: unknown };
      return !!w.__BASEBUILD_E2E_STATE__;
    });
    expect(state).toBeTruthy();
  });
});

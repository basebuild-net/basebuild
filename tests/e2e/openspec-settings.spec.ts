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

test.describe("Settings → OpenSpec runtime tab", () => {
  test("OpenSpec tab is visible in settings sidebar", async ({ page }) => {
    await openFixtureProject(page);

    // Open Settings.
    await page.getByRole("button", { name: /Settings/i }).first().click();
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 5_000 });

    // OpenSpec tab should be in the settings sidebar.
    await expect(page.locator(".settings-tab", { hasText: "OpenSpec" })).toBeVisible();
  });

  test("OpenSpec tab shows runtime status and refresh button", async ({ page }) => {
    await openFixtureProject(page);

    await page.getByRole("button", { name: /Settings/i }).first().click();
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 5_000 });

    // Click the OpenSpec tab.
    await page.locator(".settings-tab", { hasText: "OpenSpec" }).click();

    // The runtime status section should render.
    await expect(page.locator(".requirement-name", { hasText: /OpenSpec:/ })).toBeVisible({ timeout: 5_000 });

    // Refresh button should be present.
    await expect(page.locator("button", { hasText: "Refresh" })).toBeVisible();

    // Version and Schema detail cells should render.
    await expect(page.locator(".update-version-cell").first()).toBeVisible();
  });
});

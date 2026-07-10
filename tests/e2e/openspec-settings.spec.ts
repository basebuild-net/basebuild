import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openSettings(page) {
  // The MVP fixture has an authenticated account. Open the account dropdown
  // and click the Settings item inside it.
  const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
  await expect(accountBtn).toBeVisible({ timeout: 10_000 });
  await accountBtn.click({ timeout: 10_000 });
  const settingsItem = page.locator('button[title="Open settings"]').first();
  await expect(settingsItem).toBeVisible({ timeout: 5_000 });
  await settingsItem.click({ timeout: 5_000 });
}

test.describe("Settings → OpenSpec runtime tab", () => {
  test("OpenSpec tab is visible in settings sidebar", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await openSettings(page);
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });

    // OpenSpec tab should be in the settings sidebar.
    await expect(page.locator(".settings-tab", { hasText: "OpenSpec" })).toBeVisible();
  });

  test("OpenSpec tab shows runtime status and refresh button", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await openSettings(page);
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });

    // Click the OpenSpec tab.
    await page.locator(".settings-tab", { hasText: "OpenSpec" }).click();

    // The runtime status section should render.
    await expect(page.locator(".requirement-name", { hasText: /OpenSpec:/ })).toBeVisible({ timeout: 5_000 });

    // Refresh button should be present.
    await expect(page.locator("button", { hasText: "Refresh" }).first()).toBeVisible();

    // Version and Schema detail cells should render.
    await expect(page.locator(".update-version-cell").first()).toBeVisible();
  });
});

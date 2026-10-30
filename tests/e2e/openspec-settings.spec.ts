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

async function openOpenSpecTab(page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
  await openSettings(page);
  await page.locator(".settings-tab", { hasText: "OpenSpec" }).click();
}

test.describe("Settings → OpenSpec install and update", () => {
  test("install asks first, streams npm output, then reports ready", async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as typeof globalThis & { __BASEBUILD_E2E_OPENSPEC_MISSING__?: boolean }).__BASEBUILD_E2E_OPENSPEC_MISSING__ = true;
    });
    await openOpenSpecTab(page);

    await expect(page.locator('[title="OpenSpec runtime: missing"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button[title="Install OpenSpec from npm (asks for confirmation first)"]')).toBeEnabled();
    await expect(page.locator('button[title="Install OpenSpec before updating it"]')).toBeDisabled();

    await page.locator('button[title="Install OpenSpec from npm (asks for confirmation first)"]').click();
    const dialog = page.locator('[role="dialog"][aria-label="Install OpenSpec?"]');
    await expect(dialog).toContainText("npm install -g @fission-ai/openspec@latest");
    await dialog.locator('button[title="Install"]').click();

    const log = page.locator(".openspec-progress-log");
    await expect(log).toContainText("npm install -g @fission-ai/openspec@latest", { timeout: 5_000 });
    await expect(log).toContainText("added 1 package in 2s", { timeout: 5_000 });
    await expect(page.locator('[title="OpenSpec runtime: ready"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button[title="OpenSpec is already installed. Use Update to get the latest release."]')).toBeDisabled();
    await expect(page.locator('button[title="Update OpenSpec to the latest npm release (asks for confirmation first)"]')).toBeEnabled();
  });

  test("a missing npm surfaces as an action error, not a silent failure", async ({ page }) => {
    await page.addInitScript(() => {
      const flags = globalThis as typeof globalThis & {
        __BASEBUILD_E2E_OPENSPEC_MISSING__?: boolean;
        __BASEBUILD_E2E_OPENSPEC_NO_NPM__?: boolean;
      };
      flags.__BASEBUILD_E2E_OPENSPEC_MISSING__ = true;
      flags.__BASEBUILD_E2E_OPENSPEC_NO_NPM__ = true;
    });
    await openOpenSpecTab(page);

    await page.locator('button[title="Install OpenSpec from npm (asks for confirmation first)"]').click();
    const dialog = page.locator('[role="dialog"][aria-label="Install OpenSpec?"]');
    await dialog.locator('button[title="Install"]').click();

    const actionError = page.locator('[title="Action error"]');
    await expect(actionError).toContainText("npm was not found on PATH", { timeout: 5_000 });
    await expect(page.locator('[title="OpenSpec runtime: missing"]')).toBeVisible();
  });
});

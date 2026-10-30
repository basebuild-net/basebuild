import { expect, test } from "@playwright/test";

test.describe("Windows startup settings", () => {
  test("first-run setup shows launch-at-sign-in default on", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });

    await page.goto("/");

    // Wait for the first-run modal to appear
    const modal = page.locator(".modal-first-run");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Theme is the first decision and dark mode is presented first.
    const themeButtons = modal.locator(".first-run-theme");
    await expect(themeButtons).toHaveCount(2);
    await expect(themeButtons.first()).toContainText("Dark");
    await page.getByTitle("Use dark mode").click();

    // Launch-at-sign-in lives on the same welcome sheet, checked by default.
    const checkbox = page.getByTitle("Launch at Windows sign-in");
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).toBeChecked();
  });

  test("first-run skip does not register autostart", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("basebuild:first-run-complete"));
    await page.reload();
    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    await page.getByTitle("Skip setup").click();
    await expect(modal).not.toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem("basebuild:first-run-complete"))).toBe("true");
    await page.reload();
    await expect(modal).not.toBeVisible({ timeout: 10_000 });
  });

  test("finishing first-run setup persists across restart", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("basebuild:first-run-complete"));
    await page.reload();

    await page.getByTitle("Use dark mode").click();
    await page.getByTitle("Get started").click();

    const modal = page.locator(".modal-first-run");
    await expect(modal).not.toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem("basebuild:first-run-complete"))).toBe("true");
    await page.reload();
    await expect(modal).not.toBeVisible({ timeout: 10_000 });
  });

  test("settings shows Windows startup control with effective state", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });

    await page.goto("/");

    // Signed-out users see an honest Settings action.
    await page.getByTitle("Open Settings").click();

    // The Updates tab should be active by default and show the Windows Startup section
    await expect(page.getByText("Windows Startup")).toBeVisible({ timeout: 10_000 });

    // The launch-at-sign-in checkbox should be visible
    const checkbox = page.getByTitle("Launch Basebuild at Windows sign-in (minimized to tray)");
    await expect(checkbox).toBeVisible();

    // The effective state text should be visible
    await expect(page.getByText(/Effective state:/)).toBeVisible();
  });

  test("settings toggle updates desired state", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });

    await page.goto("/");

    await page.getByTitle("Open Settings").click();

    const checkbox = page.getByTitle("Launch Basebuild at Windows sign-in (minimized to tray)");
    await expect(checkbox).toBeVisible({ timeout: 10_000 });

    // Enable it
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // The effective state should update to enabled
    await expect(page.getByText(/Effective state: enabled/)).toBeVisible();

    // Disable it
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByText(/Effective state: disabled/)).toBeVisible();
  });

  test("settings shows startup control on supported platform", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });

    await page.goto("/");

    await page.getByTitle("Open Settings").click();

    // The Windows Startup section should be visible with the checkbox
    await expect(page.getByText("Windows Startup")).toBeVisible({ timeout: 10_000 });
    const checkbox = page.getByTitle("Launch Basebuild at Windows sign-in (minimized to tray)");
    await expect(checkbox).toBeVisible();
  });
});

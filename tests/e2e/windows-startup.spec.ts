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

    // Click "Get started" to advance past welcome
    await page.getByTitle("Start setup").click();

    // Wait for adapter step and advance through it
    await page.getByTitle("Continue to terminal setup").click();

    // Wait for terminal step and advance to startup step
    await page.getByTitle("Continue to Windows startup setup").click();

    // The startup step should show the launch-at-sign-in checkbox, checked by default
    const checkbox = page.getByTitle("Launch Basebuild at Windows sign-in (minimized to tray)");
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).toBeChecked();
  });

  test("first-run skip does not register autostart", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });

    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Skip setup entirely
    await page.getByTitle("Skip setup").click();

    // The modal should be gone — no registration was applied
    await expect(modal).not.toBeVisible({ timeout: 10_000 });
  });

  test("settings shows Windows startup control with effective state", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });

    await page.goto("/");

    // Open Settings — when not signed in, the "Sign in" button opens settings
    await page.getByTitle("Sign in to your account").click();

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

    await page.getByTitle("Sign in to your account").click();

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

    await page.getByTitle("Sign in to your account").click();

    // The Windows Startup section should be visible with the checkbox
    await expect(page.getByText("Windows Startup")).toBeVisible({ timeout: 10_000 });
    const checkbox = page.getByTitle("Launch Basebuild at Windows sign-in (minimized to tray)");
    await expect(checkbox).toBeVisible();
  });
});

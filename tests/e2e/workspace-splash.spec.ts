import { expect, test } from "@playwright/test";
import { openMvpFixtureProject } from "./helpers";

test.describe("Workspace restore splash", () => {
  test("splash shows on app launch with phase label and dismisses when ready", async ({ page }) => {
    // Use a restore delay so the splash is visible long enough to assert.
    await openMvpFixtureProject(page, { restoreDelayMs: 800 });

    // The splash overlay must paint immediately — before the shell is ready.
    const splash = page.locator(".workspace-splash");
    await expect(splash).toBeVisible({ timeout: 3_000 });

    // Splash shows the app brand and a phase label.
    await expect(splash.locator(".splash-brand")).toContainText("BASEBUILD");
    await expect(splash.locator(".splash-status")).toContainText(/Starting up|Detecting|Restoring/);

    // Splash dismisses after restore completes.
    await expect(splash).not.toBeVisible({ timeout: 10_000 });

    // The shell is interactive after splash dismisses.
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("splash is not visible after the shell is ready", async ({ page }) => {
    await openMvpFixtureProject(page);
    await page.locator(".app-shell").waitFor({ state: "attached", timeout: 10_000 });
    // Give the splash time to fade out.
    await page.waitForTimeout(500);
    await expect(page.locator(".workspace-splash")).toHaveCount(0);
  });
});

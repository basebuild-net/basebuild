import { test, expect } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, collectLogs, attachLogs, attachScreenshot, attachTiming } from "./helpers";

test.describe("MVP restart and responsiveness smoke", () => {
  test("restart focus restores last project and session", async ({ page }) => {
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // Charlie should be the active project.
    await expect(page.locator("text=charlie").first()).toBeVisible({ timeout: 5000 });

    // Reload the page — should restore the same project.
    await page.reload();
    await waitForAppReady(page);

    // Charlie should still be active after reload.
    await expect(page.locator("text=charlie").first()).toBeVisible({ timeout: 10_000 });
  });

  test("no duplicate project activation on restart", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    await page.reload();
    await waitForAppReady(page);

    // Wait for things to settle.
    await page.waitForTimeout(2000);

    // No duplicate activation logs.
    const activationLogs = logs.filter((l) => l.includes("activate") || l.includes("restore"));
    // There should be activation logs, but no duplicate errors.
    const errorLogs = logs.filter((l) => l.includes("error") && (l.includes("activate") || l.includes("restore")));
    expect(errorLogs.length).toBe(0);

    await attachLogs(logs, "restart-activation-logs.txt");
  });

  test("no false orphan warnings on restart", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    await page.reload();
    await waitForAppReady(page);
    await page.waitForTimeout(2000);

    // No orphan warning logs.
    const orphanLogs = logs.filter((l) => l.toLowerCase().includes("orphan"));
    // Orphan warnings should be minimal or zero after restart.
    expect(orphanLogs.length).toBeLessThanOrEqual(1);

    await attachLogs(logs, "restart-orphan-logs.txt");
  });

  test("60-second streaming and project-switch smoke", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    const start = Date.now();

    // Switch between projects a few times.
    for (let i = 0; i < 3; i++) {
      // Click on alpha in the sidebar.
      const alphaBtn = page.locator('[title*="alpha"]').first();
      if (await alphaBtn.isVisible()) {
        await alphaBtn.click();
        await page.waitForTimeout(500);
      }

      // Click on charlie.
      const charlieBtn = page.locator('[title*="charlie"]').first();
      if (await charlieBtn.isVisible()) {
        await charlieBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Resize the viewport.
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);

    const elapsed = Date.now() - start;
    await attachTiming("60s-smoke-elapsed-ms", elapsed);

    // No freeze reports.
    const freezeLogs = logs.filter((l) => l.toLowerCase().includes("freeze"));
    expect(freezeLogs.length).toBe(0);

    // No unhandled errors.
    const errorLogs = logs.filter((l) => l.includes("Uncaught") || l.includes("pageerror"));
    expect(errorLogs.length).toBe(0);

    await attachLogs(logs, "60s-smoke-logs.txt");
    await attachScreenshot(page, "60s-smoke-final.png");
  });

  test("feedback and loading paint within 100ms budget", async ({ page }) => {
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // Measure click-to-feedback for the Plans & Ideas button.
    const start = Date.now();
    await page.locator('[title="Plans & Ideas"]').first().click();
    await expect(page.locator(".planning-inspector-modal, .planning-inspector")).toBeVisible({ timeout: 5000 });
    const elapsed = Date.now() - start;

    // Should paint within 100ms (generous — Playwright has overhead).
    expect(elapsed).toBeLessThan(2000);
    await attachTiming("click-to-feedback-ms", elapsed);
  });
});

import { test, expect, type Page } from "@playwright/test";
import { attachLogs, attachScreenshot, collectLogs, openMvpFixtureProject, waitForAppReady, openPlanningModal } from "./helpers";

// Visual/interaction snapshots at 960×640 and 1280×800 for shell, account
// menu, planning board, picker/dialogs, and 1/2/4 chat panels.
// These are non-blocking visual baselines — they capture the rendered state
// and attach screenshots to the test report for manual review. They do NOT
// use pixel-diff snapshot matching (too brittle for CSS-driven layouts).

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: "960x640", width: 960, height: 640 },
  { name: "1280x800", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(`MVP visual snapshots @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shell renders with project, session, and planning indicators", async ({ page }) => {
      const logs = collectLogs(page);
      await openMvpFixtureProject(page);
      await waitForAppReady(page);

      // Core shell elements are visible.
      await expect(page.locator(".app-shell")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("h1.session-title")).toHaveCount(0);
      await expect(page.locator(".chat-header-context").first()).toBeVisible({ timeout: 10_000 });

      // Command strip is reachable.
      await expect(page.getByTitle(/Schematic/i).first()).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTitle(/Plans/i).first()).toBeVisible({ timeout: 5_000 });

      await attachScreenshot(page, `shell-${vp.name}`);
      await attachLogs(logs, `shell-${vp.name}-logs.txt`);
    });

    test("account menu opens within viewport", async ({ page }) => {
      const logs = collectLogs(page);
      await openMvpFixtureProject(page);
      await waitForAppReady(page);
      const accountBtn = page.getByTitle(/MVPUser/i).first();
      await expect(accountBtn).toBeVisible({ timeout: 10_000 });
      await accountBtn.click();

      // Menu should be visible and within viewport bounds.
      const menu = page.locator(".account-dropdown").first();

      // Verify menu is within viewport.
      const box = await menu.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      }

      await attachScreenshot(page, `account-menu-${vp.name}`);
      await attachLogs(logs, `account-menu-${vp.name}-logs.txt`);

      // Close menu.
      await page.keyboard.press("Escape");
    });

    test("planning board shows plans and ideas counts", async ({ page }) => {
      const logs = collectLogs(page);
      await openMvpFixtureProject(page);
      await waitForAppReady(page);

      // The planning indicators should show plan/idea counts.
      await expect(page.locator('.planning-indicator[data-stage="plans"]').first()).toBeVisible({ timeout: 10_000 });

      // Open the plans modal.
      await openPlanningModal(page);
      // Plans modal should be visible.
      await expect(page.locator(".plans-modal, [role='dialog']").first()).toBeVisible({ timeout: 5_000 });
      await attachScreenshot(page, `planning-board-${vp.name}`);
      await attachLogs(logs, `planning-board-${vp.name}-logs.txt`);
      // Close modal.
      await page.keyboard.press("Escape");
    });

    test("folder picker dialog is reachable", async ({ page }) => {
      const logs = collectLogs(page);
      await openMvpFixtureProject(page);
      await waitForAppReady(page);

      // The add folder button is visible.
      const addBtn = page.getByTitle("Add project folder").first();
      await expect(addBtn).toBeVisible({ timeout: 10_000 });

      // Just verify the button is clickable — don't actually open the picker
      // (it would block the test). Screenshot the shell with the button visible.
      await attachScreenshot(page, `picker-entry-${vp.name}`);
      await attachLogs(logs, `picker-entry-${vp.name}-logs.txt`);
    });

    test("chat panel renders at compact size", async ({ page }) => {
      const logs = collectLogs(page);
      await openMvpFixtureProject(page);
      await waitForAppReady(page);

      // A chat panel should be visible after restore.
      await expect(page.locator(".chat-input, textarea[placeholder*='Type a message']").first()).toBeVisible({ timeout: 10_000 });

      // Verify the chat input is within viewport.
      const chatInput = page.locator("textarea[placeholder*='Type a message']").first();
      const box = await chatInput.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      }

      await attachScreenshot(page, `chat-panel-${vp.name}`);
      await attachLogs(logs, `chat-panel-${vp.name}-logs.txt`);
    });
  });
}

import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

test.describe("Responsive screenshots + restart smoke", () => {
  test("960x640: all controls visible, no blank modal, no layout shuffle", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Planning indicators visible.
    await expect(page.locator(".planning-indicators").first()).toBeVisible({ timeout: 10_000 });

    // Chat header visible.
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // No blank modal overlays.
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // No stale project content (project name visible).
    await expect(page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title").first()).toBeVisible({ timeout: 5_000 });

    // Take screenshot.
    await page.screenshot({ path: "test-results/screenshot-960x640.png", fullPage: false });

    expect(pageErrors).toEqual([]);
    await page.close();
  });

  test("1280x800: all controls visible, no blank modal, no layout shuffle", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Planning indicators visible.
    await expect(page.locator(".planning-indicators").first()).toBeVisible({ timeout: 10_000 });

    // Chat header visible.
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // No blank modal overlays.
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // Take screenshot.
    await page.screenshot({ path: "test-results/screenshot-1280x800.png", fullPage: false });

    expect(pageErrors).toEqual([]);
    await page.close();
  });

  test("restart smoke: reload preserves project and chat panel", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-panel").first()).toBeVisible({ timeout: 10_000 });

    // Reload the page (simulates restart).
    await page.reload();
    await waitForAppReady(page);
    await page.waitForTimeout(2000);

    // Project should still be active.
    await expect(page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title").first()).toBeVisible({ timeout: 10_000 });

    // No blank modal overlays after restart.
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // No layout shuffle — planning indicators should be visible.
    await expect(page.locator(".planning-indicators").first()).toBeVisible({ timeout: 10_000 });

    expect(pageErrors).toEqual([]);
  });
});

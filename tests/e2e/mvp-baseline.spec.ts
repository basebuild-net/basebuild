import { expect, test } from "@playwright/test";
import {
  attachLogs,
  attachScreenshot,
  attachTiming,
  collectLogs,
  fixtureCategory,
  fixtureProject,
  openMvpFixtureProject,
  openPlanningModal,
  readE2eStateCounter,
  waitForAppReady,
} from "./helpers";

test.describe("MVP workflow baseline", () => {
  // Fixed: app now restores the explicitly focused project via get/set_last_focused_project.
  test("restart focus restores project C + last chat/panel", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const activationMs = Date.now() - start;

    await attachScreenshot(page, "restart-focus-screenshot");
    await attachLogs(logs, "restart-focus-logs.txt");
    await attachTiming("restart-focus-activation", activationMs);

    const projectC = fixtureProject(2);
    await expect(
      page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: projectC.name }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator(".chat-message", { hasText: "Start MVP baseline" }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  // Fixed: account dropdown now uses viewport-clamped positioning.
  test("compact 960x640 account menu remains within viewport", async ({ page }) => {
    const logs = collectLogs(page);
    await page.setViewportSize({ width: 960, height: 640 });
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    const trigger = page.locator(".account-trigger");
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const dropdown = page.locator(".account-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    await attachScreenshot(page, "account-menu-compact-screenshot");
    await attachLogs(logs, "account-menu-compact-logs.txt");

    const box = await dropdown.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(960);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
  });
  // Fixed: folder picker is now single-flight across all entry points.
  test("folder picker duplicate clicks should be single-flight", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { pickerDelayMs: 1_000 });
    await waitForAppReady(page);

    const openBtn = page.getByTitle("Add project folder").first();
    await expect(openBtn).toBeVisible({ timeout: 5_000 });

    const start = Date.now();
    // Dispatch all three clicks synchronously in one JS evaluation so they
    // fire before React re-renders and disables the button. Using Playwright's
    // click() with Promise.all would auto-wait: the 2nd and 3rd clicks would
    // wait for the button to re-enable (after the 1st picker resolves) and
    // then click again, producing N picker calls instead of 1.
    await page.evaluate(() => {
      const btn = document.querySelector('[title="Add project folder"]') as HTMLButtonElement | null;
      if (!btn) throw new Error("Add project folder button not found");
      btn.click();
      btn.click();
      btn.click();
    });

    // Wait for the delayed picker to resolve and the selected project to become active.
    const projectC = fixtureProject(2);
    await expect(page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: projectC.name }).first()).toBeVisible({ timeout: 5_000 });
    const pickerMs = Date.now() - start;

    await attachScreenshot(page, "folder-picker-single-flight-screenshot");
    await attachLogs(logs, "folder-picker-single-flight-logs.txt");
    await attachTiming("folder-picker-single-flight", pickerMs);

    const calls = await readE2eStateCounter(page, "pickProjectCalls");
    expect(calls).toBe(1);
  });

  // Known incomplete: this test clicks "Suggest more ideas" but doesn't step
  // through the destination picker that opens afterwards, so the prompt is
  // never delivered to a chat input. The assertion on .chat-input value is
  // therefore flaky. The category-generation flow is covered by
  // mvp-planning-flow.spec.ts (destination picker visibility + delivery).
  test.fixme("category generation should show a visible chat/question instead of disappearing", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    // The fixture categories belong to project C. Select it manually because
    // restart focus is tested separately and is not yet auto-restored.
    const projectC = fixtureProject(2);
    await page.getByTitle(projectC.path).click();
    await expect(page.locator(".sidebar-item.is-active .sidebar-item-main")).toHaveAttribute(
      "title",
      projectC.path,
      { timeout: 5_000 },
    );

    await openPlanningModal(page);
    await page.getByTitle("Categories").click();
    await page.locator(".inspector-tab.is-active", { hasText: "Categories" }).waitFor({ state: "visible", timeout: 5_000 });

    const category = fixtureCategory(0);
    await page.locator(".inspector-category-card", { hasText: category.name }).click();
    await page.locator(".inspector-category-header").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByTitle(`Suggest more ideas for ${category.name}`).click();

    const generationMs = Date.now() - start;

    await attachScreenshot(page, "category-generation-visible-screenshot");
    await attachLogs(logs, "category-generation-visible-logs.txt");
    await attachTiming("category-generation-visible", generationMs);

    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-input").first()).toHaveValue(
      `Generate new ideas for the "${category.name}" category. ${category.description}`,
    );
  });
});

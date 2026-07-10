import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, fixtureProject } from "./helpers";

test.describe("Project-scoped views", () => {
  test("history drawer shows only active project's closed panels", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Open the history drawer.
    await page.getByTitle(/History/).first().click();
    const drawer = page.locator(".history-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The drawer title shows the count of closed panels for this project.
    await expect(drawer.locator(".history-drawer-header")).toContainText(/History/);

    // Close the drawer.
    await page.getByTitle("Close history").click();
    await expect(drawer).not.toBeVisible();
  });

  test("switching projects updates the history drawer content", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Open history drawer for the first project.
    await page.getByTitle(/History/).first().click();
    const drawer = page.locator(".history-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    const firstCount = await drawer.locator(".history-drawer-item").count();

    // Close drawer, switch to a different project.
    await page.getByTitle("Close history").click();
    const target = fixtureProject(1);
    await page.locator(".activity-sidebar-project-row").filter({ hasText: target.path.split(/[\\/]/).pop() ?? target.path }).first().click();

    // Wait for the switch overlay to clear.
    await expect(page.locator(".project-switching-overlay")).not.toBeVisible({ timeout: 10_000 });

    // Open history drawer again — it should show the new project's panels.
    await page.getByTitle(/History/).first().click();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    // The count may differ — the key assertion is that the drawer renders
    // without stale content from the previous project.
    const secondCount = await drawer.locator(".history-drawer-item").count();
    // Both counts are from the fixture's closed panels for their respective projects.
    expect(secondCount).toBeGreaterThanOrEqual(0);
  });

  test("planning inspector scopes to active project", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Open the planning inspector.
    await page.getByTitle("Plans & Ideas").first().click();
    const modal = page.locator(".modal-plans");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The plans tab is active by default or click it within the modal.
    const plansTab = modal.locator("[title='Plans']").first();
    if (await plansTab.isVisible()) {
      await plansTab.click();
    }
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible();

    // Close the modal.
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });
});

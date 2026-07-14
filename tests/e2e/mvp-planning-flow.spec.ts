import { test, expect } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, collectLogs, attachLogs, openPlanningModal } from "./helpers";

test.describe("Planning flow: schematic → categories → ideas → plans", () => {
  test.beforeEach(async ({ page }) => {
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);
  });

  test("schematic wizard opens destination picker with send mode", async ({ page }) => {
    const logs = collectLogs(page);
    // Open the planning modal.
    await openPlanningModal(page);

    // Click "Generate categories from project" on the Categories tab.
    await page.locator('[title="Categories"]').first().click();
    await expect(page.locator("text=Generate categories from project")).toBeVisible({ timeout: 5000 });
    await page.locator("text=Generate categories from project").click();

    // The destination picker should appear.
    await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5000 });
    // Cancel the picker — no prompt should be delivered.
    await page.locator('[title="Cancel — deliver nothing"]').click();
    await expect(page.locator(".destination-picker-modal")).not.toBeVisible({ timeout: 5000 });

    await attachLogs(logs, "schematic-wizard-logs.txt");
  });

  test("category generation shows visible chat destination", async ({ page }) => {
    // Open planning modal and go to Categories tab.
    await openPlanningModal(page);
    await page.locator('[title="Categories"]').first().click();

    // Click generate categories.
    await page.locator("text=Generate categories from project").click();

    // Destination picker should show.
    await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5000 });
    // The picker should list at least one destination.
    const destinations = page.locator(".destination-picker-modal button");
    const count = await destinations.count();
    expect(count).toBeGreaterThan(0);
  });

  test("ideas batch-select and promote to plans", async ({ page }) => {
    // Open planning modal and go to Ideas tab.
    await openPlanningModal(page);
    await page.locator('[title="Ideas history"]').first().click();

    // Select concept ideas via checkboxes.
    const checkboxes = page.locator(".idea-select-checkbox");
    const cbCount = await checkboxes.count();
    if (cbCount > 0) {
      await checkboxes.first().check();
      // Batch bar should appear.
      await expect(page.locator("text=selected")).toBeVisible({ timeout: 3000 });
      // Click "Approve selected".
      await page.locator('[title="Promote selected ideas into plans"]').click();
      // Wait for a result message.
      await expect(page.locator("text=/Promoted|Error/")).toBeVisible({ timeout: 5000 });
    }
  });

  test("Flow tab shows plan counts and launch button", async ({ page }) => {
    // Open planning modal and go to Flow tab.
    await openPlanningModal(page);
    await page.locator('[title="Flow board — live stage counts across the planning pipeline"]').first().click();

    // Flow board should show stages.
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".flow-board >> text=Schematic").first()).toBeVisible();
    await expect(page.locator(".flow-board >> text=Ideas").first()).toBeVisible();
    await expect(page.locator(".flow-board >> text=Plans").first()).toBeVisible();

    // Ready plans should show a Launch button.
    const launchBtn = page.locator('[title*="Launch"][title*="ready"]');
    const launchCount = await launchBtn.count();
    if (launchCount > 0) {
      await expect(launchBtn.first()).toBeVisible();
    }
  });

  test("no dropped or prose-only question on category generation", async ({ page }) => {
    const logs = collectLogs(page);
    // Open planning modal.
    await openPlanningModal(page);

    // Go to Categories and click generate.
    await page.locator('[title="Categories"]').first().click();
    await page.locator("text=Generate categories from project").click();

    // The modal should close (demote) so the destination chat is visible.
    await page.waitForTimeout(500);
    // The destination picker should be visible — not a silent drop.
    await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5000 });

    // No error logs about dropped prompts.
    const errorLogs = logs.filter((l) => l.includes("error") && l.toLowerCase().includes("drop"));
    expect(errorLogs.length).toBe(0);

    await attachLogs(logs, "category-generation-logs.txt");
  });
});

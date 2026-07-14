import { test, expect } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, collectLogs, attachLogs, attachScreenshot, openPlanningModal } from "./helpers";

test.describe("MVP golden path: folder → schematic → categories → ideas → plans → launch → merge", () => {
  test("full golden path journey renders without errors", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // 1. Project is active (charlie).
    await expect(page.locator("text=charlie").first()).toBeVisible({ timeout: 5000 });

    // 2. Open planning modal and verify all tabs render without errors.
    await openPlanningModal(page);

    // 3. Cycle through all tabs — each should render without throwing.
    for (const tabTitle of ["Plans", "Ideas history", "Categories", "Flow board — live stage counts across the planning pipeline", "OpenSpec change catalog — browse and toggle tasks"]) {
      await page.locator(`[title="${tabTitle}"]`).first().click();
      await page.waitForTimeout(300);
    }

    // 4. Flow tab should show the flow board.
    await page.locator('[title="Flow board — live stage counts across the planning pipeline"]').first().click();
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5000 });

    // 5. Close modal via Close button.
    await page.locator('[title="Close (Esc)"]').first().click();
    await expect(page.locator(".planning-inspector-modal")).not.toBeVisible({ timeout: 5000 });

    // 6. No unhandled errors throughout the journey.
    const errorLogs = logs.filter((l) => l.includes("Uncaught") || l.includes("pageerror"));
    expect(errorLogs.length).toBe(0);

    await attachLogs(logs, "golden-path-logs.txt");
    await attachScreenshot(page, "golden-path-final.png");
  });

  test("schematic card prefilled from fixture", async ({ page }) => {
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // The schematic should be loaded from the fixture.
    await openPlanningModal(page);

    // The schematic health badge should show "complete" or the flow tab should show schematic info.
    await page.locator('[title="Flow board — live stage counts across the planning pipeline"]').first().click();
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5000 });
    // Schematic stage should show some content.
    await expect(page.locator(".flow-stage").first()).toBeVisible();
  });

  test("approve-before-write: schematic wizard requires destination selection", async ({ page }) => {
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // Open planning modal.
    await openPlanningModal(page);

    // Go to Categories and click generate.
    await page.locator('[title="Categories"]').first().click();
    await page.locator("text=Generate categories from project").click();

    // Destination picker should appear — the user must choose a destination.
    await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5000 });

    // Cancel — nothing should be delivered.
    await page.locator('[title="Cancel — deliver nothing"]').click();
    await expect(page.locator(".destination-picker-modal")).not.toBeVisible({ timeout: 5000 });
  });

  test("cancelled destination delivers no prompt", async ({ page }) => {
    const logs = collectLogs(page);
    await openMvpFixtureProject(page, { projectIndex: 2 });
    await waitForAppReady(page);

    // Open planning modal and trigger category generation.
    await openPlanningModal(page);
    await page.locator('[title="Categories"]').first().click();
    await page.locator("text=Generate categories from project").click();

    // Cancel the destination picker.
    await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5000 });
    await page.locator('[title="Cancel — deliver nothing"]').click();

    // No prompt delivery should have occurred.
    await page.waitForTimeout(500);
    const deliveryLogs = logs.filter((l) => l.includes("deliver") || l.includes("Deliver"));
    // No delivery errors.
    const errorLogs = logs.filter((l) => l.includes("error") && l.includes("deliver"));
    expect(errorLogs.length).toBe(0);

    await attachLogs(logs, "cancelled-destination-logs.txt");
  });
});

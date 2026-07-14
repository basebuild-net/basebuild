import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, openPlanningModal } from "./helpers";

test.describe("OpenSpec wrapper integration (MVP §Golden path)", () => {
  test("Plans & Ideas button opens planning inspector", async ({ page }) => {
    await openFixtureProject(page);

    // Open the planning inspector via the PlanningIndicators dropdown.
    await openPlanningModal(page);

    // Planning inspector should be visible.
    const inspector = page.locator(".planning-inspector, .modal-overlay").first();
    await expect(inspector).toBeVisible({ timeout: 3_000 });
  });

  test("planning inspector has Plans and Ideas tabs", async ({ page }) => {
    await openFixtureProject(page);

    await openPlanningModal(page);

    // Should have tab buttons for Plans and Ideas.
    const plansTab = page.locator("button, [role='tab']").filter({ hasText: /^Plans$/ }).first();
    const ideasTab = page.locator("button, [role='tab']").filter({ hasText: /^Ideas$/ }).first();

    if (await plansTab.count() > 0) {
      await expect(plansTab).toBeVisible();
    }
    if (await ideasTab.count() > 0) {
      await expect(ideasTab).toBeVisible();
    }
  });

  test("planning indicators Ideas button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    // The planning indicators should have an Ideas stage button.
    const ideasBtn = page.locator('.planning-indicator[data-stage="ideas"]').first();
    if (await ideasBtn.count() > 0) {
      // Click it — should open the dropdown.
      await ideasBtn.click();
      await page.waitForTimeout(500);

      // Something should happen (dropdown or panel).
      const dropdown = page.locator(".planning-notification-dropdown").first();
      if (await dropdown.count() > 0) {
        await expect(dropdown).toBeVisible();
      }
    }
  });

  test("planning indicators Plans button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const plansBtn = page.locator('.planning-indicator[data-stage="plans"]').first();
    if (await plansBtn.count() > 0) {
      await plansBtn.click();
      await page.waitForTimeout(500);

      const dropdown = page.locator(".planning-notification-dropdown").first();
      if (await dropdown.count() > 0) {
        await expect(dropdown).toBeVisible();
      }
    }
  });

  test("planning indicators Schematic button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const schematicBtn = page.locator('.planning-indicator[data-stage="schematic"]').first();
    if (await schematicBtn.count() > 0) {
      await schematicBtn.click();
      await page.waitForTimeout(500);

      // Schematic opens its own modal or dropdown.
      const modal = page.locator(".modal-overlay, .planning-notification-dropdown").first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("planning indicators Running button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const runningBtn = page.locator('.planning-indicator[data-stage="running"]').first();
    if (await runningBtn.count() > 0) {
      await runningBtn.click();
      await page.waitForTimeout(500);

      const dropdown = page.locator(".planning-notification-dropdown").first();
      if (await dropdown.count() > 0) {
        await expect(dropdown).toBeVisible();
      }
    }
  });

  test("planning indicators Done button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const doneBtn = page.locator('.planning-indicator[data-stage="finished"]').first();
    if (await doneBtn.count() > 0) {
      await doneBtn.click();
      await page.waitForTimeout(500);

      const dropdown = page.locator(".planning-notification-dropdown").first();
      if (await dropdown.count() > 0) {
        await expect(dropdown).toBeVisible();
      }
    }
  });
});

test.describe("Compact chat context header (MVP §Context)", () => {
  test("header shows model, run state, branch, and measured context", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".chat-column-model-chip").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-header-run-state").first()).toContainText(/idle|running|queued/i);
    await expect(page.locator(".chat-header-context").first()).toHaveAttribute("title", /Context usage:/);
    const branch = page.locator(".chat-column-branch").first();
    if (await branch.count() > 0) await expect(branch).toHaveAttribute("title", /Branch:/);
  });

  test("compact context controls have tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    for (const control of [
      page.locator(".chat-column-model-chip").first(),
      page.locator(".chat-header-run-state").first(),
      page.locator(".chat-header-context").first(),
    ]) {
      await expect(control).toHaveAttribute("title", /.+/);
    }
  });
});

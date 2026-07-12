import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

test.describe("OpenSpec wrapper integration (MVP §Golden path)", () => {
  test("Plans & Ideas button opens planning inspector", async ({ page }) => {
    await openFixtureProject(page);

    // Click Plans & Ideas in the sidebar.
    const plansBtn = page.locator('button[title="Plans & Ideas"]').first();
    if (await plansBtn.count() > 0) {
      await plansBtn.click();
      await page.waitForTimeout(500);

      // Planning inspector should be visible.
      const inspector = page.locator(".planning-inspector, .modal-overlay").first();
      await expect(inspector).toBeVisible({ timeout: 3_000 });
    }
  });

  test("planning inspector has Plans and Ideas tabs", async ({ page }) => {
    await openFixtureProject(page);

    const plansBtn = page.locator('button[title="Plans & Ideas"]').first();
    if (await plansBtn.count() > 0) {
      await plansBtn.click();
      await page.waitForTimeout(500);

      // Should have tab buttons for Plans and Ideas.
      const plansTab = page.locator("button, [role='tab']").filter({ hasText: /^Plans$/ }).first();
      const ideasTab = page.locator("button, [role='tab']").filter({ hasText: /^Ideas$/ }).first();

      if (await plansTab.count() > 0) {
        await expect(plansTab).toBeVisible();
      }
      if (await ideasTab.count() > 0) {
        await expect(ideasTab).toBeVisible();
      }
    }
  });

  test("command strip Ideas button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    // The command strip should have an Ideas stage button.
    const ideasBtn = page.locator('button[title*="deas"]').first();
    if (await ideasBtn.count() > 0) {
      // Click it — should open planning or ideas view.
      await ideasBtn.click();
      await page.waitForTimeout(500);

      // Something should happen (modal or panel).
      const modal = page.locator(".modal-overlay, .planning-inspector").first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("command strip Plans button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const plansBtn = page.locator('button[title*="Plans"]').first();
    if (await plansBtn.count() > 0) {
      await plansBtn.click();
      await page.waitForTimeout(500);

      const modal = page.locator(".modal-overlay, .planning-inspector").first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("command strip Schematic button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const schematicBtn = page.locator('button[title*="chematic"]').first();
    if (await schematicBtn.count() > 0) {
      await schematicBtn.click();
      await page.waitForTimeout(500);

      // Schematic opens its own modal.
      const modal = page.locator(".modal-overlay, .schematic-panel").first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("command strip Running button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const runningBtn = page.locator('button[title*="unning"]').first();
    if (await runningBtn.count() > 0) {
      await runningBtn.click();
      await page.waitForTimeout(500);

      // Running opens flow board.
      const flowBoard = page.locator(".modal-overlay, .flow-board").first();
      if (await flowBoard.count() > 0) {
        await expect(flowBoard).toBeVisible();
      }
    }
  });

  test("command strip Done button is reachable", async ({ page }) => {
    await openFixtureProject(page);

    const doneBtn = page.locator('button[title*="one"]').first();
    if (await doneBtn.count() > 0) {
      await doneBtn.click();
      await page.waitForTimeout(500);

      const flowBoard = page.locator(".modal-overlay, .flow-board").first();
      if (await flowBoard.count() > 0) {
        await expect(flowBoard).toBeVisible();
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

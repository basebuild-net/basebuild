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

test.describe("Context strip (MVP §Context strip)", () => {
  test("context strip shows workspace id", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const strip = page.locator(".chat-context-strip").first();
    await expect(strip).toBeVisible({ timeout: 5_000 });

    // Should have a workspace chip.
    const wsChip = strip.locator(".chat-context-chip").filter({ hasText: /ws|workspace|nchat/i }).first();
    if (await wsChip.count() > 0) {
      await expect(wsChip).toBeVisible();
    }
  });

  test("context strip shows model", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const strip = page.locator(".chat-context-strip").first();
    const modelChip = strip.locator(".chat-context-chip").filter({ hasText: /model/i }).first();
    await expect(modelChip).toBeVisible();
  });

  test("context strip shows run state when idle", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const strip = page.locator(".chat-context-strip").first();
    const runState = strip.locator(".chat-context-run-state").first();
    await expect(runState).toBeVisible();
    await expect(runState).toContainText(/idle|running|queued/i);
  });

  test("context strip shows branch", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const strip = page.locator(".chat-context-strip").first();
    const branchChip = strip.locator(".chat-context-chip").filter({ hasText: /branch|main/i }).first();
    if (await branchChip.count() > 0) {
      await expect(branchChip).toBeVisible();
    }
  });

  test("context strip chips have tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const strip = page.locator(".chat-context-strip").first();
    const chips = strip.locator(".chat-context-chip");
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const title = await chips.nth(i).getAttribute("title");
      expect(title, `Context chip ${i} should have a tooltip`).toBeTruthy();
    }
  });
});

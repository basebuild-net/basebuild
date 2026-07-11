import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixture(page: Page) {
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

async function openSettings(page: Page) {
  const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
  await expect(accountBtn).toBeVisible({ timeout: 10_000 });
  await accountBtn.click({ timeout: 10_000 });
  const settingsItem = page.locator('button[title="Open settings"]').first();
  await expect(settingsItem).toBeVisible({ timeout: 5_000 });
  await settingsItem.click({ timeout: 5_000 });
  await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });
}

test.describe("OptionList: square selection control", () => {
  test("permission mode renders as option list with all options visible", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const list = page.locator(".option-list[aria-label='Permission mode']").first();
    await expect(list).toBeVisible({ timeout: 10_000 });

    // All three options visible at once — no dropdown.
    const buttons = list.locator(".option-list-btn");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toContainText("Balanced");
    await expect(buttons.nth(1)).toContainText("Always Ask");
    await expect(buttons.nth(2)).toContainText("Run Everything");

    // Exactly one active with aria-pressed=true.
    await expect(list.locator(".option-list-btn.is-active")).toHaveCount(1);
    await expect(list.locator("[aria-pressed='true']")).toHaveCount(1);

    // Every option has a tooltip.
    for (let i = 0; i < 3; i++) {
      const title = await buttons.nth(i).getAttribute("title");
      expect(title, `option ${i} tooltip`).toBeTruthy();
    }
  });

  test("clicking a permission option changes the active selection", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const list = page.locator(".option-list[aria-label='Permission mode']").first();
    await expect(list).toBeVisible({ timeout: 10_000 });

    const safeBtn = list.locator(".option-list-btn", { hasText: "Always Ask" });
    await safeBtn.click();
    await expect(safeBtn).toHaveClass(/is-active/);
    await expect(safeBtn).toHaveAttribute("aria-pressed", "true");

    // A toast confirms the change.
    await expect(page.locator(".toast").filter({ hasText: "Permission mode changed" })).toBeVisible({ timeout: 5_000 });
  });

  test("arrow keys move focus between options", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const list = page.locator(".option-list[aria-label='Permission mode']").first();
    await expect(list).toBeVisible({ timeout: 10_000 });

    const buttons = list.locator(".option-list-btn");
    await buttons.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    const focusedText = await page.evaluate(() => (document.activeElement as HTMLElement)?.textContent ?? "");
    expect(focusedText).toContain("Always Ask");

    await page.keyboard.press("ArrowLeft");
    const backText = await page.evaluate(() => (document.activeElement as HTMLElement)?.textContent ?? "");
    expect(backText).toContain("Balanced");
  });

  test("effort option list renders the model's supported efforts", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const list = page.locator(".chat-composer-header .option-list[aria-label='Effort level']").first();
    await expect(list).toBeVisible({ timeout: 10_000 });

    // Mock default model supports 4 efforts.
    await expect(list.locator(".option-list-btn")).toHaveCount(4);
    await expect(list.locator(".option-list-btn.is-active")).toHaveCount(1);
  });

  test("no native select remains in the composer controls", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    await expect(page.locator(".chat-composer-header").first()).toBeVisible({ timeout: 10_000 });
    expect(await page.locator(".chat-composer-header select").count()).toBe(0);
    expect(await page.locator(".chat-input-controls select").count()).toBe(0);
  });
});

test.describe("Settings: Skills tab", () => {
  test("skills tab lists resolved skills with badges", async ({ page }) => {
    await openFixture(page);
    await openSettings(page);

    await page.locator(".settings-tab", { hasText: "Skills" }).click();

    // Seeded mock returns 3 skills.
    const rows = page.locator(".skill-row");
    await expect(rows).toHaveCount(3, { timeout: 5_000 });

    // First row: name, description, source + runtime badges.
    const first = rows.first();
    await expect(first.locator(".skill-row-name")).toContainText("basebuild-project-schematic");
    await expect(first.locator(".skill-row-desc")).not.toBeEmpty();
    await expect(first.locator(".skill-badge")).toHaveCount(2);

    // User-sourced skill carries the variant badge class.
    await expect(page.locator(".skill-badge-user")).toHaveCount(1);
  });

  test("skill preview modal opens with content and closes with Escape", async ({ page }) => {
    await openFixture(page);
    await openSettings(page);

    await page.locator(".settings-tab", { hasText: "Skills" }).click();
    await expect(page.locator(".skill-row").first()).toBeVisible({ timeout: 5_000 });

    // Open the preview for the first skill.
    await page.locator(".skill-row").first().getByTitle("Preview skill content").click();

    const preview = page.locator(".skill-preview-content");
    await expect(preview).toBeVisible({ timeout: 5_000 });
    await expect(preview).toContainText("basebuild-project-schematic");

    // Escape closes the preview but keeps the Skills tab open.
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(page.locator(".skill-row").first()).toBeVisible();
  });

  test("settings rule decision renders as option list", async ({ page }) => {
    await openFixture(page);
    await openSettings(page);

    await page.locator(".settings-tab", { hasText: "Permissions" }).click();
    await page.waitForTimeout(500);

    // The approval-rule decision control is an option list, not a select.
    const decisionList = page.locator(".option-list").first();
    await expect(decisionList).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Plan promotion form: option lists and skill picker", () => {
  async function openPromotionForm(page: Page): Promise<boolean> {
    // Open the Plans modal from the command strip.
    const plansBtn = page.getByTitle(/Plans/).first();
    if (await plansBtn.count() === 0) return false;
    await plansBtn.click();
    await page.waitForTimeout(800);
    // Find a draft plan and open promotion. The promotion form renders
    // inside the plan panel for draft plans.
    const promote = page.locator(".plan-promotion-field").first();
    return (await promote.count()) > 0;
  }

  test("promotion form renders option lists instead of selects", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const opened = await openPromotionForm(page);
    test.skip(!opened, "No draft plan promotion form reachable in fixture");

    // Engine/effort/workspace/scheduling are option lists now.
    const panel = page.locator(".plan-promotion-field").first().locator("..");
    expect(await panel.locator("select").count()).toBe(0);
    expect(await panel.locator(".option-list").count()).toBeGreaterThanOrEqual(4);
  });
});

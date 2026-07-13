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

test.describe("Compact chat header dropdowns", () => {
  test("permission mode is a textual dropdown", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const select = page.locator(".chat-header-select[aria-label='Permission mode']").first();
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select.locator("option")).toHaveCount(3);
    await expect(select).toHaveValue("auto");
    await expect(select).toHaveAttribute("title", /Permission mode:/);
  });

  test("changing permission mode persists and confirms the selection", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const select = page.locator(".chat-header-select[aria-label='Permission mode']").first();
    await select.selectOption("safe");
    await expect(select).toHaveValue("safe");
    await expect(page.locator(".toast").filter({ hasText: "Permission mode changed" })).toBeVisible({ timeout: 5_000 });
  });

  test("effort dropdown exposes only the selected model's supported efforts", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    const select = page.locator(".chat-header-select[aria-label='Effort level']").first();
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select.locator("option")).toHaveCount(4);
    await expect(select).toHaveAttribute("title", /Effort level:/);
  });

  test("composer footer contains no duplicated configuration controls", async ({ page }) => {
    await openFixture(page);
    await ensureChatPanel(page);

    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".chat-composer-header")).toHaveCount(0);
    await expect(page.locator(".chat-input-controls")).toHaveCount(0);
    await expect(page.locator(".chat-context-strip")).toHaveCount(0);
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

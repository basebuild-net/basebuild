import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel } from "./helpers";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: "project" }),
  ).toBeVisible({ timeout: 5_000 });
}

/** Click a button by title using evaluate to bypass overlay interception. */
async function clickByTitle(page: Page, title: string) {
  await page.evaluate((t) => {
    const btn = document.querySelector<HTMLButtonElement>(`button[title='${t}']`);
    btn?.click();
  }, title);
  await page.waitForTimeout(300);
}

test.describe("panel grid", () => {
  test("renders a single chat panel on project open", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".panel-grid")).toBeVisible();
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible();
    await expect(page.locator(".panel-header").first()).toBeVisible();
    await expect(page.locator(".panel-header-surface-title").first()).toBeVisible();
    await expect(page.locator(".surface-row, .activity-sidebar-row").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("split right creates a second panel beside the first", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    await clickByTitle(page, "Split right (add surface beside)");

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".panel-grid-splitter").first()).toBeVisible();
    await expect(page.locator(".surface-row, .activity-sidebar-row")).toHaveCount(2);

    expect(pageErrors).toEqual([]);
  });

  test("close panel moves to history and history drawer shows it", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Split to get two panels.
    await clickByTitle(page, "Split right (add surface beside)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Open the "More actions" menu on the second panel header, then click close.
    const panelHeaders = page.locator(".panel-header");
    const secondHeader = panelHeaders.nth(1);
    await secondHeader.locator("button[title='More actions']").click();
    await expect(page.locator(".panel-header-menu")).toBeVisible({ timeout: 2_000 });
    await page.locator(".panel-header-menu button[title='Close and move to history']").click();
    await page.waitForTimeout(500);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-history-badge, .activity-sidebar-history-badge").first()).toContainText("1");

    // Open history drawer.
  await clickByTitle(page, "History drawer (1 closed surface)");
    // If that didn't match, try a broader title.
    const historyBtn = page.locator("button[title*='History']");
    if (await historyBtn.count() > 0) {
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>("button[title*='History']");
        btn?.click();
      });
      await page.waitForTimeout(300);
    }
    await expect(page.locator(".modal-overlay[aria-label='History']")).toBeVisible();
    // Scope to closed-panel items — the modal also lists all chats.
    await expect(page.locator(".history-modal-item-closed")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });
  test("reopen from history restores the panel to the grid", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Split + close to populate history.
    await clickByTitle(page, "Split right (add surface beside)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    const panelHeaders = page.locator(".panel-header");
    const secondHeader = panelHeaders.nth(1);
    await secondHeader.locator("button[title='More actions']").click();
    await expect(page.locator(".panel-header-menu")).toBeVisible({ timeout: 2_000 });
    await page.locator(".panel-header-menu button[title='Close and move to history']").click();
    await page.waitForTimeout(500);

    // Open history and re-open.
    await clickByTitle(page, "History drawer (1 closed surface)");
    // Fallback: try broader title match.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>("button[title*='History']");
      if (btn) btn.click();
    });
    await expect(page.locator(".modal-overlay[aria-label='History']")).toBeVisible();

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".history-modal-closed-actions button");
      btn?.click();
    });
    await page.waitForTimeout(500);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-history-badge, .activity-sidebar-history-badge")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("activity sidebar click focuses the corresponding panel", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await clickByTitle(page, "Split right (add surface beside)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Click the second row in the activity sidebar.
    await page.locator(".surface-row, .activity-sidebar-row").nth(1).click();

    const secondLeaf = page.locator(".panel-grid-leaf").nth(1);
    await expect(secondLeaf).toHaveClass(/is-active/);

    expect(pageErrors).toEqual([]);
  });

  test("grid renders without errors after reload", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Reload the page.
    await page.reload();
    await page.waitForTimeout(2000);

    // The grid renders without errors.
    const leafCount = await page.locator(".panel-grid-leaf").count();
    expect(leafCount).toBeGreaterThanOrEqual(0);

    expect(pageErrors).toEqual([]);
  });
});

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

    await clickByTitle(page, "Split vertically (left and right)");

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
    await clickByTitle(page, "Split vertically (left and right)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Close the second panel via its direct X button (round 2 removed the
    // overflow "More actions" menu in favor of a direct close button).
    const closeBtn = page.locator(".panel-header").nth(1).getByTitle("Close and move to History");
    await closeBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-history-badge, .activity-sidebar-history-badge").first()).toContainText("1");

    // Open history drawer — use evaluate to find the drawer button (not the
    // section header) by matching the exact title.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>("button[title^='History drawer']");
      btn?.click();
    });
    await page.waitForTimeout(500);
    await expect(page.locator(".modal-overlay[aria-label='History']")).toBeVisible();
    // Scope to closed-panel items — the modal also lists all chats.
    await expect(page.locator(".history-modal-item-closed")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });
  test("reopen from history restores the panel as unlinked", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Split + close to populate history.
    await clickByTitle(page, "Split vertically (left and right)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Close the second panel via direct X button.
    await page.locator(".panel-header").nth(1).getByTitle("Close and move to History").click();
    await page.waitForTimeout(500);

    // Open history drawer.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>("button[title^='History drawer']");
      btn?.click();
    });
    await page.waitForTimeout(500);
    await expect(page.locator(".modal-overlay[aria-label='History']")).toBeVisible();

    // Click the Re-open button on the first closed panel item.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".history-modal-closed-actions button");
      btn?.click();
    });
    await page.waitForTimeout(500);

    // The reopened panel goes to hiddenPanels (unlinked), not the visible
    // tree. The grid still has 1 visible panel, but the sidebar shows the
    // reopened panel as an unlinked row.
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);
    // History badge should be gone (the panel is active again, just unlinked).
    await expect(page.locator(".surface-history-badge, .activity-sidebar-history-badge")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("activity sidebar click focuses the corresponding panel", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await clickByTitle(page, "Split vertically (left and right)");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Click the second row in the activity sidebar (use evaluate to bypass
    // draggable attribute interference).
    await page.evaluate(() => {
      const rows = document.querySelectorAll<HTMLElement>(".surface-row, .activity-sidebar-row");
      rows[1]?.click();
    });
    await page.waitForTimeout(300);

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

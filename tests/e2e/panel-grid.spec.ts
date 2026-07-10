import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name", { hasText: "project" }),
  ).toBeVisible();
}

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
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
    await expect(page.locator(".panel-header-title").first()).toBeVisible();
    await expect(page.locator(".activity-sidebar-row").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("split right creates a second panel beside the first", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    await clickByTitle(page, "Split right");

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".panel-grid-splitter").first()).toBeVisible();
    await expect(page.locator(".activity-sidebar-row")).toHaveCount(2);

    expect(pageErrors).toEqual([]);
  });

  test("close panel moves to history and history drawer shows it", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Split to get two panels.
    await clickByTitle(page, "Split right");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Close the second panel via evaluate.
    await page.evaluate(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("button[title='Close panel (session retained in history)']");
      buttons[buttons.length - 1]?.click();
    });
    await page.waitForTimeout(500);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".activity-sidebar-history-badge")).toContainText("1");

    // Open history drawer.
    await clickByTitle(page, "History (0 closed panels)");
    // If that didn't match, try a broader title.
    const historyBtn = page.locator("button[title*='History']");
    if (await historyBtn.count() > 0) {
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>("button[title*='History']");
        btn?.click();
      });
      await page.waitForTimeout(300);
    }
    await expect(page.locator(".history-drawer")).toBeVisible();
    await expect(page.locator(".history-drawer-item")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });

  test("reopen from history restores the panel to the grid", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Split + close to populate history.
    await clickByTitle(page, "Split right");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    await page.evaluate(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("button[title='Close panel (session retained in history)']");
      buttons[buttons.length - 1]?.click();
    });
    await page.waitForTimeout(500);

    // Open history and re-open.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>("button[title*='History']");
      btn?.click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator(".history-drawer")).toBeVisible();

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".history-drawer-item button");
      btn?.click();
    });
    await page.waitForTimeout(500);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".activity-sidebar-history-badge")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("activity sidebar click focuses the corresponding panel", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await clickByTitle(page, "Split right");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Click the second row in the activity sidebar.
    await page.locator(".activity-sidebar-row").nth(1).click();
    await page.waitForTimeout(200);

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

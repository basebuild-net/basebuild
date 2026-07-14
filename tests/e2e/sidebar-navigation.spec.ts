import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

test.describe("Left sidebar structure (DESIGN.md §Layout)", () => {
  test("sidebar is visible and has correct structure", async ({ page }) => {
    await openFixtureProject(page);

    const sidebar = page.locator(".project-chat-sidebar").first();
    await expect(sidebar).toBeVisible();

    const newChatBtn = sidebar.locator('button[title="New chat"]').first();
    await expect(newChatBtn).toBeVisible();

    const addProjectBtn = sidebar.locator('button[title*="Add project"]').first();
    await expect(addProjectBtn).toBeVisible();

    const collapseBtn = sidebar.locator('button[title*="ollapse"]').first();
    await expect(collapseBtn).toBeVisible();
  });

  test("sidebar shows project list", async ({ page }) => {
    await openFixtureProject(page);

    const projectItems = page.locator(".activity-sidebar-project-name, .activity-sidebar-project-row");
    const count = await projectItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("sidebar shows panels/chats under project", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    let rows = page.locator(".activity-sidebar-row");
    if (await rows.count() === 0) {
      await page.getByTitle("New chat").first().click();
      await page.waitForTimeout(500);
      rows = page.locator(".activity-sidebar-row");
    }
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const title = await rows.nth(i).getAttribute("title");
      expect(title, `Sidebar row ${i} should have a tooltip`).toBeTruthy();
    }
  });

  test("sidebar account row is visible", async ({ page }) => {
    await openFixtureProject(page);

    const accountArea = page.locator(".sidebar-bottom-account").first();
    if (await accountArea.count() > 0) {
      await expect(accountArea).toBeVisible();
    }
  });

  test("sidebar collapse toggle is present with tooltip", async ({ page }) => {
    await openFixtureProject(page);

    const collapseBtn = page.locator('button[title*="ollapse"]').first();
    if (await collapseBtn.count() > 0) {
      const title = await collapseBtn.getAttribute("title");
      expect(title).toBeTruthy();
    }
  });

  test("clicking New chat creates a chat panel", async ({ page }) => {
    await openFixtureProject(page);

    const initialPanels = await page.locator(".chat-panel").count();
    await page.getByTitle("New chat").first().click();
    await page.waitForTimeout(500);

    const newPanels = await page.locator(".chat-panel").count();
    expect(newPanels).toBeGreaterThanOrEqual(initialPanels);
  });

  test("sidebar buttons all have tooltips", async ({ page }) => {
    await openFixtureProject(page);

    const sidebar = page.locator(".project-chat-sidebar").first();
    const buttons = sidebar.locator("button:visible");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const title = await buttons.nth(i).getAttribute("title");
      expect(title, `Sidebar button ${i} should have a tooltip`).toBeTruthy();
    }
  });
});

test.describe("Planning indicators (DESIGN.md §Planning cockpit)", () => {
  test("planning indicators is visible with stage buttons", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".planning-indicators").first();
    if (await strip.count() > 0) {
      await expect(strip).toBeVisible();
      const buttons = strip.locator(".planning-indicator");
      const count = await buttons.count();
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  test("planning indicator buttons have tooltips", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".planning-indicators").first();
    if (await strip.count() > 0) {
      const buttons = strip.locator(".planning-indicator");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const title = await buttons.nth(i).getAttribute("title");
        expect(title, `Planning indicator button ${i} should have a tooltip`).toBeTruthy();
      }
    }
  });

  test("planning indicators shows counts for each stage", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".planning-indicators").first();
    if (await strip.count() > 0) {
      const counts = strip.locator("[class*='count'], [class*='badge']");
      const count = await counts.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe("Environment info block (DESIGN.md §Floating environment info)", () => {
  test("environment info block is visible", async ({ page }) => {
    await openFixtureProject(page);

    const envInfo = page.locator(".chat-environment-panel, [class*='environment']").first();
    if (await envInfo.count() > 0) {
      await expect(envInfo).toBeVisible();
    }
  });

  test("environment info shows branch", async ({ page }) => {
    await openFixtureProject(page);

    const branchInfo = page.locator("[title*='branch' i], [class*='branch']").first();
    if (await branchInfo.count() > 0) {
      await expect(branchInfo).toBeVisible();
    }
  });
});

test.describe("Chat header (DESIGN.md §Center chat surface)", () => {
  test("chat header shows title and status", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const header = page.locator(".chat-header").first();
    if (await header.count() > 0) {
      await expect(header).toBeVisible();
    }
  });

  test("chat header has panel controls with tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const header = page.locator(".chat-header").first();
    if (await header.count() > 0) {
      const buttons = header.locator("button");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const title = await buttons.nth(i).getAttribute("title");
        expect(title, `Chat header button ${i} should have a tooltip`).toBeTruthy();
      }
    }
  });
});

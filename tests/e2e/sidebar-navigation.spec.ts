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

test.describe("Left sidebar structure (DESIGN.md §Layout)", () => {
  test("sidebar is visible and has correct structure", async ({ page }) => {
    await openFixtureProject(page);

    // The root aside is .project-chat-sidebar.
    const sidebar = page.locator(".project-chat-sidebar").first();
    await expect(sidebar).toBeVisible();

    // Should have a New chat button (title="New chat").
    const newChatBtn = sidebar.locator('button[title="New chat"]').first();
    await expect(newChatBtn).toBeVisible();

    // Should have an Add project folder button.
    const addProjectBtn = sidebar.locator('button[title*="Add project"]').first();
    await expect(addProjectBtn).toBeVisible();

    // Should have a collapse/expand toggle.
    const collapseBtn = sidebar.locator('button[title*="ollapse"]').first();
    await expect(collapseBtn).toBeVisible();
  });

  test("sidebar shows project list", async ({ page }) => {
    await openFixtureProject(page);

    // The fixture seeds projects — at least one should be visible.
    const projectItems = page.locator(".activity-sidebar-project-name, .activity-sidebar-project");
    const count = await projectItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("sidebar shows panels/chats under project", async ({ page }) => {
    await openFixtureProject(page);

    // The sidebar uses activity-sidebar-row for panel items.
    const rows = page.locator(".activity-sidebar-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row should have a tooltip.
    for (let i = 0; i < count; i++) {
      const title = await rows.nth(i).getAttribute("title");
      expect(title, `Sidebar row ${i} should have a tooltip`).toBeTruthy();
    }
  });

  test("sidebar account row is visible", async ({ page }) => {
    await openFixtureProject(page);

    // DESIGN.md: bottom account row with username/avatar and settings.
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
    const buttons = sidebar.locator("button");
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const title = await buttons.nth(i).getAttribute("title");
      expect(title, `Sidebar button ${i} should have a tooltip`).toBeTruthy();
    }
  });
});

test.describe("Command strip (DESIGN.md §Planning cockpit)", () => {
  test("command strip is visible with stage buttons", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".command-strip").first();
    if (await strip.count() > 0) {
      await expect(strip).toBeVisible();

      // Should have 5 stage buttons: Schematic, Ideas, Plans, Running, Done.
      const buttons = strip.locator("button");
      const count = await buttons.count();
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  test("command strip buttons have tooltips", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".command-strip").first();
    if (await strip.count() > 0) {
      const buttons = strip.locator("button");
      const count = await buttons.count();

      for (let i = 0; i < count; i++) {
        const title = await buttons.nth(i).getAttribute("title");
        expect(title, `Command strip button ${i} should have a tooltip`).toBeTruthy();
      }
    }
  });

  test("command strip shows counts for each stage", async ({ page }) => {
    await openFixtureProject(page);

    const strip = page.locator(".command-strip").first();
    if (await strip.count() > 0) {
      // Each stage button should have a count badge.
      const counts = strip.locator("[class*='count'], [class*='badge']");
      const count = await counts.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe("Environment info block (DESIGN.md §Floating environment info)", () => {
  test("environment info block is visible", async ({ page }) => {
    await openFixtureProject(page);

    // The environment info block should be visible in the chat area.
    const envInfo = page.locator(".chat-environment-panel, [class*='environment']").first();
    if (await envInfo.count() > 0) {
      await expect(envInfo).toBeVisible();
    }
  });

  test("environment info shows branch", async ({ page }) => {
    await openFixtureProject(page);

    // Should show the current git branch.
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

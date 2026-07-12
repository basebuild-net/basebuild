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

async function debugAction(page: Page) {
  const header = page.locator(".chat-column-header").first();
  await header.getByTitle("More actions").click();
  return header.locator(".chat-more-menu-item").filter({ hasText: /debug events/i }).first();
}

async function toggleDebug(page: Page) {
  const action = await debugAction(page);
  await expect(action).toBeVisible();
  await action.click();
}

test.describe("Debug mode", () => {
  test("debug action is available from the compact header menu", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const action = await debugAction(page);
    await expect(action).toBeVisible({ timeout: 5_000 });
    await expect(action).toHaveAttribute("title", /raw event data|debug event rendering/i);
  });

  test("clicking debug toggle activates debug mode", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const debugPanel = page.locator(".chat-debug-panel");

    // Initially off (no debug panel).
    await expect(debugPanel).toHaveCount(0);

    // Turn on.
    await toggleDebug(page);

    // Debug panel should appear.
    await expect(debugPanel.first()).toBeVisible({ timeout: 3_000 });
    const action = await debugAction(page);
    await expect(action).toContainText("Hide debug events");
  });

  test("debug panel shows expand toggle with event count", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode.
    await toggleDebug(page);

    const panelToggle = page.locator(".chat-debug-panel-toggle").first();
    await expect(panelToggle).toBeVisible();
    // The toggle text should contain "Debug Event Stream".
    await expect(panelToggle).toContainText(/Debug Event Stream/i);
  });

  test("debug panel expands to show event list", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode.
    await toggleDebug(page);

    // Expand the panel.
    await page.locator(".chat-debug-panel-toggle").first().click();

    // The event list or empty message should be visible.
    const body = page.locator(".chat-debug-panel-body").first();
    await expect(body).toBeVisible({ timeout: 3_000 });

    // Should have either events or the empty message.
    const eventList = body.locator(".chat-debug-event-list");
    const emptyMsg = body.locator(".chat-debug-empty");
    const hasEvents = await eventList.count();
    const hasEmpty = await emptyMsg.count();
    expect(hasEvents + hasEmpty).toBeGreaterThan(0);
  });

  test("debug mode persists across page reloads", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode.
    await toggleDebug(page);
    await expect(page.locator(".chat-debug-panel").first()).toBeVisible();

    // Reload page.
    await page.reload();
    await waitForAppReady(page);
    await ensureChatPanel(page);

    // Debug mode should still be on.
    await expect(page.locator(".chat-debug-panel").first()).toBeVisible({ timeout: 5_000 });
  });

  test("debug panel has clear button", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode and expand.
    await toggleDebug(page);
    await page.locator(".chat-debug-panel-toggle").first().click();

    // Clear button should be visible.
    const clearBtn = page.locator(".chat-debug-clear").first();
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toHaveAttribute("title", /Clear debug event log/i);
  });

  test("turning off debug mode hides the panel", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on.
    await toggleDebug(page);
    await expect(page.locator(".chat-debug-panel").first()).toBeVisible();

    // Turn off.
    await toggleDebug(page);
    await expect(page.locator(".chat-debug-panel")).toHaveCount(0);
  });
});

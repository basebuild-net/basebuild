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

test.describe("Debug mode", () => {
  test("debug toggle button is visible below chat input", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const debugBtn = page.locator(".chat-debug-toggle").first();
    await expect(debugBtn).toBeVisible({ timeout: 5_000 });
    await expect(debugBtn).toHaveAttribute("title", /Debug mode/i);
  });

  test("clicking debug toggle activates debug mode", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const debugBtn = page.locator(".chat-debug-toggle").first();

    // Initially off (no debug panel).
    await expect(page.locator(".chat-debug-panel")).toHaveCount(0);

    // Turn on.
    await debugBtn.click();

    // Debug panel should appear.
    await expect(page.locator(".chat-debug-panel").first()).toBeVisible({ timeout: 3_000 });

    // Toggle button should show active state.
    await expect(debugBtn).toHaveClass(/chat-debug-toggle-on/);
  });

  test("debug panel shows expand toggle with event count", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode.
    await page.locator(".chat-debug-toggle").first().click();

    const panelToggle = page.locator(".chat-debug-panel-toggle").first();
    await expect(panelToggle).toBeVisible();
    // The toggle text should contain "Debug Event Stream".
    await expect(panelToggle).toContainText(/Debug Event Stream/i);
  });

  test("debug panel expands to show event list", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Turn on debug mode.
    await page.locator(".chat-debug-toggle").first().click();

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
    await page.locator(".chat-debug-toggle").first().click();
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
    await page.locator(".chat-debug-toggle").first().click();
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
    await page.locator(".chat-debug-toggle").first().click();
    await expect(page.locator(".chat-debug-panel").first()).toBeVisible();

    // Turn off.
    await page.locator(".chat-debug-toggle").first().click();
    await expect(page.locator(".chat-debug-panel")).toHaveCount(0);
  });
});

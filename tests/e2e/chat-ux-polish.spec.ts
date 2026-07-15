import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, ensureChatPanel, openFixtureProject } from "./helpers";

async function selectLocalProvider(page: Page) {
  await page.locator(".chat-column-model-chip").click();
  await page.locator(".provider-card").first().click();
  await page.getByTitle("Close provider and model catalog").click();
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByLabel("Chat message input").first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

async function waitForCompletion(page: Page, textFragment: string, timeout = 15_000) {
  await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText(textFragment, { timeout });
}

test.describe("chat UX polish: scroll-to-bottom, search, copy, thinking default, history toggle", () => {
  test("scroll-to-bottom button appears when scrolled up", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Send messages to create scrollable content.
    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Check if the chat-messages container is scrollable.
    const messages = page.locator(".chat-messages");
    const isScrollable = await messages.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight);
    if (!isScrollable) {
      // If not scrollable, the button won't appear — skip this assertion.
      console.log("Chat messages container not scrollable, skipping scroll-to-bottom test");
      test.skip();
    }

    // Scroll up.
    await messages.evaluate((el: HTMLElement) => { el.scrollTop = 0; });
    await page.waitForTimeout(500);

    // Dispatch a scroll event to ensure the listener fires.
    await messages.evaluate((el: HTMLElement) => {
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // Scroll-to-bottom button should appear.
    const scrollBtn = page.locator(".chat-scroll-bottom-btn");
    await expect(scrollBtn).toBeVisible({ timeout: 5_000 });

    // Click it — should scroll to bottom.
    await scrollBtn.click();
    await page.waitForTimeout(500);

    // Button should disappear after scrolling to bottom.
    await expect(scrollBtn).not.toBeVisible({ timeout: 5_000 });
  });

  test("view stays pinned to the newest message after a tall streamed turn", async ({ page }) => {
    // Regression: auto-scroll measured distance-from-bottom against the
    // already-grown scrollHeight, so it read every new message as "user
    // scrolled up" and stopped following. When the user is at the bottom the
    // view MUST stay with the newest content as it streams in.
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    const messages = page.locator(".chat-messages");
    const isScrollable = await messages.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight);
    test.skip(!isScrollable, "transcript did not overflow the viewport");

    // The container must be at (or within a hair of) the bottom.
    const distanceFromBottom = await messages.evaluate(
      (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight,
    );
    expect(distanceFromBottom).toBeLessThanOrEqual(4);
  });

  test("thinking block defaults to expanded", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Send a message that triggers reasoning-split-test (produces reasoning).
    await sendMessage(page, "reasoning-split-test");
    await waitForCompletion(page, "fix is applied", 15_000);
    await page.waitForTimeout(1000);

    // The thinking block content should be visible by default.
    const thinkingContent = page.locator(".chat-thinking-content");
    await expect(thinkingContent.first()).toBeVisible({ timeout: 10_000 });
  });

  test("copy conversation button copies full transcript as markdown", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "hello world");
    await waitForCompletion(page, "hello world");
    await page.waitForTimeout(500);

    // Copy conversation moved into the compact header's secondary menu.
    const header = page.locator(".chat-column-header").first();
    await header.getByTitle("More actions").click();
    const copyAction = header.getByTitle("Copy the entire conversation as markdown");
    await expect(copyAction).toBeVisible();
    await expect(copyAction).not.toBeDisabled();
    await copyAction.click();
    await expect(page.locator(".taskbar-notif-bar").filter({ hasText: "Copied conversation" })).toBeVisible({ timeout: 5_000 });
  });

  test("copy conversation action is enabled for pre-seeded history", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // The pre-seeded MVP message enables the menu action.
    const header = page.locator(".chat-column-header").first();
    await header.getByTitle("More actions").click();
    await expect(header.getByTitle("Copy the entire conversation as markdown")).not.toBeDisabled();
  });

  test("history toggle opens the history drawer", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Click the history toggle button in the chat header.
    const historyToggle = page.locator("button[title='Toggle chat history']").first();
    await expect(historyToggle).toBeVisible();
    await historyToggle.click();
    await page.waitForTimeout(500);

    // History drawer should be visible.
    const drawer = page.locator(".history-modal").first();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
  });

  test("tool card header has aria-expanded attribute", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Tool card header should have aria-expanded.
    const cardHeader = page.locator(".tool-card-header").first();
    const ariaExpanded = await cardHeader.getAttribute("aria-expanded");
    expect(ariaExpanded).not.toBeNull();
    expect(ariaExpanded === "true" || ariaExpanded === "false").toBeTruthy();
  });

  test("chat messages have aria-label", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "hello world");
    await waitForCompletion(page, "hello world");
    await page.waitForTimeout(500);

    // At least one message should have aria-label.
    const messages = page.locator(".chat-message[aria-label]");
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  test("aria-live region announces streaming status", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // The aria-live region should exist.
    const liveRegion = page.locator("[aria-live='polite']").first();
    await expect(liveRegion).toBeAttached();

    // Send a message to start streaming.
    await sendMessage(page, "stream-test");
    await page.waitForTimeout(200);

    // The live region should have content during streaming.
    const text = await liveRegion.textContent();
    expect(text).toBeTruthy();
  });

  test("search bar opens with Ctrl+F and closes with Escape", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "hello world");
    await waitForCompletion(page, "hello world");
    await page.waitForTimeout(500);

    // Focus the chat panel and press Ctrl+F to open search.
    await page.locator(".chat-panel").first().focus();
    await page.waitForTimeout(100);
    await page.keyboard.press("Control+f");
    await page.waitForTimeout(500);

    // Search bar should be visible.
    const searchbar = page.locator(".chat-search-bar");
    await expect(searchbar).toBeVisible({ timeout: 5_000 });

    // Press Escape to close.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Search bar should be gone.
    await expect(searchbar).not.toBeVisible();
  });

  test("search bar finds matching text", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Open search.
    await page.locator(".chat-panel").first().focus();
    await page.waitForTimeout(100);
    await page.keyboard.press("Control+f");
    await page.waitForTimeout(500);

    const searchbar = page.locator(".chat-search-bar");
    await expect(searchbar).toBeVisible({ timeout: 5_000 });

    // Type a search query.
    const searchInput = page.locator(".chat-search-input");
    await searchInput.fill("read");
    await page.waitForTimeout(500);

    // Match count should show > 0.
    const countText = await page.locator(".chat-search-count").textContent();
    expect(countText).not.toContain("0/0");
  });

  test("textarea auto-resize uses CSS custom property not inline style", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    const textarea = page.locator(".chat-input");
    await textarea.waitFor({ state: "visible" });

    // Type to trigger auto-resize.
    await textarea.fill("line 1\nline 2\nline 3\nline 4");
    await page.waitForTimeout(200);

    // Check that the textarea has a CSS custom property, not inline height.
    const hasCustomProp = await textarea.evaluate((el: HTMLElement) => {
      return el.style.getPropertyValue("--chat-input-height") !== "";
    });
    expect(hasCustomProp).toBe(true);

    // Should NOT have inline height set directly.
    const hasInlineHeight = await textarea.evaluate((el: HTMLElement) => {
      return el.style.height !== "";
    });
    expect(hasInlineHeight).toBe(false);
  });

  test("screenshot: scroll-to-bottom button visible when scrolled up", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Scroll up.
    const messages = page.locator(".chat-messages");
    const isScrollable = await messages.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight);
    if (!isScrollable) {
      test.skip();
    }
    await messages.evaluate((el: HTMLElement) => { el.scrollTop = 0; });
    await messages.evaluate((el: HTMLElement) => {
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(500);

    await attachScreenshot(page, "scroll-to-bottom-button");
  });

  test("screenshot: search bar with matches", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Open search and type.
    await page.locator(".chat-panel").first().focus();
    await page.waitForTimeout(100);
    await page.keyboard.press("Control+f");
    await page.waitForTimeout(500);
    await page.locator(".chat-search-input").fill("read");
    await page.waitForTimeout(500);

    await attachScreenshot(page, "search-bar-with-matches");
  });
});

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

test.describe("chat streaming phases", () => {
  test("stream-test drives thinking indicator, reasoning, incremental markdown, then final message", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Deterministic local provider.
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();

    await page.getByTitle(/Chat input/).first().fill("stream-test");
    await page.getByTitle("Send message").click();

    // Phase 1: waiting for first token — thinking indicator shows during the
    // status-channel window (mock holds it for 400ms before the first delta).
    await expect(page.locator(".chat-thinking-indicator")).toBeVisible({ timeout: 3_000 });

    // Phase 2: reasoning chunk renders in the live thinking block.
    await expect(page.locator(".chat-message-reasoning")).toBeVisible({ timeout: 3_000 });

    // Phase 3: content deltas render incrementally through the markdown
    // renderer — bold appears from a *partial* accumulated buffer.
    await expect(page.locator(".chat-messages .md-bold", { hasText: "bold" }).first()).toBeVisible({ timeout: 3_000 });

    // Phase 4: the resolved turn persists the full assistant message and the
    // streaming block is replaced by it.
    const finalMsg = page.locator(".chat-message-assistant .md-body").last();
    await expect(finalMsg).toContainText("arrived incrementally", { timeout: 5_000 });
    await expect(page.locator(".chat-thinking-indicator")).toHaveCount(0);

    // Composer input is re-enabled after the turn (Send stays disabled only
    // because the input is empty — that's correct, not a lockup).
    await expect(page.getByTitle(/Chat input/).first()).toBeEnabled({ timeout: 5_000 });
  });

  test("streaming events for another session do not leak into this chat", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Emit a chunk for a session id that is not the active one.
    await page.evaluate(() => {
      const w = window as typeof window & { __emit?: (event: string, payload: unknown) => void };
      w.__emit?.("native-chat://chunk", { sessionId: "nchat-other-session", delta: "leaked text" });
    });
    await page.waitForTimeout(300);

    await expect(page.locator(".chat-messages")).not.toContainText("leaked text");
  });
});

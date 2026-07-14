import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

test.describe("chat streaming phases", () => {
  test("stream-test drives thinking indicator, reasoning, incremental markdown, then final message", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Deterministic local provider.
    await page.locator(".chat-column-model-chip").click();
    await page.locator(".provider-card").first().click();
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

  test("Stop during a streaming turn unlocks the composer", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-column-model-chip").click();
    await page.locator(".provider-card").first().click();
    await page.getByTitle("Close provider and model catalog").click();

    await page.getByTitle(/Chat input/).first().fill("stream-test");
    await page.getByTitle("Send message").click();

    // While the turn is in flight, the send button becomes Stop.
    const stopBtn = page.locator(".chat-stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 3_000 });
    await stopBtn.click();

    // Stop frees the composer immediately: input enabled, Stop replaced by
    // Send, and no streaming indicators remain.
    await expect(page.getByTitle(/Chat input/).first()).toBeEnabled({ timeout: 5_000 });
    await expect(stopBtn).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator(".chat-thinking-indicator")).toHaveCount(0);

    // The project status dot settles out of running.
    await expect(
      page.locator(".activity-sidebar-project-row.is-active .agent-status-dot").first(),
    ).not.toHaveClass(/agent-status-running/, { timeout: 5_000 });

    // The composer accepts a new message after stop.
    await page.getByTitle(/Chat input/).first().fill("follow-up");
    await expect(page.getByTitle("Send message")).toBeEnabled();
  });
});

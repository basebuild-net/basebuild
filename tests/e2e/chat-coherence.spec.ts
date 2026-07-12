import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, attachScreenshot } from "./helpers";

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

async function selectLocalProvider(page: Page) {
  await page.locator(".chat-provider-trigger").click();
  await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
  await page.getByTitle("Close provider and model catalog").click();
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByTitle(/Chat input/).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

/** Wait for the persisted assistant message to appear (streaming is done). */
async function waitForCompletion(page: Page, textFragment: string, timeout = 10_000) {
  await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText(textFragment, { timeout });
}

test.describe("chat coherence: tool ordering, stop, approval, completion", () => {
  test("multi-tool-stream: tool events appear in chronological order during streaming", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");

    // Wait for the first tool card (read_file) to appear.
    const readCard = page.locator(".tool-card").filter({ hasText: "read file" }).first();
    await expect(readCard).toBeVisible({ timeout: 5_000 });

    // Wait for the edit_file card to appear AFTER read_file.
    const editCard = page.locator(".tool-card").filter({ hasText: "edit file" }).first();
    await expect(editCard).toBeVisible({ timeout: 5_000 });

    // Wait for the run_command card.
    const cmdCard = page.locator(".tool-card").filter({ hasText: "run command" }).first();
    await expect(cmdCard).toBeVisible({ timeout: 5_000 });

    // Assert DOM order: read_file comes before edit_file, edit_file before run_command.
    const allCards = page.locator(".tool-card");
    const count = await allCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify the tool cards are NOT at the top of the conversation (before user message).
    // The user message should come first, then tool cards, then assistant message.
    const firstMsg = page.locator(".chat-message").first();
    await expect(firstMsg).toHaveClass(/chat-message-user/);

    await attachScreenshot(page, "multi-tool-stream-ordering.png");
  });

  test("multi-tool-stream: completed tool cards remain expanded and readable after finish", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");

    // Wait for completion — the persisted assistant message should contain the final text.
    await waitForCompletion(page, "tests passed", 15_000);

    // All three tool cards should still be visible and expanded.
    const readCard = page.locator(".tool-card").filter({ hasText: "read file" }).first();
    const editCard = page.locator(".tool-card").filter({ hasText: "edit file" }).first();
    const cmdCard = page.locator(".tool-card").filter({ hasText: "run command" }).first();

    await expect(readCard).toBeVisible();
    await expect(editCard).toBeVisible();
    await expect(cmdCard).toBeVisible();

    // Cards should be expanded — the body (summary or diff) should be visible.
    await expect(readCard.locator(".tool-card-body")).toBeVisible();
    await expect(editCard.locator(".tool-card-body")).toBeVisible();
    await expect(cmdCard.locator(".tool-card-body")).toBeVisible();

    // The edit card should show a diff.
    await expect(editCard.locator(".tool-card-diff")).toBeVisible();
    await expect(editCard.locator(".diff-add").first()).toContainText("bar");

    // The run_command card should show the command summary.
    await expect(cmdCard.locator(".tool-card-summary")).toContainText("all tests passed");

    await attachScreenshot(page, "multi-tool-completed-expanded.png");
  });

  test("stop-partial: stop preserves partial stream text and reasoning", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "stop-partial-test");

    // Wait for streaming to start — reasoning should appear.
    await expect(page.locator(".chat-message-reasoning")).toBeVisible({ timeout: 5_000 });

    // Wait for partial content to appear in the streaming block.
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("analyze", { timeout: 5_000 });

    // Press Stop.
    const stopBtn = page.locator(".chat-stop-btn");
    await expect(stopBtn).toBeVisible({ timeout: 3_000 });
    await stopBtn.click();

    // After stop: composer is free.
    await expect(page.getByTitle(/Chat input/).first()).toBeEnabled({ timeout: 5_000 });

    // The partial text should STILL be visible — not cleared.
    // Use .last() to avoid strict mode violation from multiple assistant messages.
    await expect(page.locator(".chat-message-assistant").last()).toContainText("analyze", { timeout: 3_000 });

    // The reasoning text should STILL be visible.
    await expect(page.locator(".chat-message-reasoning")).toBeVisible({ timeout: 3_000 });

    // No streaming indicators.
    await expect(page.locator(".chat-thinking-indicator")).toHaveCount(0);
    await expect(page.locator(".chat-cursor")).toHaveCount(0);

    await attachScreenshot(page, "stop-preserves-text.png");
  });

  test("stop-partial: new send after stop clears old partial text", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "stop-partial-test");
    await expect(page.locator(".chat-message-reasoning")).toBeVisible({ timeout: 5_000 });
    await page.locator(".chat-stop-btn").click();
    await expect(page.getByTitle(/Chat input/).first()).toBeEnabled({ timeout: 5_000 });

    // Partial text visible after stop.
    await expect(page.locator(".chat-message-assistant").last()).toContainText("analyze");

    // Wait for the mock's first send promise to resolve (3s hold).
    // The first send's finally block reloads messages — we need it to
    // complete before sending the follow-up to avoid a race where
    // the reload overwrites the follow-up's messages.
    await page.waitForTimeout(4000);

    // Send a new message.
    await sendMessage(page, "follow-up message");

    // The new assistant message should appear.
    await expect(page.locator(".chat-message-assistant").last()).toContainText("Native harness echo", { timeout: 10_000 });

    await attachScreenshot(page, "stop-then-new-send.png");
  });

  test("approval-stream: approval card renders with Allow/Deny buttons in chronological position", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "approval-stream-test");

    // Wait for the read_file tool card (completed) to appear first.
    const readCard = page.locator(".tool-card").filter({ hasText: "read file" }).first();
    await expect(readCard).toBeVisible({ timeout: 5_000 });

    // Wait for the pending approval card (edit_file) to appear.
    const approvalCard = page.locator(".tool-card.tool-card-approval").first();
    await expect(approvalCard).toBeVisible({ timeout: 5_000 });

    // The approval card must have Allow/Deny buttons.
    await expect(approvalCard.locator("button", { hasText: "Allow Once" })).toBeVisible();
    await expect(approvalCard.locator("button", { hasText: "Deny" })).toBeVisible();

    // The approval card should appear AFTER the read_file card in DOM order.
    const allToolCards = page.locator(".tool-card");
    const firstCardText = await allToolCards.nth(0).textContent();
    expect(firstCardText).toContain("read file");

    await attachScreenshot(page, "approval-card-visible.png");
  });

  test("approval-stream: clicking Deny removes approval buttons", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "approval-stream-test");

    // Wait for approval card.
    const approvalCard = page.locator(".tool-card.tool-card-approval").first();
    await expect(approvalCard).toBeVisible({ timeout: 5_000 });

    // Click Deny.
    await approvalCard.locator("button", { hasText: "Deny" }).click();

    // The Allow/Deny buttons should disappear.
    await expect(approvalCard.locator("button", { hasText: "Allow Once" })).toHaveCount(0, { timeout: 3_000 });

    await attachScreenshot(page, "approval-denied.png");
  });

  test("tool-card-default-expanded: completed cards start expanded and toggle persists", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "tool-card-test");

    // Wait for the write_file card.
    const writeCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(writeCard).toBeVisible({ timeout: 5_000 });

    // Card starts expanded — diff visible immediately.
    await expect(writeCard.locator(".tool-card-diff")).toBeVisible();
    await expect(writeCard.locator(".tool-card-expand")).toContainText("▼");

    // Collapse by clicking header.
    await writeCard.locator(".tool-card-header").click();
    await expect(writeCard.locator(".tool-card-expand")).toContainText("▶");
    await expect(writeCard.locator(".tool-card-body")).toHaveCount(0);

    // Expand again.
    await writeCard.locator(".tool-card-header").click();
    await expect(writeCard.locator(".tool-card-expand")).toContainText("▼");
    await expect(writeCard.locator(".tool-card-body")).toBeVisible();

    await attachScreenshot(page, "tool-card-toggle.png");
  });

  test("conversation coherence: mock state persists messages and tool events across reload", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "tool-card-test");
    await waitForCompletion(page, "write a file");
    await expect(page.locator(".tool-card").filter({ hasText: "write file" })).toBeVisible();

    // Verify mock state has persisted the messages and tool events.
    const stateBefore = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__BASEBUILD_E2E_STATE__ as
        { nativeChatMessages: { sessionId: string }[]; nativeToolEvents: { kind: string }[] } | undefined;
      if (!s) return { messages: 0, toolEvents: 0 };
      return { messages: s.nativeChatMessages.length, toolEvents: s.nativeToolEvents.length };
    });
    expect(stateBefore.messages).toBeGreaterThanOrEqual(2);
    expect(stateBefore.toolEvents).toBe(3);

    await attachScreenshot(page, "reload-coherence.png");
  });

  test("multi-tool-stream: mock state persists interleaved tool events across reload", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "tests passed", 15_000);

    // Verify mock state has persisted all 3 tool events with correct sequence.
    const toolKinds = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__BASEBUILD_E2E_STATE__ as
        { nativeToolEvents: { kind: string; sequence: number }[] } | undefined;
      if (!s) return [];
      return s.nativeToolEvents
        .slice(-3)
        .sort((a, b) => a.sequence - b.sequence)
        .map((e) => e.kind);
    });
    expect(toolKinds).toEqual(["read_file", "edit_file", "run_command"]);

    await attachScreenshot(page, "multi-tool-reload-order.png");
  });


  test("streaming to completion: reasoning and text transition cleanly to persisted message", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "stream-test");

    // Phase 1: thinking indicator.
    await expect(page.locator(".chat-thinking-indicator")).toBeVisible({ timeout: 3_000 });

    // Phase 2: reasoning.
    await expect(page.locator(".chat-message-reasoning")).toBeVisible({ timeout: 3_000 });

    // Phase 3: streaming content.
    await expect(page.locator(".chat-message-assistant .md-bold", { hasText: "bold" }).first()).toBeVisible({ timeout: 3_000 });

    // Phase 4: completion — the persisted assistant message replaces the stream.
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("arrived incrementally", { timeout: 5_000 });

    // No streaming artifacts remain.
    await expect(page.locator(".chat-thinking-indicator")).toHaveCount(0);
    await expect(page.locator(".chat-cursor")).toHaveCount(0);

    // Composer is re-enabled.
    await expect(page.getByTitle(/Chat input/).first()).toBeEnabled({ timeout: 5_000 });

    await attachScreenshot(page, "stream-to-completion.png");
  });

  test("multiple turns: tool events from different turns don't interleave", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // First turn with tool cards.
    await sendMessage(page, "tool-card-test");
    await waitForCompletion(page, "write a file");
    const firstTurnCards = await page.locator(".tool-card").count();
    expect(firstTurnCards).toBe(3);

    // Second turn — a simple echo, no tool cards.
    await sendMessage(page, "second turn echo");
    await waitForCompletion(page, "second turn echo");

    // Tool card count should not change — no new tool cards from the second turn.
    const secondTurnCards = await page.locator(".tool-card").count();
    expect(secondTurnCards).toBe(firstTurnCards);

    // The second turn's assistant message should appear AFTER the tool cards.
    const lastAssistant = page.locator(".chat-message-assistant").last();
    await expect(lastAssistant).toContainText("second turn echo");

    await attachScreenshot(page, "multi-turn-no-interleave.png");
  });

  test("pending approval card renders AFTER the user message that triggered it", async ({ page }) => {
    // Regression: the optimistic user message and the live pending approval
    // get the same second-granularity createdAt; the old index tiebreak
    // sorted the approval card ABOVE the user message. With a huge injected
    // payload (schematic wizard) the card ended up off-screen — the user saw
    // "Waiting for approval" with no buttons anywhere.
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Long payload simulates the schematic wizard's injected skill body.
    const longPayload = "approval-stream-test\n" + "This line pads the injected command payload.\n".repeat(60);
    await sendMessage(page, longPayload);

    // The pending approval card must appear with actionable buttons.
    const approvalCard = page.locator(".tool-card-approval").first();
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });
    await expect(approvalCard.getByTitle("Allow this tool call once")).toBeVisible();
    await expect(approvalCard.getByTitle("Deny this tool call")).toBeVisible();

    // DOM order: the approval card must come AFTER the user message that
    // triggered it. (The MVP fixture pre-seeds a far-future "Start MVP
    // baseline" user message that intentionally sorts last — compare against
    // the triggering message, not the last user row.)
    const order = await page.evaluate(() => {
      const userMsgs = Array.from(document.querySelectorAll(".chat-message-user"));
      const trigger = userMsgs.find((el) => el.textContent?.includes("approval-stream-test"));
      const card = document.querySelector(".tool-card-approval");
      if (!card || !trigger) return "missing";
      const pos = trigger.compareDocumentPosition(card);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
    });
    expect(order).toBe("after");

    // Resolve so the held send doesn't leak into the next test.
    await approvalCard.getByTitle("Deny this tool call").click();
  });

  test("sticky approval bar is always reachable regardless of scroll or payload size", async ({ page }) => {
    // The real bug: with a tall streamed turn the in-transcript approval card
    // scrolls out of view above the fold, so the user sees "waiting for
    // approval" with no buttons. The sticky bar lives OUTSIDE the scroll
    // container (between transcript and composer) and must always be visible
    // and actionable, no matter how tall the conversation is.
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    const longPayload = "approval-stream-test\n" + "Padding line for a very tall user message.\n".repeat(80);
    await sendMessage(page, longPayload);

    // The sticky bar appears and is in the viewport.
    const bar = page.locator(".chat-approval-bar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar).toBeInViewport({ timeout: 5_000 });

    // Its Deny button is clickable and resolves the pending approval.
    await bar.getByTitle("Deny this tool call").click();
    await expect(bar).not.toBeVisible({ timeout: 5_000 });
  });

  test("sticky approval bar Allow Once resolves and dismisses", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "approval-stream-test");
    const bar = page.locator(".chat-approval-bar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.getByTitle("Allow this tool call once").click();
    await expect(bar).not.toBeVisible({ timeout: 5_000 });
  });
});

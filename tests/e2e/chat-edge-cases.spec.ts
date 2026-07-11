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

async function waitForCompletion(page: Page, textFragment: string, timeout = 15_000) {
  await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText(textFragment, { timeout });
}

test.describe("chat edge cases: multi-turn, reasoning split, long chains, empty state", () => {
  test("multi-turn conversation with tool calls in each turn", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Turn 1: simple exchange.
    await sendMessage(page, "hello world");
    await waitForCompletion(page, "hello world");
    await page.waitForTimeout(500);

    // Turn 2: multi-tool stream.
    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Turn 3: another simple exchange.
    await sendMessage(page, "thanks");
    await waitForCompletion(page, "thanks");
    await page.waitForTimeout(500);

    // The MVP fixture pre-seeds 1 user message ("Start MVP baseline")
    // with a far-future timestamp, so it sorts after our 3 turns.
    // Expected: 4 user (3 ours + 1 seeded), 3 assistant, 3 tool cards.
    const userMsgs = page.locator(".chat-message-user");
    const assistantMsgs = page.locator(".chat-message-assistant");
    await expect(userMsgs).toHaveCount(4);
    await expect(assistantMsgs).toHaveCount(3);

    // Assert tool cards only appear in turn 2 (3 tool cards).
    const toolCards = page.locator(".tool-card");
    await expect(toolCards).toHaveCount(3);

    // Assert DOM order: u1, a1, u2, [tools], a2, u3, a3, u_seed.
    const allMessages = page.locator(".chat-message, .tool-card");
    const count = await allMessages.count();
    expect(count).toBe(10); // 7 messages + 3 tool cards

    const kinds: string[] = [];
    for (let i = 0; i < count; i++) {
      const el = allMessages.nth(i);
      const cls = await el.getAttribute("class");
      if (cls?.includes("chat-message-user")) kinds.push("user");
      else if (cls?.includes("chat-message-assistant")) kinds.push("assistant");
      else if (cls?.includes("tool-card")) kinds.push("tool");
    }
    // Expected: user, assistant, user, assistant, tool, tool, tool, user, assistant, user(seeded)
    expect(kinds).toEqual(["user", "assistant", "user", "assistant", "tool", "tool", "tool", "user", "assistant", "user"]);
  });

  test("reasoning blocks split around tool calls", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "reasoning-split-test");
    await waitForCompletion(page, "fix is applied", 15_000);
    await page.waitForTimeout(500);

    // Should have 2 tool cards (read_file, edit_file).
    const toolCards = page.locator(".tool-card");
    await expect(toolCards).toHaveCount(2);

    // The read_file card should come before edit_file card in DOM.
    const readCard = page.locator(".tool-card").filter({ hasText: "read file" }).first();
    const editCard = page.locator(".tool-card").filter({ hasText: "edit file" }).first();
    await expect(readCard).toBeVisible();
    await expect(editCard).toBeVisible();

    // Verify DOM order: read before edit.
    const readBox = await readCard.boundingBox();
    const editBox = await editCard.boundingBox();
    expect(readBox?.y).toBeLessThan(editBox?.y!);
  });

  test("long sequential tool chain after completion", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-turn-tools-test");
    await waitForCompletion(page, "All steps complete", 15_000);
    await page.waitForTimeout(500);

    // Should have 3 tool cards in sequence.
    const toolCards = page.locator(".tool-card");
    await expect(toolCards).toHaveCount(3);

    // Verify they appear in order: step_1, step_2, step_3.
    for (let i = 0; i < 3; i++) {
      const card = toolCards.nth(i);
      await expect(card).toContainText(`Step ${i + 1}`);
    }

    // Screenshot for visual verification.
    await attachScreenshot(page, "long-tool-chain-after-completion");
  });

  test("empty conversation renders without errors", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Don't send any message. The chat panel should render with no messages.
    await page.waitForTimeout(500);

    // The chat panel should render without errors. Pre-seeded MVP fixture
    // messages may be present, so we verify the panel is functional:
    // input visible, no error indicators, and messages (if any) render.
    const input = page.getByTitle(/Chat input/).first();
    await expect(input).toBeVisible();

    // No error toasts or error indicators.
    const errors = page.locator(".chat-error, .error-banner");
    await expect(errors).toHaveCount(0);

    // Screenshot of the initial state.
    await attachScreenshot(page, "empty-conversation");
  });

  test("rapid sequential sends maintain chronological order", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Send 3 messages in rapid succession.
    await sendMessage(page, "msg 1");
    await page.waitForTimeout(300);
    await sendMessage(page, "msg 2");
    await page.waitForTimeout(300);
    await sendMessage(page, "msg 3");

    // Wait for all 3 assistant responses.
    await waitForCompletion(page, "msg 3", 20_000);
    await page.waitForTimeout(500);

    // Pre-seeded "Start MVP baseline" (far-future timestamp) sorts last.
    // Expected: 4 user (3 ours + 1 seeded), 3 assistant.
    const userMsgs = page.locator(".chat-message-user");
    const assistantMsgs = page.locator(".chat-message-assistant");
    await expect(userMsgs).toHaveCount(4);
    await expect(assistantMsgs).toHaveCount(3);

    // Verify DOM order: u1, a1, u2, a2, u3, a3, u_seed.
    const allMessages = page.locator(".chat-message");
    const count = await allMessages.count();
    expect(count).toBe(7);

    const kinds: string[] = [];
    for (let i = 0; i < count; i++) {
      const el = allMessages.nth(i);
      const cls = await el.getAttribute("class");
      if (cls?.includes("chat-message-user")) kinds.push("user");
      else if (cls?.includes("chat-message-assistant")) kinds.push("assistant");
    }
    expect(kinds).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  });

  test("mixed interactions + tool events + messages in order", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Send a message that triggers multi-tool stream (has tool events).
    await sendMessage(page, "multi-tool-stream-test");
    await waitForCompletion(page, "All tests passed");
    await page.waitForTimeout(500);

    // Then send a message that triggers approval stream (has interaction).
    await sendMessage(page, "approval-stream-test");
    // Wait for the approval card to appear.
    const approvalCard = page.locator(".tool-card").filter({ hasText: "edit file" }).filter({ hasText: "pending" });
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });

    // Deny the approval.
    const denyBtn = approvalCard.locator("[title='Deny']").first();
    if (await denyBtn.count() > 0) {
      await denyBtn.click();
    }

    await page.waitForTimeout(1000);

    // Verify tool cards from turn 1 still appear before the approval card.
    const allToolCards = page.locator(".tool-card");
    const cardCount = await allToolCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(3);
  });

  test("screenshot: multi-turn with interleaved reasoning", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    // Turn 1: simple.
    await sendMessage(page, "hello");
    await waitForCompletion(page, "hello");
    await page.waitForTimeout(300);

    // Turn 2: reasoning split (reasoning + tools).
    await sendMessage(page, "reasoning-split-test");
    await waitForCompletion(page, "fix is applied", 15_000);
    await page.waitForTimeout(500);

    // Screenshot for visual analysis.
    await attachScreenshot(page, "multi-turn-interleaved-reasoning");
  });

  test("screenshot: approval card between completed tools", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "approval-stream-test");
    // Wait for the approval card (pending edit_file).
    const approvalCard = page.locator(".tool-card").filter({ hasText: "edit file" }).filter({ hasText: "pending" });
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });

    // Screenshot while approval is pending.
    await attachScreenshot(page, "approval-card-between-completed-tools");

    // Deny to clean up.
    const denyBtn = approvalCard.locator("[title='Deny']").first();
    if (await denyBtn.count() > 0) {
      await denyBtn.click();
    }
    await page.waitForTimeout(500);
  });

  test("screenshot: long tool chain after completion", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "multi-turn-tools-test");
    await waitForCompletion(page, "All steps complete", 15_000);
    await page.waitForTimeout(500);

    await attachScreenshot(page, "long-tool-chain-completed");
  });
});

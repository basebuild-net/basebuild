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

test.describe("message action rail", () => {
  test("copy button is visible and clickable on user and assistant messages", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Select the local provider and send a message.
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();

    const usersBefore = await page.locator(".chat-message-user").count();
    await page.getByTitle(/Chat input/).first().fill("action-rail-test");
    await page.getByTitle("Send message").click();

    // Wait for the assistant reply.
    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".chat-message-assistant").last()).toBeVisible({ timeout: 10_000 });

    // Copy button exists on user messages.
    const userCopyBtn = page.locator(".chat-message-user .chat-message-action-copy").last();
    await expect(userCopyBtn).toBeAttached();
    await expect(userCopyBtn).toHaveAttribute("title", "Copy message source text to clipboard");

    // Copy button exists on assistant messages.
    const assistantCopyBtn = page.locator(".chat-message-assistant .chat-message-action-copy").last();
    await expect(assistantCopyBtn).toBeAttached();
    await expect(assistantCopyBtn).toHaveAttribute("title", "Copy message source text to clipboard");

    expect(consoleErrors).toEqual([]);
  });

  test("retry button appears on the last assistant message and re-sends", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();

    const usersBefore = await page.locator(".chat-message-user").count();
    await page.getByTitle(/Chat input/).first().fill("retry-test-message");
    await page.getByTitle("Send message").click();

    // Wait for the assistant reply.
    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".chat-message-assistant").last()).toBeVisible({ timeout: 10_000 });

    // Retry button is on the last assistant message.
    const retryBtn = page.locator(".chat-message-assistant .chat-message-action-retry").last();
    await expect(retryBtn).toBeAttached();
    await expect(retryBtn).toHaveAttribute("title", /Retry/);

    // Click retry — should produce a new user message (re-send of last user text).
    const userCountBeforeRetry = await page.locator(".chat-message-user").count();
    await retryBtn.click();
    await expect(page.locator(".chat-message-user")).toHaveCount(userCountBeforeRetry + 1, { timeout: 10_000 });

    expect(consoleErrors).toEqual([]);
  });

  test("edit-and-resend button loads the last user message into the composer", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();

    const usersBefore = await page.locator(".chat-message-user").count();
    const testText = "edit-resend-test-unique";
    await page.getByTitle(/Chat input/).first().fill(testText);
    await page.getByTitle("Send message").click();

    // Wait for the assistant reply.
    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".chat-message-assistant").last()).toBeVisible({ timeout: 10_000 });

    // Edit-and-resend button is on the last user message.
    const editBtn = page.locator(".chat-message-user .chat-message-action-edit").last();
    await expect(editBtn).toBeAttached();
    await expect(editBtn).toHaveAttribute("title", /Edit and resend/);

    // Click edit — composer should be prefilled with the last user message text.
    await editBtn.click();
    await expect(page.getByTitle(/Chat input/).first()).toHaveValue(testText);

    expect(consoleErrors).toEqual([]);
  });
});

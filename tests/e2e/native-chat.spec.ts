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

test.describe("native chat workspace", () => {
  test("creates a native chat tab and records a structured turn", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // The compact composer rail with provider/model/effort controls should be visible.
    await expect(page.locator(".chat-composer-header")).toBeVisible();
    await expect(page.locator(".chat-provider-trigger")).toBeVisible();
    await expect(page.locator(".chat-model-trigger")).toBeVisible();
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();
    await expect(page.locator(".option-list[aria-label='Effort level'] .option-list-btn.is-active")).not.toBeEmpty();
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");

    // Metrics bar should render with 0 req initially.
    await expect(page.locator(".chat-metrics")).toContainText("0 req");

    // Type and send a message.
    const usersBefore = await page.locator(".chat-message-user").count();
    const assistantsBefore = await page.locator(".chat-message-assistant").count();
    await page.getByTitle(/Chat input/).first().fill("Hello native harness");
    await page.getByTitle("Send message").click();

    // The user and assistant messages should render.
    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(assistantsBefore + 1);
    await expect(page.locator(".chat-message-assistant .chat-message-content").last()).toContainText("Native harness echo");

    // The local-coordinator turn is explicitly labeled offline.
    await expect(page.locator(".chat-offline-tag")).toBeVisible();

    // The metrics bar should now reflect one request.
    await expect(page.locator(".chat-metrics")).toContainText("1 req");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("prompts to connect when an unconfigured provider is selected", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    const catalogModal = page.locator('.provider-catalog-overlay[aria-label="Provider and model catalog"]');
    await expect(catalogModal).toBeVisible();
    await expect(catalogModal.locator(".provider-card.is-connected").first()).toBeVisible();
    await expect(catalogModal.locator(".provider-status.is-connected").first()).toContainText("Connected");
    await catalogModal.locator(".provider-card", { hasText: "OpenAI" }).first().click();

    // The catalog closes after selecting a provider so the composer controls update.
    await page.getByTitle("Close provider and model catalog").click();

    // The composer shows a degraded setup state and a Connect affordance.
    await expect(page.locator(".chat-provider-trigger")).toContainText("OpenAI");
    await expect(page.locator(".chat-provider-trigger")).toHaveClass(/is-warn/);
    await expect(page.locator(".chat-composer-header button[title*='Connect']")).toBeVisible();

    // Attempting to send opens the connect prompt and keeps the draft; no turn is sent.
    const messageCountBefore = await page.locator(".chat-message-user").count();
    await page.getByTitle(/Chat input/).first().fill("should not send yet");
    await page.getByTitle("Send message").click();

    const loginModal = page.locator(".modal-overlay").filter({
      has: page.locator("input[type='password']"),
    });
    await expect(loginModal).toBeVisible();
    await expect(loginModal.locator("input[placeholder='API key']")).toBeVisible();
    await expect(page.locator(".chat-message-user")).toHaveCount(messageCountBefore);
    await expect(page.getByTitle(/Chat input/).first()).toHaveValue("should not send yet");

    expect(consoleErrors).toEqual([]);
  });

  test.fixme("generates ideas with a connected provider and promotes one to a plan", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Select the connected Umans provider and generate ideas from the overflow menu.
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Umans" }).click();
    await page.getByTitle("Idea generation actions").click();
    await page.getByTitle("Quick freeform idea generation in the chat").click();
    // Two idea cards render with promote actions.
    await expect(page.locator(".chat-idea-card")).toHaveCount(2);
    await expect(page.locator(".chat-idea-title").first()).toHaveText("Improve onboarding");

    // Promote the first idea → it becomes planned and appears in the plan pipeline.
    await page.locator(".chat-idea-card button", { hasText: "Promote" }).first().click();
    await expect(page.locator(".chat-idea-status", { hasText: "Planned" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test.fixme("handles slash commands locally", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.getByTitle(/Chat input/).first().fill("/model glm");
    await page.getByTitle("Send message").click();
    await expect(page.locator('.provider-catalog-overlay[aria-label="Provider and model catalog"]')).toBeVisible();
    await page.locator(".provider-card", { hasText: "Umans" }).click();
    await expect(page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" })).toBeVisible();
    await page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).click();
    await expect(page.locator(".chat-model-trigger")).toContainText("Umans GLM 5.2");

    await page.getByTitle(/Chat input/).first().fill("/models refresh");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-command-notice")).toContainText("Model catalog refreshed.");

    await page.getByTitle(/Chat input/).first().fill("/wat");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-command-notice")).toContainText("Unknown slash command");
    await expect(page.getByTitle("Send this slash-prefixed text as a normal message")).toBeVisible();
  });

  test("skill send renders a command chip and trailing text, not the raw skill body", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();
    // Send is a silent no-op until the native session binds and the provider
    // switch settles — wait for both before clicking (fixture rows would
    // otherwise satisfy `.last()` visibility vacuously).
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");
    const usersBefore = await page.locator(".chat-message-user").count();

    await page.getByTitle(/Chat input/).first().fill("/skill:caveman hello world");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1, { timeout: 10_000 });
    // Fixture messages carry future timestamps, so the new row is NOT last in
    // the chronologically-sorted transcript — select it by its trailing text.
    const userRow = page.locator(".chat-message-user").filter({ hasText: "hello world" });
    // Chip shows the command name.
    const chip = userRow.locator(".chat-command-chip");
    await expect(chip).toContainText("/skill:caveman");
    // Trailing user text is shown, not the skill body.
    await expect(userRow).toContainText("hello world");
    await expect(userRow).not.toContainText("Speak in short grunts");

    // Clicking the chip opens the payload modal with the full body.
    await chip.click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".modal-header h2")).toContainText("/skill:caveman");
    await expect(modal.locator(".command-payload-pre")).toContainText("Speak in short grunts");
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  test("assistant message shows the selected model label, not 'Basebuild'", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");
    const assistantsBefore = await page.locator(".chat-message-assistant").count();

    await page.getByTitle(/Chat input/).first().fill("model-label-test");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-assistant")).toHaveCount(assistantsBefore + 1, { timeout: 10_000 });
    const assistantRow = page.locator(".chat-message-assistant").last();
    const role = assistantRow.locator(".chat-message-role");
    await expect(role).toContainText("Local Coordinator");
    await expect(role).not.toContainText("Basebuild");
  });

  test("user and assistant messages are full-width left-aligned", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");
    const usersBefore = await page.locator(".chat-message-user").count();

    await page.getByTitle(/Chat input/).first().fill("alignment-test");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-message-user")).toHaveCount(usersBefore + 1, { timeout: 10_000 });

    const userRow = page.locator(".chat-message-user").last();
    const assistantRow = page.locator(".chat-message-assistant").last();
    await expect(assistantRow).toBeVisible({ timeout: 10_000 });

    const userBox = await userRow.boundingBox();
    const assistantBox = await assistantRow.boundingBox();
    const messagesBox = await page.locator(".chat-messages").first().boundingBox();
    expect(userBox).toBeTruthy();
    expect(assistantBox).toBeTruthy();
    expect(messagesBox).toBeTruthy();
    // Both rows span nearly the full width of the scroll container.
    expect(userBox!.width).toBeGreaterThan(messagesBox!.width * 0.9);
    expect(assistantBox!.width).toBeGreaterThan(messagesBox!.width * 0.9);
    // User row has the distinctive left accent border.
    await expect(userRow).toHaveCSS("border-left-color", "rgb(255, 86, 6)");
  });

  test("elapsed badge reads in conversational units", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").click();
    await page.locator(".provider-card", { hasText: "Basebuild Local" }).click();
    await page.getByTitle("Close provider and model catalog").click();
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");

    await page.getByTitle(/Chat input/).first().fill("stream-test");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();

    // The streaming assistant row shows an elapsed badge with readable text.
    const badge = page.locator(".chat-message-assistant .chat-elapsed-badge").first();
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toContainText(/\d+ second/);
  });
});

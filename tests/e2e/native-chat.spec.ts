import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

test.describe("native chat workspace", () => {
  test("shows catalog readiness while preserving the chat surface", async ({ page }) => {
    await page.addInitScript(() => {
      (window as typeof window & { __BASEBUILD_E2E_BOOTSTRAP_DELAY_MS__?: number })
        .__BASEBUILD_E2E_BOOTSTRAP_DELAY_MS__ = 2_000;
    });
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const modelChip = page.locator(".chat-column-model-chip").first();
    await expect(modelChip).toHaveAttribute("title", /Provider catalog is loading/);
    await expect(modelChip.locator(".spin")).toBeVisible();
    await expect(modelChip).not.toContainText("No model selected");
    await expect(modelChip).not.toHaveAttribute("title", /Provider catalog is loading/, { timeout: 5_000 });
  });

  test("creates a native chat tab and records a structured turn", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Model, effort, permissions, and context are consolidated in the header.
    await expect(page.locator(".chat-column-model-chip")).toBeVisible();
    await expect(page.locator(".chat-header-select[aria-label='Effort level']")).toBeVisible();
    await expect(page.locator(".chat-header-select[aria-label='Permission mode']")).toBeVisible();
    const context = page.locator(".chat-header-context");
    await expect(context).toHaveAttribute("title", /Context usage: 0 .*tokens/);
    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });

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

    // The latest request updates the session-scoped context indicator.
    await expect(context).not.toHaveAttribute("title", /Context usage: 0 .*tokens/);

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

    await page.locator(".chat-column-model-chip").click();
    const catalogModal = page.locator('.provider-catalog-overlay[aria-label="Provider and model catalog"]');
    await expect(catalogModal).toBeVisible();
    await expect(catalogModal.locator(".provider-card.is-connected").first()).toBeVisible();
    await expect(catalogModal.locator(".provider-status.is-connected").first()).toContainText("Connected");
    await catalogModal.locator(".provider-card[title^='OpenAI API:']").click();
    await page.getByTitle("Close provider and model catalog").click();

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

  test("keeps idea generation live in the selected chat", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Select the connected Umans provider and generate ideas from the overflow menu.
    await page.locator(".chat-column-model-chip").click();
    await page.locator(".provider-card", { hasText: "Umans" }).click();
    await page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first().click();
    await page.getByTitle(/Chat input/).first().fill("/idea generate");
    await page.getByTitle("Send message").click();

    // The first synchronous backend status event must be visible in this chat,
    // and chat-owned generation must not consume a background-agent slot.
    await expect(page.locator(".chat-thinking-indicator")).toBeVisible();
    await expect(page.locator(".bg-agents-badge")).toHaveCount(0);
    await expect(page.locator(".chat-message-assistant", { hasText: "inspect the project" })).toBeVisible();
    await expect(page.locator(".tool-card", { hasText: "Read the project schematic" })).toBeVisible();


    expect(consoleErrors).toEqual([]);
  });

  test("opens a chat-bound background run from the full run row", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    const activeChatId = await page.locator(".chat-panel").first().getAttribute("data-native-session-id");
    if (!activeChatId) throw new Error("Active native chat is unavailable");

    const backgroundChatId = await page.evaluate(async ({ activeChatId }) => {
      const w = window as typeof window & {
        __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
        __emit?: (event: string, payload: unknown) => void;
      };
      const invoke = w.__basebuildInvoke;
      if (!invoke) throw new Error("E2E fixture unavailable");
      const activeChat = await invoke("native_chat_get", { sessionId: activeChatId }) as { projectPath: string };
      const projectPath = activeChat.projectPath;
      const sessions = await invoke("list_sessions", { projectPath }) as { id: string }[];
      const sessionId = sessions[0]?.id;
      if (!sessionId) throw new Error("Active workspace session is unavailable");

      const chat = await invoke("native_chat_start", {
        request: {
          projectPath,
          title: "Background plan chat",
          providerId: "umans",
          modelId: "umans-glm-5.2",
          effortLevel: "medium",
        },
      }) as { id: string };
      const plan = await invoke("create_plan", {
        input: {
          sessionId,
          title: "Background plan",
          description: "Inspect this run from the taskbar.",
        },
      }) as { id: string };
      await invoke("plan_assign_to_chat", {
        planId: plan.id,
        chatSessionId: chat.id,
      });
      w.__emit?.("planning://event", {
        kind: "plan_updated",
        entityId: plan.id,
        projectPath,
        sessionId,
        title: "Background plan",
        seq: 1,
        ts: Math.floor(Date.now() / 1000),
      });
      return chat.id;
    }, { activeChatId });

    const taskbarButton = page.locator(".bg-agents-btn");
    await expect(taskbarButton).toHaveAttribute("title", "1 background agent active", { timeout: 5_000 });
    await taskbarButton.click();
    const running = page.locator(".bg-agents-item.is-running").filter({ hasText: "Background plan" });
    await expect(running).toBeVisible({ timeout: 5_000 });
    await running.getByTitle("Open the chat where this agent is working").click();

    await expect(page.locator(`.chat-panel[data-native-session-id="${backgroundChatId}"]`)).toBeVisible();
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
    await expect(page.locator(".chat-column-model-chip")).toContainText("Umans GLM 5.2");

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

    await selectLocalProvider(page);
    // Send is a silent no-op until the native session binds and the provider
    // switch settles — wait for both before clicking (fixture rows would
    // otherwise satisfy `.last()` visibility vacuously).
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-column-model-chip")).toContainText("None");
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

    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-column-model-chip")).toContainText("None");
    const assistantsBefore = await page.locator(".chat-message-assistant").count();

    await page.getByTitle(/Chat input/).first().fill("model-label-test");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-assistant")).toHaveCount(assistantsBefore + 1, { timeout: 10_000 });
    const assistantRow = page.locator(".chat-message-assistant").last();
    const role = assistantRow.locator(".chat-message-role");
    await expect(role).toContainText("None");
    await expect(role).not.toContainText("Basebuild");
  });

  test("user and assistant messages are full-width left-aligned", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-column-model-chip")).toContainText("None");
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
  });

  test("elapsed badge reads in conversational units", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    await expect(page.locator(".chat-column-model-chip")).toContainText("None");
    const input = page.getByTitle(/Chat input/).first();
    await input.fill("stream-test elapsed");
    await expect(page.getByTitle("Send message")).toBeEnabled();
    await page.getByTitle("Send message").click();

    // The streaming assistant row shows an elapsed badge with readable text.
    const badge = page.locator(".chat-message-assistant .chat-elapsed-badge").first();
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toContainText(/\d+ second/);
  });
});

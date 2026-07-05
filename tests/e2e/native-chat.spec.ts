import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" })).toBeVisible();
}

async function ensureChatTab(page: Page) {
  await page.waitForTimeout(1500);
  const chatTab = page.locator('.workspace-tab[title^="Chat"] .workspace-tab-label').first();
  const count = await chatTab.count();
  if (count > 0) {
    await chatTab.click();
    return;
  }
  await page.getByTitle("New tab").click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
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
    await ensureChatTab(page);

    // The compact composer rail with provider/model/effort controls should be visible.
    await expect(page.locator(".chat-composer-header")).toBeVisible();
    await expect(page.locator(".chat-provider-trigger")).toBeVisible();
    await expect(page.locator(".chat-model-trigger")).toBeVisible();
    await expect(page.locator(".chat-effort-select")).toHaveValue("medium");
    await expect(page.locator(".chat-provider-trigger")).toContainText("Basebuild Local");

    // Metrics bar should render with 0 req initially.
    await expect(page.locator(".chat-metrics")).toContainText("0 req");

    // Type and send a message.
    await page.getByTitle(/Chat input/).first().fill("Hello native harness");
    await page.getByTitle("Send message").click();

    // The user and assistant messages should render.
    await expect(page.locator(".chat-message-user")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant .chat-message-content")).toContainText("Native harness echo");

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
    await ensureChatTab(page);

    // Select the OpenAI provider which is unconfigured in the fixture.
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".chat-picker-item", { hasText: "OpenAI" }).click();

    // The composer shows a degraded setup state and a Connect affordance.
    await expect(page.locator(".chat-provider-trigger")).toContainText("OpenAI");
    await expect(page.locator(".chat-provider-trigger")).toHaveClass(/is-warn/);
    await expect(page.locator(".chat-composer-header button[title*='Connect']")).toBeVisible();

    // Attempting to send opens the connect prompt and keeps the draft; no turn is sent.
    await page.getByTitle(/Chat input/).first().fill("should not send yet");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-login-form")).toBeVisible();
    await expect(page.locator(".chat-login-form input[placeholder='API key']")).toBeVisible();
    await expect(page.locator(".chat-link-btn", { hasText: "Get API key" })).toBeVisible();
    await expect(page.locator(".chat-message-user")).toHaveCount(0);
    await expect(page.getByTitle(/Chat input/).first()).toHaveValue("should not send yet");

    expect(consoleErrors).toEqual([]);
  });

  test("generates ideas with a connected provider and promotes one to a plan", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatTab(page);

    // Select the connected Umans provider and generate ideas from the overflow menu.
    await page.locator(".chat-provider-trigger").click();
    await page.locator(".chat-picker-item", { hasText: "Umans" }).click();
    await page.getByTitle("More chat actions").click();
    await page.getByTitle("Quick freeform idea generation in the chat").click();
    // Two idea cards render with promote actions.
    await expect(page.locator(".chat-idea-card")).toHaveCount(2);
    await expect(page.locator(".chat-idea-title").first()).toHaveText("Improve onboarding");

    // Promote the first idea → it becomes planned and appears in the plan pipeline.
    await page.locator(".chat-idea-card button", { hasText: "Promote" }).first().click();
    await expect(page.locator(".chat-idea-status", { hasText: "Planned" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("handles slash commands locally", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatTab(page);

    await page.getByTitle(/Chat input/).first().fill("/model glm");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-picker", { hasText: "Choose model" })).toBeVisible();
    await expect(page.locator(".chat-picker-item", { hasText: "Umans GLM 5.2" })).toBeVisible();
    await page.locator(".chat-picker-item", { hasText: "Umans GLM 5.2" }).click();
    await expect(page.locator(".chat-model-trigger")).toContainText("Umans GLM 5.2");

    await page.getByTitle(/Chat input/).first().fill("/models refresh");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-command-notice")).toContainText("Model catalog refreshed.");

    await page.getByTitle(/Chat input/).first().fill("/wat");
    await page.getByTitle("Send message").click();
    await expect(page.locator(".chat-command-notice")).toContainText("Unknown slash command");
    await expect(page.getByTitle("Send this slash-prefixed text as a normal message")).toBeVisible();
  });
});

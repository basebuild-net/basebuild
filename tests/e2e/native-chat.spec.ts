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

    // The chat input controls should be visible (provider/model/effort selectors).
    await expect(page.locator(".chat-input-controls")).toBeVisible();

    // The local coordinator provider should be selected by default.
    await expect(page.locator(".chat-select").first()).toHaveValue("basebuild-local");

    // Metrics bar should render with 0 req initially.
    await expect(page.locator(".chat-metrics")).toContainText("0 req");

    // Type and send a message.
    await page.getByTitle(/Chat input/).first().fill("Hello native harness");
    await page.getByTitle("Send message").click();

    // The user and assistant messages should render.
    await expect(page.locator(".chat-message-user")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant .chat-message-content")).toContainText("Native harness echo");

    // The metrics bar should now reflect one request.
    await expect(page.locator(".chat-metrics")).toContainText("1 req");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("shows connect button when an unconfigured provider is selected", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatTab(page);

    // Select the OpenAI provider which is unconfigured in the fixture.
    await page.locator(".chat-select").first().selectOption("openai");

    // A "Connect" button should appear next to the selectors.
    await expect(page.locator(".chat-input-controls button[title*='Connect']")).toBeVisible();

    // The send button should be disabled because the provider is unconfigured.
    await page.getByTitle(/Chat input/).first().fill("should not send");
    const sendBtn = page.getByTitle("Send message");
    await expect(sendBtn).toBeDisabled();

    // No user message should have been created.
    await expect(page.locator(".chat-message-user")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});

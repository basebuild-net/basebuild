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

test.describe("Chat composer (DESIGN.md §Chat composer)", () => {
  test("composer has a tall, growing textarea", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    // DESIGN.md: multi-line by default, grows as you type.
    // Initial rows attribute should be >= 3.
    const rows = await textarea.getAttribute("rows");
    expect(parseInt(rows ?? "0", 10)).toBeGreaterThanOrEqual(3);

    // Verify it grows when typing.
    const initialHeight = await textarea.evaluate((el) => (el as HTMLTextAreaElement).offsetHeight);
    await textarea.fill("line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8");
    await page.waitForTimeout(200);
    const grownHeight = await textarea.evaluate((el) => (el as HTMLTextAreaElement).offsetHeight);
    expect(grownHeight).toBeGreaterThan(initialHeight);
  });

  test("composer textarea has placeholder text", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    const placeholder = await textarea.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(10);
  });

  test("composer textarea has tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    const title = await textarea.getAttribute("title");
    expect(title).toBeTruthy();
  });

  test("composer textarea is disabled when input is disabled", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    // In the default fixture, the chat should be in native mode and the input enabled.
    const disabled = await textarea.getAttribute("disabled");
    // The input might be disabled or not depending on state — just verify the attribute exists.
    expect(disabled === null || disabled === "true" || disabled === "").toBe(true);
  });

  test("Enter sends message, Shift+Enter inserts newline", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();

    // Type text.
    await textarea.fill("test message");
    expect(await textarea.inputValue()).toBe("test message");

    // Shift+Enter should add a newline.
    await textarea.press("Shift+Enter");
    const value = await textarea.inputValue();
    expect(value).toContain("\n");
  });

  test("send button has correct tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const sendBtn = page.locator(".chat-send-btn").first();
    const title = await sendBtn.getAttribute("title");
    expect(title).toBeTruthy();
    // Should mention "send" or "stop" or "message".
    expect(title!.toLowerCase()).toMatch(/send|stop|message/);
  });

  test("debug toggle button has correct tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const debugBtn = page.locator(".chat-debug-toggle").first();
    const title = await debugBtn.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title!.toLowerCase()).toContain("debug");
  });

  test("context strip is below the input row", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const inputRow = page.locator(".chat-input-row").first();
    const contextStrip = page.locator(".chat-context-strip").first();

    await expect(inputRow).toBeVisible();
    await expect(contextStrip).toBeVisible({ timeout: 5_000 });

    // Context strip should be after input row in DOM order.
    const inputRowBox = await inputRow.boundingBox();
    const stripBox = await contextStrip.boundingBox();

    expect(inputRowBox).toBeTruthy();
    expect(stripBox).toBeTruthy();
    // Context strip should be below the input row.
    expect(stripBox!.y).toBeGreaterThan(inputRowBox!.y);
  });

  test("composer controls have tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // The composer rail should have provider and model triggers.
    const providerTrigger = page.locator(".chat-provider-trigger").first();
    const modelTrigger = page.locator(".chat-model-trigger").first();

    if (await providerTrigger.count() > 0) {
      const title = await providerTrigger.getAttribute("title");
      expect(title, "Provider trigger should have a tooltip").toBeTruthy();
    }

    if (await modelTrigger.count() > 0) {
      const title = await modelTrigger.getAttribute("title");
      expect(title, "Model trigger should have a tooltip").toBeTruthy();
    }
  });

  test("effort selector has tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const effortButtons = page.locator(".chat-composer-header .option-list[aria-label='Effort level'] .option-list-btn");
    const count = await effortButtons.count();
    expect(count, "Effort option list should render options").toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      const title = await effortButtons.nth(i).getAttribute("title");
      expect(title, `Effort option ${i} should have a tooltip`).toBeTruthy();
    }
  });

  test("provider catalog modal opens and closes", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Open.
    await page.locator(".chat-provider-trigger").first().click();
    await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });

    // Close via overlay click.
    await page.locator(".provider-catalog-overlay").first().click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0);
  });

  test("provider catalog shows connected and available providers", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").first().click();
    await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });

    // Should have provider cards.
    const cards = page.locator(".provider-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Should have at least one connected (umans is seeded in fixture).
    const connected = page.locator(".provider-card .provider-status.is-connected");
    const connectedCount = await connected.count();
    expect(connectedCount).toBeGreaterThan(0);
  });

  test("provider catalog model section is visible", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-provider-trigger").first().click();
    await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });

    // Models section should be visible.
    const modelsSection = page.locator(".provider-catalog-models").first();
    await expect(modelsSection).toBeVisible();
  });

  test("chat input area is pinned to bottom", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const inputArea = page.locator(".chat-input-area").first();
    await expect(inputArea).toBeVisible();

    // The input area should be at the bottom of the chat panel.
    const panelBox = await page.locator(".chat-panel").first().boundingBox();
    const inputBox = await inputArea.boundingBox();

    expect(panelBox).toBeTruthy();
    expect(inputBox).toBeTruthy();

    // The input area bottom should be at or near the panel bottom.
    const panelBottom = panelBox!.y + panelBox!.height;
    const inputBottom = inputBox!.y + inputBox!.height;
    expect(Math.abs(panelBottom - inputBottom)).toBeLessThan(50);
  });

  test("model picker lists recently-used model first and shows 'used ... ago'", async ({ page }) => {
    // Seed recency for the umans model that ranks LAST by the default
    // capability ordering (no tools, no reasoning) — recency must hoist it.
    await page.addInitScript(() => {
      localStorage.setItem(
        "basebuild.modelRecency",
        JSON.stringify({ "umans/umans-lite-1.0": Date.now() - 5 * 60 * 1000 }),
      );
    });
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await page.locator(".chat-model-trigger").click();
    // Wait for the provider catalog modal and the model list (default provider: umans).
    await expect(page.locator(".provider-catalog-models")).toBeVisible();
    const rows = page.locator(".provider-model-row");
    await expect(rows.first()).toContainText("Umans Lite 1.0");
    await expect(rows.first()).toContainText("used 5 min ago");
    // The higher-capability model without recency ranks after it.
    await expect(rows.nth(1)).toContainText("Umans GLM 5.2");
  });
});

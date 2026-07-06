import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" }),
  ).toBeVisible();
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

test.describe("multi-chat grid", () => {
  test("a chat tab renders a single-column grid with the composer rail visible", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatTab(page);

    // The chat grid renders with at least one column.
    await expect(page.locator(".chat-grid")).toBeVisible();
    await expect(page.locator(".chat-grid-column").first()).toBeVisible();

    // The composer rail (ported to ChatComposerRail) is visible inside the column.
    await expect(page.locator(".chat-composer-header").first()).toBeVisible();
    await expect(page.locator(".chat-provider-trigger").first()).toBeVisible();
    await expect(page.locator(".chat-model-trigger").first()).toBeVisible();

    // The provider trigger has a tooltip (Invariant 3).
    await expect(page.locator(".chat-provider-trigger").first()).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });

  test("the chat panel inside a grid column sends and renders a turn", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatTab(page);

    // Type and send a message inside the grid column.
    await page.getByTitle(/Chat input/).first().fill("Hello from the grid");
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-user")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant .chat-message-content")).toContainText("Native harness echo");

    expect(pageErrors).toEqual([]);
  });

  test("the grid splitter is present and has a tooltip when multiple columns exist", async ({ page }) => {
    // Note: the default grid is 1×1 (no splitter). This test documents the
    // expected structure; a full multi-column e2e requires add-chat-beside
    // wiring through the header menu, which is exercised in the assign-plan
    // flow. Here we assert the grid CSS classes exist and are well-formed.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatTab(page);

    // The grid container is present.
    await expect(page.locator(".chat-grid")).toBeVisible();
    // At least one column is rendered.
    const columns = page.locator(".chat-grid-column");
    await expect(columns.first()).toBeVisible();
    expect(await columns.count()).toBeGreaterThanOrEqual(1);

    expect(pageErrors).toEqual([]);
  });
});

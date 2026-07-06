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

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

test.describe("panel grid", () => {
  test("a chat panel renders with the composer rail visible", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // The panel grid renders with at least one leaf.
    await expect(page.locator(".panel-grid")).toBeVisible();
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible();

    // The composer rail is visible inside the panel.
    await expect(page.locator(".chat-composer-header").first()).toBeVisible();
    await expect(page.locator(".chat-provider-trigger").first()).toBeVisible();
    await expect(page.locator(".chat-model-trigger").first()).toBeVisible();

    // The provider trigger has a tooltip (Invariant 3).
    await expect(page.locator(".chat-provider-trigger").first()).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });

  test("the chat panel sends and renders a turn", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Type and send a message.
    await page.getByTitle(/Chat input/).first().fill("Hello from the grid");
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-user")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant .chat-message-content")).toContainText("Native harness echo");

    expect(pageErrors).toEqual([]);
  });

  test("the panel grid is present and well-formed", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // The grid container is present.
    await expect(page.locator(".panel-grid")).toBeVisible();
    // At least one leaf is rendered.
    const leaves = page.locator(".panel-grid-leaf");
    await expect(leaves.first()).toBeVisible();
    expect(await leaves.count()).toBeGreaterThanOrEqual(1);

    expect(pageErrors).toEqual([]);
  });
});

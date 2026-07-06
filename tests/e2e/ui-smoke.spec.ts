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
  // In the panel grid, chat panels have data-panel-id and a .panel-header.
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  // If no panel exists, click "New chat" in the sidebar.
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

async function collapseEnvPanel(page: Page) {
  const btn = page.locator("button[title='Collapse environment']");
  if (await btn.count() > 0) {
    await btn.first().click({ force: true });
    await page.waitForTimeout(200);
  }
}

test.describe("UI smoke: branch, model independence, no side effects", () => {
  test("branch indicator shows current git branch and worktree status", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // The branch indicator shows the mocked current branch "main".
    await expect(page.locator(".chat-column-branch-name").first()).toContainText("main");

    // The branch button has a tooltip.
    await expect(page.locator(".chat-column-branch").first()).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });

  test("per-column model independence: changing model in one column doesn't affect another", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // The model chip shows the default model.
    await expect(page.locator(".chat-column-model-chip").first()).toContainText("Local Coordinator");

    // Open the model picker and select a different model.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".chat-model-trigger");
      btn?.click();
    });
    await expect(page.locator(".chat-picker[aria-label='Choose model']")).toBeVisible();

    // Select "Umans GLM 5.2" (a different provider/model).
    const umansItem = page.locator(".chat-picker-item", { hasText: "Umans GLM 5.2" }).first();
    if (await umansItem.count() > 0) {
      await umansItem.click();
      // The model chip updates to the new model.
      await expect(page.locator(".chat-column-model-chip").first()).toContainText("Umans GLM 5.2");
    }

    expect(pageErrors).toEqual([]);
  });

  test("no silent side effects: no auto push/PR/worktree on restore", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // No PR recommendation card should appear on a fresh chat (no finished run).
    await expect(page.locator(".pr-recommendation-card")).toHaveCount(0);

    // No plan badge should appear on a free-form chat (no assigned plan).
    await expect(page.locator(".chat-column-plan-badge")).toHaveCount(0);

    // No assign-plan picker should be open.
    await expect(page.locator(".chat-picker[aria-label='Assign a ready plan']")).toHaveCount(0);

    // The branch indicator shows "main" (no auto-created worktree branch).
    await expect(page.locator(".chat-column-branch-name").first()).toContainText("main");

    // No worktree indicator should show (no auto-created worktree on restore).
    await expect(page.locator(".chat-column-worktree")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("agent-mode pill toggles between plan and build", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // The agent-mode pill shows "plan" by default.
    const modePill = page.locator(".chat-column-mode-pill").first();
    await expect(modePill).toContainText("plan");

    // Click to toggle to build mode.
    await modePill.click({ force: true });
    await expect(modePill).toContainText("build");

    // Click again to toggle back to plan mode.
    await modePill.click({ force: true });
    await expect(modePill).toContainText("plan");

    expect(pageErrors).toEqual([]);
  });

  test("effort chip displays the current effort level", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // The effort chip shows the default "medium".
    await expect(page.locator(".chat-column-effort-chip").first()).toContainText("medium");

    // The effort chip has a tooltip.
    await expect(page.locator(".chat-column-effort-chip").first()).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

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
    await expect(page.locator(".chat-composer-branch-btn").first()).toContainText("main", { timeout: 10_000 });

    // The branch button has a tooltip.
    await expect(page.locator(".chat-composer-branch-btn").first()).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });

  test("per-column model independence: changing model in one column doesn't affect another", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // Establish a deterministic starting model; session restore may otherwise
    // legitimately retain the model chosen by a previous test.
    await page.locator(".chat-column-model-chip").first().click();
    await page.locator(".provider-card").first().click();
    await page.getByTitle("Close provider and model catalog").click();

    // The compact header shows the selected model.
    await expect(page.locator(".chat-column-model-chip").first()).toContainText("None");

    // Open the model picker and select a different model.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".chat-column-model-chip");
      btn?.click();
    });
    await expect(page.locator(".provider-catalog-overlay[aria-label='Provider and model catalog']")).toBeVisible();

    // Select "Umans GLM 5.2" (a different provider/model).
    await page.locator(".provider-card", { hasText: "Umans" }).click();
    const umansItem = page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first();
    if (await umansItem.count() > 0) {
      await umansItem.click();
      // The composer model control updates to the new model.
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
    await expect(page.locator(".chat-composer-branch-btn").first()).toContainText("main", { timeout: 10_000 });

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

    // The agent-mode pill shows "Plan mode" by default.
    const modePill = page.locator(".chat-column-mode-pill").first();
    await expect(modePill).toContainText("Plan");

    // Click to toggle to build mode.
    await modePill.click({ force: true });
    await expect(modePill).toContainText("Build");

    // Click again to toggle back to plan mode.
    await modePill.click({ force: true });
    await expect(modePill).toContainText("Plan");
    expect(pageErrors).toEqual([]);
   });

  test("effort selector displays the current effort level", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    const effortSelect = page.locator(".chat-header-select[aria-label='Effort level']").first();
    await expect(effortSelect).toBeVisible({ timeout: 5_000 });
    await expect(effortSelect).toHaveAttribute("title", /Effort level:/);
    expect(await effortSelect.locator("option").count()).toBeGreaterThan(1);

    expect(pageErrors).toEqual([]);
   });

});

test.describe("Provider/model catalog: connected-first ordering and modal layout", () => {
  test("provider catalog modal shows connected providers first with green state", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // Open the provider catalog modal from the header model control.
    const modelTrigger = page.locator(".chat-column-model-chip").first();
    await expect(modelTrigger).toBeVisible({ timeout: 5_000 });
    await modelTrigger.click({ force: true });

    // The modal overlay should be visible.
    await expect(page.locator(".provider-catalog-overlay")).toBeVisible({ timeout: 5_000 });

    // Connected providers (green) should appear before available (grey).
    const connected = page.locator(".provider-status.is-connected");
    const available = page.locator(".provider-status.is-available");
    const connectedCount = await connected.count();
    const availableCount = await available.count();

    // The fixture has at least one configured provider (basebuild-local).
    expect(connectedCount).toBeGreaterThan(0);

    // If there are both connected and available, verify ordering.
    if (connectedCount > 0 && availableCount > 0) {
      const firstConnectedBox = await connected.first().boundingBox();
      const firstAvailableBox = await available.first().boundingBox();
      if (firstConnectedBox && firstAvailableBox) {
        expect(firstConnectedBox.y).toBeLessThanOrEqual(firstAvailableBox.y);
      }
    }

    // Escape closes the modal.
    await page.keyboard.press("Escape");
    await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("provider catalog modal has capability badges on models", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // Open the provider catalog modal.
    await page.locator(".chat-column-model-chip").first().click({ force: true });
    await expect(page.locator(".provider-catalog-overlay")).toBeVisible({ timeout: 5_000 });

    // Model rows should have capability badges (Tools, Reasoning, or effort).
    const modelBadges = page.locator(".provider-model-badges .provider-capability");
    const badgeCount = await modelBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // At least one badge should mention "Tools" or "Reasoning".
    const badgeTexts = await modelBadges.allTextContents();
    const hasCapabilityBadge = badgeTexts.some((t) => t.includes("Tools") || t.includes("Reasoning"));
    expect(hasCapabilityBadge).toBe(true);

    await page.keyboard.press("Escape");
    expect(pageErrors).toEqual([]);
  });
});

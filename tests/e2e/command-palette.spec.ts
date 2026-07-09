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

test.describe("Command palette (chat-command-palette)", () => {
  test("typing / opens the command palette", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await textarea.fill("/");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
  });

  test("palette shows command names and descriptions", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
    // Should contain built-in commands.
    await expect(palette.locator(".command-palette-name", { hasText: /^\/clear$/ })).toBeVisible();
    await expect(palette.locator(".command-palette-name", { hasText: /^\/model$/ })).toBeVisible();
    await expect(palette.locator(".command-palette-name", { hasText: /^\/new$/ })).toBeVisible();
    await expect(palette.locator(".command-palette-name", { hasText: /^\/help$/ })).toBeVisible();
  });

  test("typing a filter narrows the palette", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/mo");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
    // /model should be visible.
    await expect(palette.locator(".command-palette-name", { hasText: /^\/model$/ })).toBeVisible();
    // /clear should NOT be visible (filtered out).
    await expect(palette.locator(".command-palette-name", { hasText: /^\/clear$/ })).toHaveCount(0);
  });

  test("Escape closes the palette", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/");
    await page.waitForTimeout(200);
    await expect(page.locator(".command-palette").first()).toBeVisible({ timeout: 3_000 });

    await textarea.press("Escape");
    await page.waitForTimeout(200);
    await expect(page.locator(".command-palette")).toHaveCount(0);
  });

  test("Commands button opens the palette", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const commandsBtn = page.getByTitle("Open the command palette — browse and insert slash commands").first();
    await expect(commandsBtn).toBeVisible({ timeout: 5_000 });
    await commandsBtn.click();
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
  });

  test("ArrowDown moves the active selection", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });

    // First row should be active initially.
    const firstRow = palette.locator(".command-palette-row").first();
    await expect(firstRow).toHaveClass(/is-active/);

    // Press ArrowDown — second row should become active.
    await textarea.press("ArrowDown");
    await page.waitForTimeout(100);
    const secondRow = palette.locator(".command-palette-row").nth(1);
    await expect(secondRow).toHaveClass(/is-active/);
  });

  test("Tab completes the selected command into the composer", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/cl");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });

    // /clear should be the first match.
    await expect(palette.locator(".command-palette-row").first()).toContainText("/clear");

    // Tab should complete it.
    await textarea.press("Tab");
    await page.waitForTimeout(200);

    // The palette should close and the input should contain /clear.
    await expect(page.locator(".command-palette")).toHaveCount(0);
    const value = await textarea.inputValue();
    expect(value.trim()).toMatch(/^\/clear/);
  });

  test("helper text shows usage and arguments", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/model");
    await page.waitForTimeout(200);

    const helper = page.locator(".command-palette-helper").first();
    await expect(helper).toBeVisible({ timeout: 3_000 });
    await expect(helper).toContainText("/model");
  });

  test("source badges are present on command rows", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
    // Built-in commands should have a "Built-in" source badge.
    await expect(palette.locator(".command-palette-source").first()).toContainText("Built-in");
  });

  test("local-only badge is shown on built-in commands", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
    await expect(palette.locator(".command-palette-badge.is-local").first()).toBeVisible();
  });

  test("empty state shows when no commands match", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const textarea = page.locator(".chat-input").first();
    await textarea.fill("/zzzzz");
    await page.waitForTimeout(200);

    const palette = page.locator(".command-palette").first();
    await expect(palette).toBeVisible({ timeout: 3_000 });
    await expect(palette.locator(".command-palette-empty")).toBeVisible();
  });
});

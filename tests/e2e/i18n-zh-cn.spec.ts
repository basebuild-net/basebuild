import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

const SHOT_DIR = join("test-results", "i18n-zh-cn");
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "960x640", width: 960, height: 640 },
];
const PLAN_TOGGLE = ".chat-plan-toggle";
const PLAN_BAR = ".chat-notice-bar.is-plan";

/** Select a tools-capable route, as chat-plan-mode does; the mock ships Umans connected. */
async function selectToolsProvider(page: Page) {
  await page.locator(".chat-column-model-chip").first().click();
  await expect(page.locator(".provider-catalog-overlay")).toBeVisible({ timeout: 10_000 });
  await page.locator(".provider-card", { hasText: "Umans" }).first().click();
  const modelRow = page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first();
  await expect(modelRow).toBeVisible({ timeout: 5_000 });
  await modelRow.click();
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByTitle(/聊天输入/).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("发送消息").click();
}

async function openPlanningBoard(page: Page) {
  const indicator = page.locator('.planning-indicator[data-stage="plans"]').first();
  await indicator.waitFor({ state: "visible", timeout: 10_000 });
  await indicator.click();
  const dropdown = page.locator(".planning-notification-dropdown").first();
  await dropdown.waitFor({ state: "visible", timeout: 5_000 });
  await dropdown.getByRole("button", { name: "完整界面" }).click();
  await page.locator(".planning-inspector-modal, .modal-overlay").first().waitFor({ state: "visible", timeout: 5_000 });
}

test.describe("zh-CN UI language", () => {
  test("switches to 简体中文 in first run, persists across reload, and switches back", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });
    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toContainText("Choose your language", { timeout: 10_000 });
    await page.getByTitle("Use Simplified Chinese").click();
    await expect(modal).toContainText("选择语言");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.locale"))).toBe("zh-CN");

    await page.reload();
    await expect(modal).toContainText("选择语言", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    await page.getByTitle("使用英文").click();
    await expect(modal).toContainText("Choose your language");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.locale"))).toBe("en");
  });

  for (const vp of VIEWPORTS) {
    test(`first-run screen renders in zh-CN at ${vp.name}`, async ({ page }) => {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => {
        localStorage.removeItem("basebuild:first-run-complete");
        localStorage.setItem("basebuild.locale", "zh-CN");
      });
      await page.goto("/");
      await expect(page.locator(".modal-first-run")).toContainText("选择语言", { timeout: 10_000 });
      await expect(page.locator(".workspace-splash")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator(".modal-first-run")).toBeVisible();
      await page.screenshot({ path: join(SHOT_DIR, `first-run-${vp.name}.png`) });
    });

    test(`settings, chat plan bar, and planning board render in zh-CN at ${vp.name}`, async ({ page }) => {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => {
        localStorage.setItem("basebuild.locale", "zh-CN");
      });
      await openMvpFixtureProject(page);
      await waitForAppReady(page);

      // Signed in (MVP fixture): Settings lives in the account menu.
      await page.locator(".account-trigger").click();
      await page.locator('.account-dropdown button[title="打开设置"]').click();
      await page.locator(".settings-tab", { hasText: "外观" }).first().click();
      await expect(page.getByText("语言", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: join(SHOT_DIR, `settings-${vp.name}.png`) });
      await page.keyboard.press("Escape");

      // The fixture restores a chat panel; sendMessage waits for its zh-CN input.
      await selectToolsProvider(page);
      await sendMessage(page, "hello");
      await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("hello", { timeout: 15_000 });

      await page.locator(PLAN_TOGGLE).click();
      const bar = page.locator(PLAN_BAR);
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("button", { name: "批准计划" })).toBeVisible();
      await page.screenshot({ path: join(SHOT_DIR, `chat-plan-mode-${vp.name}.png`) });

      await openPlanningBoard(page);
      await page.screenshot({ path: join(SHOT_DIR, `planning-board-${vp.name}.png`) });
    });
  }
});

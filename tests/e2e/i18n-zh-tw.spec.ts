import { expect, test } from "@playwright/test";

test.describe("zh-TW UI language", () => {
  test("switches to 繁體中文 in first run, persists across reload, and switches back", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });
    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toContainText("Choose your language", { timeout: 10_000 });
    await page.getByTitle("Use Traditional Chinese").click();
    await expect(modal).toContainText("選擇語言");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.locale"))).toBe("zh-TW");

    await page.reload();
    await expect(modal).toContainText("選擇語言", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");

    await page.getByTitle("使用英文").click();
    await expect(modal).toContainText("Choose your language");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.locale"))).toBe("en");
  });
});

import { expect, test, type Page } from "@playwright/test";
import { openFixtureProject } from "./helpers";
async function openSettings(page: Page): Promise<void> {
  await openFixtureProject(page);
  await expect(page.locator(".workspace-splash")).toBeHidden({ timeout: 10_000 });
  await page.locator(".account-trigger").click();
  await page.getByTitle("Open settings").click();
  await expect(page.locator(".settings-modal")).toBeVisible();
}

test.describe("Theme switching via Settings", () => {
  test("theme tab is present in settings", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator(".settings-tab", { hasText: "Appearance" })).toBeVisible();
  });

  test("switching to light theme updates html attribute", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild.theme", "dark");
    });
    await openSettings(page);

    await page.locator(".settings-tab", { hasText: "Appearance" }).click();
    await page.locator(".theme-picker-card", { hasText: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
  });

  test("switching to dark theme updates html attribute", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild.theme", "light");
    });
    await openSettings(page);

    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
    await page.locator(".settings-tab", { hasText: "Appearance" }).click();
    await page.locator(".theme-picker-card", { hasText: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "dark");
  });

  test("theme persists across navigation", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild.theme", "light");
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
  });
});

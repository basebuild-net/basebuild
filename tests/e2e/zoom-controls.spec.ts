import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
}

test.describe("Zoom controls", () => {
  test("zoom indicator renders at bottom-right with 100% default", async ({ page }) => {
    await openApp(page);

    const indicator = page.locator(".zoom-indicator");
    await expect(indicator).toBeVisible({ timeout: 5_000 });

    // Default zoom should be 100%.
    await expect(indicator.locator("text=100%")).toBeVisible();
  });

  test("Ctrl+= increases zoom and updates indicator", async ({ page }) => {
    await openApp(page);

    const indicator = page.locator(".zoom-indicator");
    await expect(indicator).toBeVisible();

    // Press Ctrl+= to zoom in.
    await page.keyboard.down("Control");
    await page.keyboard.press("=");
    await page.keyboard.up("Control");

    // Indicator should now show 110%.
    await expect(indicator.locator("text=110%")).toBeVisible({ timeout: 2_000 });
  });

  test("Ctrl+- decreases zoom and Ctrl+0 resets", async ({ page }) => {
    await openApp(page);

    const indicator = page.locator(".zoom-indicator");

    // Zoom in first.
    await page.keyboard.down("Control");
    await page.keyboard.press("=");
    await page.keyboard.up("Control");
    await expect(indicator.locator("text=110%")).toBeVisible({ timeout: 2_000 });

    // Zoom out.
    await page.keyboard.down("Control");
    await page.keyboard.press("-");
    await page.keyboard.up("Control");
    await expect(indicator.locator("text=100%")).toBeVisible({ timeout: 2_000 });

    // Reset.
    await page.keyboard.down("Control");
    await page.keyboard.press("0");
    await page.keyboard.up("Control");
    await expect(indicator.locator("text=100%")).toBeVisible();
  });

  test("zoom indicator has title tooltip", async ({ page }) => {
    await openApp(page);

    const indicator = page.locator(".zoom-indicator");
    const title = await indicator.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title!).toContain("Zoom");
  });
});

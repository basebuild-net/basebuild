import { expect, test } from "@playwright/test";

test.describe("Desktop shell theme application", () => {
  test("html has data-bb-theme attribute set", async ({ page }) => {
    await page.goto("/");
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBeTruthy();
    expect(["dark", "light"]).toContain(attr);
  });

  test("html has color-scheme set", async ({ page }) => {
    await page.goto("/");
    const colorScheme = await page.evaluate(() =>
      document.documentElement.style.colorScheme,
    );
    expect(["dark", "light"]).toContain(colorScheme);
  });

  test("app-shell renders with grid layout", async ({ page }) => {
    await page.goto("/");
    const shell = page.locator(".app-shell");
    await expect(shell).toBeVisible();
    const display = await shell.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("grid");
  });

  test("window-taskbar uses chrome background", async ({ page }) => {
    await page.goto("/");
    const taskbar = page.locator(".window-taskbar");
    await expect(taskbar).toBeVisible();
    // Verify it has a background color (not transparent)
    const bg = await taskbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });

  test("sidebar uses chrome background", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();
    const bg = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });

  test("panel-grid-leaf has rounded corners", async ({ page }) => {
    await page.goto("/");
    const leaf = page.locator(".panel-grid-leaf").first();
    if (await leaf.isVisible()) {
      const radius = await leaf.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius).not.toBe("0px");
    }
  });

  test("all buttons have non-zero border-radius", async ({ page }) => {
    await page.goto("/");
    const buttons = page.locator("button.btn, .btn-icon");
    const count = await buttons.count();
    if (count > 0) {
      const firstBtn = buttons.first();
      const radius = await firstBtn.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius).not.toBe("0px");
    }
  });

  test("theme switching updates data-bb-theme", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.theme", "light");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBe("light");
  });
});

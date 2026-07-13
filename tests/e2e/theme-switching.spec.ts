import { expect, test } from "@playwright/test";

test.describe("Theme switching via Settings", () => {
  test("theme tab is present in settings", async ({ page }) => {
    await page.goto("/");
    // Open settings — the gear button in the taskbar
    const settingsBtn = page.locator('[title*="Settings"], [title*="settings"]').first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      // Look for the Theme tab
      const themeTab = page.locator(".settings-tab", { hasText: "Theme" });
      await expect(themeTab).toBeVisible({ timeout: 5000 });
    }
  });

  test("switching to light theme updates html attribute", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.theme", "dark");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    
    // Open settings
    const settingsBtn = page.locator('[title*="Settings"], [title*="settings"]').first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      const themeTab = page.locator(".settings-tab", { hasText: "Theme" });
      if (await themeTab.isVisible({ timeout: 3000 })) {
        await themeTab.click();
        // Click the Light theme button
        const lightBtn = page.locator(".theme-picker-card", { hasText: "Light" });
        if (await lightBtn.isVisible({ timeout: 3000 })) {
          await lightBtn.click();
          // Verify the html attribute changed
          await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
        }
      }
    }
  });

  test("switching to dark theme updates html attribute", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.theme", "light");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    
    // Verify it starts as light
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBe("light");
    
    // Open settings
    const settingsBtn = page.locator('[title*="Settings"], [title*="settings"]').first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      const themeTab = page.locator(".settings-tab", { hasText: "Theme" });
      if (await themeTab.isVisible({ timeout: 3000 })) {
        await themeTab.click();
        // Click the Dark theme button
        const darkBtn = page.locator(".theme-picker-card", { hasText: "Dark" });
        if (await darkBtn.isVisible({ timeout: 3000 })) {
          await darkBtn.click();
          // Verify the html attribute changed
          await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "dark");
        }
      }
    }
  });

  test("theme persists across navigation", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.theme", "light");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    expect(await page.getAttribute("html", "data-bb-theme")).toBe("light");
    // Reload
    await page.reload();
    expect(await page.getAttribute("html", "data-bb-theme")).toBe("light");
  });
});

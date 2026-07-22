import { expect, test } from "@playwright/test";
import { parseTheme, THEME_IDS, type AppTheme } from "../../src/state/useTheme";

// ─── Unit tests for theme parsing ───

test.describe("parseTheme", () => {
  test("accepts exact 'dark'", () => {
    expect(parseTheme("dark")).toBe("dark");
  });

  test("accepts exact 'light'", () => {
    expect(parseTheme("light")).toBe("light");
  });

  test("falls back to dark for null", () => {
    expect(parseTheme(null)).toBe("dark");
  });

  test("falls back to dark for empty string", () => {
    expect(parseTheme("")).toBe("dark");
  });

  test("falls back to dark for unsupported values", () => {
    expect(parseTheme("system")).toBe("dark");
    expect(parseTheme("basebuild-black")).toBe("dark");
    expect(parseTheme("DARK")).toBe("dark");
    expect(parseTheme("Light")).toBe("dark");
    expect(parseTheme(" dark ")).toBe("dark");
  });

  test("falls back to dark for malformed values", () => {
    expect(parseTheme("dark\x00")).toBe("dark");
    expect(parseTheme("<script>")).toBe("dark");
    expect(parseTheme("javascript:void(0)")).toBe("dark");
  });

  test("THEME_IDS contains exactly dark, dark-green, and light", () => {
    expect(THEME_IDS).toEqual(["dark", "dark-green", "light"]);
  });
});

// ─── Integration tests for theme application ───

test.describe("theme application", () => {
  test("bootstrap sets data-bb-theme before paint", async ({ page }) => {
    await page.goto("/");
    // The bootstrap script should have set the theme attribute on <html>
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBeTruthy();
    expect(["dark", "light"]).toContain(attr);
  });

  test("bootstrap sets color-scheme", async ({ page }) => {
    await page.goto("/");
    const colorScheme = await page.evaluate(() =>
      document.documentElement.style.colorScheme,
    );
    expect(["dark", "light"]).toContain(colorScheme);
  });

  test("invalid stored value falls back to dark", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.theme", "invalid-theme");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBe("dark");
  });

  test("valid light value is applied from storage", async ({ page }) => {
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

  test("missing storage falls back to dark", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("basebuild.theme");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBe("dark");
  });

  test("storage failure does not crash startup", async ({ page }) => {
    // Simulate storage failure by overriding localStorage to throw
    await page.addInitScript(() => {
      const original = window.localStorage;
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("SecurityError");
        },
        configurable: true,
      });
    });
    await page.goto("/");
    const attr = await page.getAttribute("html", "data-bb-theme");
    expect(attr).toBe("dark");
  });
});

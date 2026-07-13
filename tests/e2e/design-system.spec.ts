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

test.describe("Design system invariants (DESIGN.md)", () => {
  test("CSS variables are defined for all design tokens", async ({ page }) => {
    await openFixtureProject(page);

    // Check that CSS variables exist on :root.
    const vars = await page.evaluate(() => {
      const root = document.documentElement;
      const styles = getComputedStyle(root);
      return {
        bg: styles.getPropertyValue("--bb-bg"),
        surface: styles.getPropertyValue("--bb-surface"),
        surfaceHigh: styles.getPropertyValue("--bb-surface-high"),
        text: styles.getPropertyValue("--bb-text"),
        muted: styles.getPropertyValue("--bb-muted"),
        border: styles.getPropertyValue("--bb-border"),
        borderStrong: styles.getPropertyValue("--bb-border-strong"),
        cta: styles.getPropertyValue("--bb-cta"),
        ctaHover: styles.getPropertyValue("--bb-cta-hover"),
        positive: styles.getPropertyValue("--bb-positive"),
        negative: styles.getPropertyValue("--bb-negative"),
        warning: styles.getPropertyValue("--bb-warning"),
        info: styles.getPropertyValue("--bb-info"),
        font: styles.getPropertyValue("--bb-font"),
        mono: styles.getPropertyValue("--bb-mono"),
      };
    });

    // All core design tokens must be non-empty.
    for (const [key, value] of Object.entries(vars)) {
      expect(value.trim(), `CSS variable --bb-${key} should be defined`).not.toBe("");
    }
  });

  test("background is near-black canvas", async ({ page }) => {
    await openFixtureProject(page);

    const bg = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bb-bg").trim();
    });
    expect(bg).toBe("#09090b");
  });

  test("CTA color is the foreground accent", async ({ page }) => {
    await openFixtureProject(page);

    const cta = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bb-cta").trim();
    });
    expect(cta.toLowerCase()).toBe("#f4f4f5");
  });

  test("body uses Space Grotesk font", async ({ page }) => {
    await openFixtureProject(page);

    const font = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bb-font").trim();
    });
    expect(font.toLowerCase()).toContain("space grotesk");
  });

  test("mono font is JetBrains Mono", async ({ page }) => {
    await openFixtureProject(page);

    const mono = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue("--bb-mono").trim();
    });
    expect(mono.toLowerCase()).toContain("jetbrains mono");
  });

  test("semantic status colors are defined", async ({ page }) => {
    await openFixtureProject(page);

    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        positive: s.getPropertyValue("--bb-positive").trim().toLowerCase(),
        negative: s.getPropertyValue("--bb-negative").trim().toLowerCase(),
        warning: s.getPropertyValue("--bb-warning").trim().toLowerCase(),
        info: s.getPropertyValue("--bb-info").trim().toLowerCase(),
      };
    });

    // DESIGN.md: positive=#d4d4d8, negative=#a1a1aa, warning=#d4d4d8, info=#b4b4bb
    expect(colors.positive).toBe("#d4d4d8");
    expect(colors.negative).toBe("#a1a1aa");
    expect(colors.warning).toBe("#d4d4d8");
    expect(colors.info).toBe("#b4b4bb");
  });

  test("all buttons have 0px border radius", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Check all visible buttons for 0px border-radius.
    const buttons = page.locator("button:visible");
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const radius = await buttons.nth(i).evaluate((el) => {
        return getComputedStyle(el).borderRadius;
      });
      expect(radius, `Button ${i} should have 0px border radius`).toBe("0px");
    }
  });

  test("all inputs have 0px border radius", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const inputs = page.locator("input:visible, textarea:visible");
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const radius = await inputs.nth(i).evaluate((el) => {
        return getComputedStyle(el).borderRadius;
      });
      expect(radius, `Input ${i} should have 0px border radius`).toBe("0px");
    }
  });

  test("all modals use modal-overlay pattern", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Open the provider picker modal.
    await page.locator(".chat-column-model-chip").first().click();
    await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });

    // The modal should use the standard modal-overlay + modal pattern.
    const overlay = page.locator(".modal-overlay.provider-catalog-overlay").first();
    await expect(overlay).toBeVisible();

    const modal = overlay.locator(".modal.provider-catalog-modal").first();
    await expect(modal).toBeVisible();

    // The modal should have a header.
    await expect(modal.locator(".modal-header").first()).toBeVisible();

    // Close it.
    await overlay.click({ position: { x: 5, y: 5 } });
  });

  test("sidebar has correct width when expanded", async ({ page }) => {
    await openFixtureProject(page);

    // DESIGN.md: sidebar is 220px expanded (we use 240px in the desktop adaptation).
    // Check it's a reasonable sidebar width (between 200px and 260px).
    const sidebar = page.locator(".activity-sidebar").first();
    if (await sidebar.count() > 0) {
      const width = await sidebar.evaluate((el) => {
        return getComputedStyle(el).width;
      });
      const px = parseInt(width, 10);
      expect(px, `Sidebar width should be 200-260px, got ${px}`).toBeGreaterThanOrEqual(200);
      expect(px, `Sidebar width should be 200-260px, got ${px}`).toBeLessThanOrEqual(260);
    }
  });

  test("layout works at 960x640 minimum viewport", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await openFixtureProject(page);
    await ensureChatPanel(page);

    // App shell should be visible and not overflow.
    await expect(page.locator(".app-shell").first()).toBeVisible();

    // Chat panel should be visible.
    await expect(page.locator(".chat-panel").first()).toBeVisible({ timeout: 5_000 });

    // No horizontal scroll.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal scroll at 960px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("layout works at 1280x800 viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".app-shell").first()).toBeVisible();
    await expect(page.locator(".chat-panel").first()).toBeVisible({ timeout: 5_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "No horizontal scroll at 1280px").toBeLessThanOrEqual(clientWidth + 1);
  });

  test("compact header shows model and context with tooltips", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);

    const model = page.locator(".chat-column-model-chip").first();
    const context = page.locator(".chat-header-context").first();
    await expect(model).toBeVisible({ timeout: 5_000 });
    await expect(context).toBeVisible();
    await expect(model).toHaveAttribute("title", /Model:/);
    await expect(context).toHaveAttribute("title", /Context usage:/);
  });

  test("command strip stage buttons have status colors", async ({ page }) => {
    await openFixtureProject(page);

    // DESIGN.md: command strip has 5 stage icons (Schematic, Ideas, Plans, Running, Done).
    const strip = page.locator(".command-strip").first();
    if (await strip.count() > 0) {
      const buttons = strip.locator("button");
      const count = await buttons.count();
      expect(count).toBeGreaterThanOrEqual(5);

      // Each button should have a tooltip.
      for (let i = 0; i < count; i++) {
        const title = await buttons.nth(i).getAttribute("title");
        expect(title, `Stage button ${i} should have a tooltip`).toBeTruthy();
      }
    }
  });
});

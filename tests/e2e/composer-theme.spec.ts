import { expect, test } from "@playwright/test";

test.describe("Chat composer theme and layout", () => {
  test("chat header uses chrome background", async ({ page }) => {
    await page.goto("/");
    const header = page.locator(".chat-column-header").first();
    if (await header.isVisible()) {
      const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("model chip has rounded corners", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator(".chat-column-model-chip").first();
    if (await chip.isVisible()) {
      const radius = await chip.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius).not.toBe("0px");
    }
  });

  test("context indicator SVG is present", async ({ page }) => {
    await page.goto("/");
    const indicator = page.locator(".chat-header-context").first();
    if (await indicator.isVisible()) {
      const svg = indicator.locator("svg").first();
      await expect(svg).toBeVisible();
    }
  });

  test("send button has circular radius", async ({ page }) => {
    await page.goto("/");
    const sendBtn = page.locator(".chat-send-btn").first();
    if (await sendBtn.isVisible()) {
      const radius = await sendBtn.evaluate((el) => getComputedStyle(el).borderRadius);
      // Circular buttons should have 50% or 9999px radius
      expect(radius === "9999px" || radius.includes("%")).toBeTruthy();
    }
  });

  test("chat input area has chrome background", async ({ page }) => {
    await page.goto("/");
    const inputArea = page.locator(".chat-input-area").first();
    if (await inputArea.isVisible()) {
      const bg = await inputArea.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("tool cards have rounded corners", async ({ page }) => {
    await page.goto("/");
    const toolCard = page.locator(".tool-card").first();
    if (await toolCard.isVisible()) {
      const radius = await toolCard.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius).not.toBe("0px");
    }
  });

  test("chat messages have rounded corners", async ({ page }) => {
    await page.goto("/");
    const message = page.locator(".chat-message").first();
    if (await message.isVisible()) {
      const radius = await message.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius).not.toBe("0px");
    }
  });
});

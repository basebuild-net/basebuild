import { expect, test } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

test.describe("chat composer with an input method (pinyin, kana)", () => {
  test("Enter that confirms an IME candidate does not send; a plain Enter does", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });

    const input = page.getByTitle(/Chat input/).first();
    await input.fill("你好");
    const users = page.locator(".chat-message-user");
    const before = await users.count();

    // Chromium-style: Enter while composing.
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    // WebKit-style: the confirming Enter arrives after compositionend as keyCode 229.
    await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true });
    await page.waitForTimeout(300);
    await expect(users).toHaveCount(before);
    await expect(input).toHaveValue("你好");

    await input.press("Enter");
    await expect(users).toHaveCount(before + 1, { timeout: 10_000 });
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("你好", { timeout: 15_000 });
  });
});

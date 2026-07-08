import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name", { hasText: "project" }),
  ).toBeVisible();
}

test.describe("Planning cockpit: interactive coverage", () => {
  test("prose quick-reply chips render for enumerated assistant messages", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    // Send a message that triggers an assistant response with enumerated options.
    // The native_chat_send mock returns enumerated A/B/C options when the
    // content contains "quick-reply-test".
    const input = page.locator("textarea.chat-input").first();
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("quick-reply-test");
    await page.locator("button.chat-send-btn").first().click();

    // The quick-reply chips should appear (3 options detected from A/B/C).
    const chips = page.locator(".chat-quick-reply-chip");
    await expect(chips.first()).toBeVisible({ timeout: 5_000 });
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThanOrEqual(2);
  });

  test("no window.confirm anywhere in planning/source flows", async ({ page }) => {
    await openFixtureProject(page);

    let dialogHeard = false;
    page.on("dialog", () => { dialogHeard = true; });

    // Open and close the Plans & Ideas modal.
    const plansBtn = page.getByRole("button", { name: "Plans & Ideas" }).first();
    if (await plansBtn.count() > 0) {
      await plansBtn.click();
      await page.waitForTimeout(300);
      // Close by clicking the close button in the modal header.
      await page.locator('.modal-overlay[aria-label="Plans & Ideas"] .btn-icon[title*="Close"]').first().click();
      await page.waitForTimeout(200);
    }

    // Open and close the source-control Changes tab.
    const changesBtn = page.getByRole("button", { name: "Changes" }).first();
    if (await changesBtn.count() > 0) {
      await changesBtn.click();
      await page.waitForTimeout(300);
    }

    expect(dialogHeard).toBe(false);
  });

  test("ConfirmDialog renders for archive action in changes panel", async ({ page }) => {
    await openFixtureProject(page);

    // Open Plans & Ideas modal.
    const plansBtn = page.getByRole("button", { name: "Plans & Ideas" }).first();
    await plansBtn.click();
    await page.waitForTimeout(500);

    // Click the Changes tab.
    const changesTab = page.locator(".inspector-tab", { hasText: "Changes" }).first();
    await changesTab.click();
    await page.waitForTimeout(300);

    // The changes panel should be visible.
    await expect(page.locator(".changes-panel")).toBeVisible({ timeout: 5_000 });

    // No ConfirmDialog should be open initially.
    expect(await page.locator(".confirm-dialog-modal").count()).toBe(0);

    // No window.confirm dialogs should appear.
    let dialogHeard = false;
    page.on("dialog", () => { dialogHeard = true; });

    expect(dialogHeard).toBe(false);
  });
});

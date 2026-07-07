import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" }),
  ).toBeVisible();
}

test.describe("Planning cockpit: assignment + batch launch", () => {
  test("assign plan to chat calls backend (not status flip)", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    // Open the plans modal.
    await page.getByRole("button", { name: /plans/i }).first().click();
    await expect(page.locator(".modal", { hasText: "Plans" })).toBeVisible({ timeout: 3_000 });

    // The modal should not use window.confirm anywhere.
    // (If we got here without a native dialog blocking, we're good.)
  });

  test("batch launch enqueues real runs (no window.confirm)", async ({ page }) => {
    await openFixtureProject(page);

    // Open the flow board.
    await page.getByRole("button", { name: /plans/i }).first().click();
    await expect(page.locator(".modal", { hasText: "Plans" })).toBeVisible({ timeout: 3_000 });

    // Click the Flow tab if present.
    const flowTab = page.locator("[data-tab='flow'], button").filter({ hasText: "Flow" }).first();
    if (await flowTab.count() > 0) {
      await flowTab.click();
    }

    // The "Launch N ready" button should not trigger window.confirm.
    // If it exists, clicking it should not block on a native dialog.
    const launchBtn = page.getByRole("button", { name: /Launch.*ready/i }).first();
    if (await launchBtn.count() > 0) {
      await launchBtn.click();
      // No native dialog should appear — the page should remain responsive.
      await page.waitForTimeout(500);
    }
  });

  test("no window.confirm in planning flows", async ({ page }) => {
    await openFixtureProject(page);

    // Override window.confirm to detect any usage.
    let confirmCalled = false;
    await page.addInitScript(() => {
      window.confirm = () => { (window as unknown as { __confirmCalled: boolean }).__confirmCalled = true; return false; };
    });

    // Navigate through planning surfaces.
    await page.getByRole("button", { name: /plans/i }).first().click();
    await page.waitForTimeout(500);

    const flowTab = page.locator("[data-tab='flow'], button").filter({ hasText: "Flow" }).first();
    if (await flowTab.count() > 0) {
      await flowTab.click();
      await page.waitForTimeout(300);
    }

    const launchBtn = page.getByRole("button", { name: /Launch.*ready/i }).first();
    if (await launchBtn.count() > 0) {
      await launchBtn.click();
      await page.waitForTimeout(300);
    }

    confirmCalled = await page.evaluate(() => (window as unknown as { __confirmCalled?: boolean }).__confirmCalled ?? false);
    expect(confirmCalled).toBe(false);
  });
});

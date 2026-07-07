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

test.describe("Planning cockpit: command strip + layouts + idea browser", () => {
  test("command strip is visible in session header", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".command-strip").first()).toBeVisible({ timeout: 5_000 });
  });

  test("command strip shows stage counts", async ({ page }) => {
    await openFixtureProject(page);
    const strip = page.locator(".command-strip").first();
    await expect(strip).toBeVisible({ timeout: 5_000 });
    // Should have at least 5 stages.
    const stages = strip.locator(".command-strip-stage");
    expect(await stages.count()).toBeGreaterThanOrEqual(5);
  });

  test("command strip can be collapsed and expanded", async ({ page }) => {
    await openFixtureProject(page);
    const strip = page.locator(".command-strip").first();
    await expect(strip).toBeVisible({ timeout: 5_000 });

    // Click the toggle button to collapse.
    const toggle = strip.locator(".command-strip-toggle").first();
    await toggle.click();
    await page.waitForTimeout(300);

    // The collapsed version should appear.
    await expect(page.locator(".command-strip-collapsed").first()).toBeVisible({ timeout: 3_000 });

    // Click to expand again.
    await page.locator(".command-strip-collapsed").first().click();
    await page.waitForTimeout(300);
    await expect(page.locator(".command-strip").first()).toBeVisible({ timeout: 3_000 });
  });

  test("command strip stages click through to Plans & Ideas", async ({ page }) => {
    await openFixtureProject(page);
    const stage = page.locator(".command-strip-stage").first();
    await stage.click();
    await page.waitForTimeout(500);
    // Plans & Ideas modal should open.
    await expect(page.locator('.modal-overlay[aria-label="Plans & Ideas"]')).toBeVisible({ timeout: 3_000 });
  });
});

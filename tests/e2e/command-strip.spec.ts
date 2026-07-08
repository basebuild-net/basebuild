import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
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

  test("command strip routes schematic, ideas, and plans to their exact surfaces", async ({ page }) => {
    await openFixtureProject(page);

    await page.getByTitle(/^Schematic:/).click();
    await expect(page.locator('.modal-overlay[aria-label="Project Schematic"]')).toBeVisible({ timeout: 3_000 });
    await page.getByTitle("Close project schematic").click();

    await page.getByTitle(/^Ideas:/).click();
    const planningModal = page.locator('.modal-overlay[aria-label="Plans & Ideas"]');
    await expect(planningModal).toBeVisible({ timeout: 3_000 });
    await expect(planningModal.getByRole("button", { name: "Ideas", exact: true })).toHaveClass(/is-active/);
    await expect(planningModal.getByText(/No ideas/)).toBeVisible();
    await page.getByTitle("Close (Esc)").click();

    await page.getByTitle(/^Plans:/).click();
    await expect(planningModal.getByRole("button", { name: "Plans", exact: true })).toHaveClass(/is-active/);
    await expect(planningModal.getByRole("button", { name: "Create plan", exact: true })).toHaveCount(0);
  });
});

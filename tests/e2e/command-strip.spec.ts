import { expect, test } from "@playwright/test";
import { openFixtureProject, openPlanningModal } from "./helpers";

test.describe("Planning cockpit: planning indicators + layouts + idea browser", () => {
  test("planning indicators is visible in session header", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".planning-indicators").first()).toBeVisible({ timeout: 5_000 });
  });

  test("planning indicators shows five stage buttons with data-stage attributes", async ({ page }) => {
    await openFixtureProject(page);
    const indicators = page.locator(".planning-indicators").first();
    await expect(indicators).toBeVisible({ timeout: 5_000 });

    const buttons = indicators.locator(".planning-indicator");
    await expect(buttons).toHaveCount(5);

    const stages = ["schematic", "ideas", "plans", "running", "finished"];
    for (const stage of stages) {
      await expect(
        indicators.locator(`.planning-indicator[data-stage="${stage}"]`),
      ).toHaveCount(1);
    }
  });

  test("clicking a stage opens the planning indicator dropdown", async ({ page }) => {
    await openFixtureProject(page);
    const plansIndicator = page.locator('.planning-indicator[data-stage="plans"]').first();
    await expect(plansIndicator).toBeVisible({ timeout: 5_000 });
    await plansIndicator.click();
    await expect(page.locator(".planning-notification-dropdown").first()).toBeVisible({ timeout: 5_000 });
  });

  test("dropdown has a Full UI button", async ({ page }) => {
    await openFixtureProject(page);
    const plansIndicator = page.locator('.planning-indicator[data-stage="plans"]').first();
    await plansIndicator.click();
    const dropdown = page.locator(".planning-notification-dropdown").first();
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await expect(dropdown.getByRole("button", { name: /full UI/i })).toBeVisible();
  });

  test("plans indicator opens the planning inspector modal via Full UI", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningModal(page);
    await expect(
      page.locator('.planning-inspector-modal, .modal-overlay[aria-label="Plans & Ideas"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

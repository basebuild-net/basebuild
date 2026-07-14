import { expect, test, type Page } from "@playwright/test";
import { openPlanningModal } from "./helpers";
async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: "project" }),
  ).toBeVisible({ timeout: 5_000 });
}

test.describe("Plan run queue", () => {
  test("enqueue a ready plan and see it in the queue", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    // Open the Plans & Ideas fold in the floating environment panel.
    await openPlanningModal(page);

    // The plan queue section is visible in the plans side panel.
    await expect(page.locator(".plan-queue-section")).toBeVisible();
    await expect(page.locator(".plan-queue-title")).toContainText("Run Queue");

    // If there's a ready plan, the enqueue button should be visible.
    const enqueueBtn = page.locator(".plan-queue-enqueue-btn").first();
    if (await enqueueBtn.isVisible()) {
      await enqueueBtn.click();
      // The enqueued plan appears in the queue list.
      await expect(page.locator(".plan-queue-entry").first()).toBeVisible();
    }

    // The profile selector (concurrency input) is visible with a tooltip.
    const concurrencyInput = page.locator(".plan-queue-concurrency input");
    await expect(concurrencyInput).toBeVisible();
    await expect(concurrencyInput).toHaveAttribute("title");

    // Start + Pause buttons have tooltips.
    await expect(page.locator(".plan-queue-start")).toHaveAttribute("title");
    await expect(page.locator(".plan-queue-pause")).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });
});

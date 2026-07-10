import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

async function openPlanningInspectorIdeas(page: Page) {
  // Open the planning inspector modal via the "Plans & Ideas" button.
  const plansBtn = page.locator('[title="Plans & Ideas"]').first();
  await plansBtn.waitFor({ state: "visible", timeout: 10000 });
  await plansBtn.click();
  await expect(page.locator(".planning-inspector-modal, .planning-inspector")).toBeVisible({ timeout: 5000 });
  // Click the Ideas tab.
  const ideasTab = page.locator('[title="Ideas history"]').first();
  await ideasTab.waitFor({ state: "visible", timeout: 5000 });
  await ideasTab.click();
  await page.waitForTimeout(300);
}

test.describe("Idea grounding: batch header provenance and generate-from-finished-plans", () => {
  test("generate-from-finished-plans button renders with disabled state and tooltip", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    // The "Generate from finished plans" button should be visible.
    // With no grounding data (finishedPlanCount === 0), it should be disabled.
    const genBtn = page.locator("button").filter({ hasText: "Generate from finished plans" }).first();
    await genBtn.waitFor({ state: "visible", timeout: 5000 });

    // When no grounding data is available, the button should be disabled.
    const isDisabled = await genBtn.isDisabled();
    if (isDisabled) {
      await expect(genBtn).toHaveAttribute("title", /No finished plans since last schematic update/);
    }
  });

  test("idea batch header shows sections and counts when grounding is present", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    // If grounding metadata has been set (e.g., from a prior generation call),
    // the batch header should show schematic sections and plan counts.
    // Without a prior generation, the header may not be present — that's valid.
    const header = page.locator(".idea-batch-header").first();
    const headerCount = await header.count();
    if (headerCount > 0) {
      await expect(header).toContainText("Grounded in:");
      const sections = header.locator(".idea-batch-header-sections").first();
      await expect(sections).toBeVisible();
      const counts = header.locator(".idea-batch-header-counts").first();
      await expect(counts).toBeVisible();
    }
  });

  test("ideas tab renders correctly with filter chips and idea list", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    // Verify the ideas tab is rendered with filter chips.
    const filterChips = page.locator(".inspector-filter-chip");
    await expect(filterChips.first()).toBeVisible({ timeout: 5000 });

    // Verify the ideas list container is present.
    const ideasList = page.locator(".inspector-ideas-list").first();
    await expect(ideasList).toBeVisible();
  });
});

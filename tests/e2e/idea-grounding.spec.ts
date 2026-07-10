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

/** Seed grounding metadata through the real pub-sub the UI subscribes to.
 *  Dynamic import is required here: this function body executes in the
 *  browser page (vite dev server module graph), where the Playwright test's
 *  static Node-side imports cannot reach. Same-URL import resolves to the
 *  same module instance the app uses. */
async function seedGrounding(page: Page, overrides: Record<string, unknown> = {}) {
  await page.evaluate(async (patch) => {
    const mod = await import("/src/state/grounding.ts");
    mod.setLastGrounding({
      schematicSections: ["Goals", "Vision"],
      finishedPlans: ["BB-0001", "BB-0002"],
      finishedPlanCount: 2,
      pickedCount: 1,
      rejectedCount: 0,
      digestEmpty: false,
      ...patch,
    });
  }, overrides);
}

test.describe("Idea grounding: batch header provenance and generate-from-finished-plans", () => {
  test("batch header renders sections, counts, and plan provenance from grounding metadata", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    // No grounding yet: header absent on a fresh load — this is the baseline,
    // not the assertion target.
    await expect(page.locator(".idea-batch-header")).toHaveCount(0);

    await seedGrounding(page);

    // Header must render unconditionally once grounding exists.
    const header = page.locator(".idea-batch-header").first();
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect(header).toContainText("Grounded in:");
    await expect(header.locator(".idea-batch-header-sections")).toContainText("Goals · Vision");
    await expect(header.locator(".idea-batch-header-counts")).toContainText("2 finished plans");
    await expect(header.locator(".idea-batch-header-counts")).toContainText("1 picked");
    await expect(header).toHaveAttribute("title", /BB-0001, BB-0002/);
    // digestEmpty=false — no empty-digest marker.
    await expect(header.locator(".idea-batch-header-empty")).toHaveCount(0);
  });

  test("empty digest renders the no-decisions marker", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    await seedGrounding(page, { digestEmpty: true, pickedCount: 0, rejectedCount: 0 });

    const header = page.locator(".idea-batch-header").first();
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect(header.locator(".idea-batch-header-empty")).toContainText("no decisions since schematic update");
  });

  test("generate-from-finished-plans disables without grounding and enables with finished plans", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspectorIdeas(page);

    const genBtn = page.locator("button").filter({ hasText: "Generate from finished plans" }).first();
    await genBtn.waitFor({ state: "visible", timeout: 5000 });

    // Fresh load: no grounding — MUST be disabled with the explanatory tooltip.
    await expect(genBtn).toBeDisabled();
    await expect(genBtn).toHaveAttribute("title", /No finished plans since last schematic update/);

    // With finished plans in grounding — MUST enable with the weighted tooltip.
    await seedGrounding(page);
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toHaveAttribute("title", /weighted by 2 finished plans/);

    // Zero finished plans — disabled again even though grounding exists.
    await seedGrounding(page, { finishedPlans: [], finishedPlanCount: 0 });
    await expect(genBtn).toBeDisabled();
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

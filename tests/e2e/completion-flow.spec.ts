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
  // Seed an awaiting_review run into the mock state. Attach to all sessions
  // for this project so the active session's run list includes it.
  await page.evaluate(() => {
    const state = (globalThis as { __BASEBUILD_E2E_STATE__?: { sessions: { id: string; projectPath: string }[]; planRuns: { id: string; planId: string; sessionId: string; status: string; runnerKind: string; stepsOutput: unknown[]; createdAt: number }[] } }).__BASEBUILD_E2E_STATE__;
    if (!state) return;
    for (const session of state.sessions) {
      if (session.projectPath !== "C:\\basebuild-e2e\\project") continue;
      state.planRuns.push({
        id: `run-awaiting-${session.id}`,
        planId: "plan-fixture",
        sessionId: session.id,
        status: "awaiting_review",
        runnerKind: "native",
        stepsOutput: [],
        createdAt: Date.now(),
      });
    }
  });
}
async function openPlanningInspector(page: Page) {
  await openPlanningModal(page);
}

async function clickFlowTab(page: Page) {
  const modal = page.locator('.modal-overlay[aria-label="Plans & Ideas"]');
  await modal.getByRole("button", { name: "Flow" }).click();
  await expect(modal.locator(".flow-board")).toBeVisible({ timeout: 3_000 });
}

test.describe("Planning cockpit: completion flow", () => {
  test("completion card renders for awaiting_review runs", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspector(page);
    await clickFlowTab(page);

    // The mock should provide a run in awaiting_review state.
    // Verify the completion card appears in the finished stage.
    const card = page.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.locator(".completion-card-title")).toContainText(/Awaiting review|Complete/);
  });

  test("mark complete button is present for awaiting_review runs", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspector(page);
    await clickFlowTab(page);

    const card = page.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    // The "Mark complete" button should be present.
    await expect(card.getByRole("button", { name: "Mark complete" })).toBeVisible({ timeout: 3_000 });
  });

  test("completion card does not duplicate finish-policy git actions", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspector(page);
    await clickFlowTab(page);

    const card = page.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByRole("button", { name: /^Commit$/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Create PR|Create pull request/ })).toHaveCount(0);
  });

  test("dismiss button hides the completion card", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspector(page);
    await clickFlowTab(page);

    const card = page.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.locator("button[title='Dismiss']").click();
    await page.waitForTimeout(500);
    // Card should be gone (or at least this instance).
    await expect(page.locator(".completion-card")).toHaveCount(0, { timeout: 3_000 });
  });
});

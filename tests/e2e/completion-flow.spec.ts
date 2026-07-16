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
  // Seed an awaiting_review run linked to an incomplete OpenSpec checklist.
  await page.evaluate(async () => {
    const global = globalThis as {
      __BASEBUILD_E2E_STATE__?: {
        sessions: { id: string; projectPath: string }[];
        planRuns: { id: string; planId: string; sessionId: string; status: string; runnerKind: string; stepsOutput: unknown[]; createdAt: number }[];
      };
      __basebuildInvoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
    const state = global.__BASEBUILD_E2E_STATE__;
    const invoke = global.__basebuildInvoke;
    if (!state || !invoke) return;
    await invoke("__e2e_set_task_progress", {
      changeName: "completion-flow",
      completed: 1,
      total: 2,
    });
    for (const session of state.sessions) {
      if (session.projectPath !== "C:\\basebuild-e2e\\project") continue;
      const plan = await invoke<{ id: string }>("create_plan", {
        input: {
          sessionId: session.id,
          title: "Completion flow",
          description: "Exercise strict completion gates.",
        },
      });
      await invoke("update_plan", {
        id: plan.id,
        input: { changeName: "completion-flow", status: "ready" },
      });
      state.planRuns.push({
        id: `run-awaiting-${session.id}`,
        planId: plan.id,
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
  await modal.getByRole("button", { name: "Flow", exact: true }).click();
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

  test("mark complete explains and enforces the incomplete checklist gate", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningInspector(page);
    await clickFlowTab(page);

    const card = page.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    const markComplete = card.getByRole("button", { name: "Mark complete" });
    await expect(markComplete).toBeVisible({ timeout: 3_000 });
    await expect(markComplete).toBeDisabled();
    await expect(markComplete).toHaveAttribute(
      "title",
      "Cannot mark complete: 1/2 required OpenSpec tasks are complete.",
    );
    await expect(card.getByRole("button", { name: "Review tasks" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
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

import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openMvpFixtureProject, openPlanningModal, waitForAppReady } from "./helpers";

type InvokeWindow = Window & {
  __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  __basebuildMockInteraction?: unknown;
  __emit?: (event: string, payload: unknown) => void;
};

async function planningModal(page: Page) {
  await openPlanningModal(page);
  return page.locator('.modal-overlay[aria-label="Plans & Ideas"]');
}

test("idea proceeds through OpenSpec, execution, question, review, finish, and archive", async ({ page }) => {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
  await ensureChatPanel(page);
  const chatSessionId = await page.locator(".chat-panel").first().getAttribute("data-native-session-id");
  if (!chatSessionId) throw new Error("Active native chat is unavailable");

  const modal = await planningModal(page);
  await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
  const idea = modal.locator(".chat-idea-card", { hasText: "Viewport-safe popovers" });
  await expect(idea).toBeVisible();
  await idea.getByRole("button", { name: "Make plan" }).click();

  const plan = modal.locator(".plan-card, .plan-row").filter({ hasText: "Viewport-safe popovers" });
  await expect(plan.getByRole("button", { name: "Approve plan" })).toBeVisible({ timeout: 5_000 });
  await plan.getByRole("button", { name: "Approve plan" }).click();
  await expect(plan.getByRole("button", { name: "Assign to chat" })).toBeVisible({ timeout: 5_000 });
  await plan.getByRole("button", { name: "Assign to chat" }).click();

  const picker = page.locator(".destination-picker-modal");
  await expect(picker).toBeVisible({ timeout: 5_000 });
  await picker.locator(".destination-picker-item").filter({ hasText: "Charlie MVP chat" }).click();
  await picker.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(picker).not.toBeVisible({ timeout: 5_000 });
  await modal.getByTitle("Close (Esc)").click();

  await page.evaluate(({ chatSessionId }) => {
    const w = window as InvokeWindow;
    const interaction = {
      id: "journey-question",
      sessionId: chatSessionId,
      title: "Confirm execution",
      questions: [{
        id: "continue",
        prompt: "Continue with the implementation?",
        kind: "confirm",
        required: true,
        options: [{ label: "Continue" }, { label: "Stop" }],
        recommended: 0,
      }],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    };
    w.__basebuildMockInteraction = interaction;
    w.__emit?.("native-chat://interactive-request", { sessionId: chatSessionId, interactionId: interaction.id });
  }, { chatSessionId });
  await expect(page.locator(".interaction-workbench")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });

  const completed = await page.evaluate(async () => {
    const w = window as InvokeWindow;
    const invoke = w.__basebuildInvoke;
    if (!invoke) throw new Error("E2E fixture unavailable");
    const state = (window as unknown as {
      __BASEBUILD_E2E_STATE__?: {
        plans: { id: string; title: string; changeName?: string | null }[];
        planRuns: { id: string; planId: string }[];
      };
    }).__BASEBUILD_E2E_STATE__;
    const plan = state?.plans.find((candidate) => candidate.title === "Viewport-safe popovers");
    if (!plan?.changeName) throw new Error("Promoted plan has no OpenSpec change");
    const run = state?.planRuns.find((candidate) => candidate.planId === plan.id);
    if (!run) throw new Error("Assigned run is unavailable");
    await invoke("__e2e_set_task_progress", { changeName: plan.changeName, completed: 1, total: 1 });
    await invoke("plan_run_complete", { runId: run.id, succeeded: true });
    w.__emit?.("planning://event", {
      kind: "run_finished",
      entityId: run.id,
      projectPath: "C:\\basebuild-e2e\\charlie",
      sessionId: "mvp-session-charlie",
      title: plan.title,
      seq: Date.now(),
      ts: Math.floor(Date.now() / 1000),
    });
    return { changeName: plan.changeName };
  });

  const review = await planningModal(page);
  await review.locator(".inspector-tab", { hasText: "Plans" }).click();
  await review.getByRole("button", { name: /Finished \/ Cancelled/ }).click();
  const finishedPlan = review.locator(".plan-card, .plan-row").filter({ hasText: "Viewport-safe popovers" });
  await expect(finishedPlan.getByRole("button", { name: "Archive" })).toBeVisible({ timeout: 5_000 });
  await finishedPlan.getByRole("button", { name: "Archive" }).click();

  const change = review.locator(".changes-panel-item").filter({ hasText: completed.changeName });
  await expect(change).toBeVisible({ timeout: 5_000 });
  await change.getByRole("button", { name: "Archive" }).click();
  const confirm = page.locator(".confirm-dialog-modal");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Archive" }).click();
  await expect(review.locator(".changes-panel-item").filter({ hasText: completed.changeName })).toHaveCount(0, { timeout: 5_000 });
});

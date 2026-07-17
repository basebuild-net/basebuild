import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, ensureChatPanel, openPlanningModal } from "./helpers";

/**
 * Test run mode: end-to-end plan lifecycle smoke test.
 *
 * Simulates a user who:
 *   1. Opens a fresh minimal project (empty folder + index.html — the
 *      fixture project stands in for that minimal project in the e2e mock
 *      environment).
 *   2. Picks a random concept idea from the ideas catalog.
 *   3. Promotes it to a plan (draft).
 *   4. Generates OpenSpec (draft → openspec, which assigns a change name).
 *   5. Approves the plan (openspec → ready).
 *   6. Assigns it to a chat and runs it.
 *   7. Marks the task checklist complete and completes the run.
 *   8. Asserts the plan transitions from running → finished (success).
 *
 * This is the golden lifecycle path — if any stage breaks, the plan never
 * reaches "finished" and the test fails with a clear assertion.
 */

type InvokeWindow = Window & {
  __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  __emit?: (event: string, payload: unknown) => void;
};

type E2EState = {
  ideas: { id: string; title: string; status: string; sessionId: string }[];
  plans: { id: string; title: string; status: string; changeName?: string | null; sessionId: string }[];
  planRuns: { id: string; planId: string; status: string }[];
};

async function getE2EState(page: Page): Promise<E2EState> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const raw = w["__BASEBUILD_E2E_STATE__"];
    if (!raw || typeof raw !== "object") {
      throw new Error("E2E state unavailable — fixture not loaded");
    }
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj["ideas"]) || !Array.isArray(obj["plans"]) || !Array.isArray(obj["planRuns"])) {
      throw new Error("E2E state missing required arrays");
    }
    return raw as E2EState;
  });
}

test.describe("Test run mode: full plan lifecycle", () => {
  test("random idea → promote → openspec → approve → run → finished", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await ensureChatPanel(page);

    // ── 1. Pick a random concept idea ────────────────────────────────────
    const stateBefore = await getE2EState(page);
    const conceptIdeas = stateBefore.ideas.filter((i) => i.status === "concept");
    expect(conceptIdeas.length, "fixture should have concept ideas to pick from").toBeGreaterThan(0);
    const randomIdea = conceptIdeas[Math.floor(Math.random() * conceptIdeas.length)];
    const ideaTitle = randomIdea.title;

    // ── 2. Promote idea → plan (draft) via the planning modal UI ─────────
    await openPlanningModal(page);
    const modal = page.locator('.modal-overlay[aria-label="Plans & Ideas"]');
    await modal.waitFor({ state: "visible", timeout: 5_000 });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    const ideaCard = modal.locator(".chat-idea-card", { hasText: ideaTitle });
    await expect(ideaCard).toBeVisible({ timeout: 5_000 });
    await ideaCard.getByRole("button", { name: "Make plan" }).click();

    // The plan should appear in the Plans tab with an "Approve plan" button.
    await modal.locator(".inspector-tab", { hasText: "Plans" }).click();
    const planRow = modal.locator(".plan-card, .plan-row").filter({ hasText: ideaTitle });
    await expect(planRow.getByRole("button", { name: "Approve plan" })).toBeVisible({ timeout: 5_000 });

    // ── 3. Verify the plan was created and auto-promoted to openspec ─────
    // The "Make plan" button calls batch_promote_ideas (creates draft) then
    // immediately calls set_plan_status("openspec") to generate the change
    // name. By the time the Plans tab renders, the plan is already in openspec.
    const stateAfterPromote = await getE2EState(page);
    const plan = stateAfterPromote.plans.find((p) => p.title === ideaTitle);
    expect(plan, "promoted plan should exist in state").toBeDefined();
    expect(plan!.status, "plan should be in openspec after Make plan").toBe("openspec");
    expect(plan!.changeName, "openspec plan should have a change name").toBeTruthy();

    // ── 4. Approve: openspec → ready (via the UI "Approve plan" button) ───
    await planRow.getByRole("button", { name: "Approve plan" }).click();
    const stateAfterApprove = await getE2EState(page);
    const planAfterApprove = stateAfterApprove.plans.find((p) => p.id === plan!.id);
    expect(planAfterApprove!.status, "approved plan should be ready").toBe("ready");

    // ── 5. Assign to chat, mark checklist, complete run, assert finished ──
    // All backend calls happen inside one page.evaluate so the mock state
    // mutations are visible to the subsequent reads (the mock runs in-page).
    const chatSessionId = await page.locator(".chat-panel").first().getAttribute("data-native-session-id");
    if (!chatSessionId) throw new Error("Active native chat is unavailable");

    const result = await page.evaluate(async (params) => {
      const w = window as InvokeWindow;
      const invoke = w.__basebuildInvoke;
      if (!invoke) throw new Error("E2E fixture unavailable");
      const s = (window as unknown as { __BASEBUILD_E2E_STATE__?: E2EState }).__BASEBUILD_E2E_STATE__;
      if (!s) throw new Error("E2E state unavailable");
      const plan = s.plans.find((p) => p.title === params.ideaTitle);
      if (!plan) throw new Error("Plan not found in state");
      // Assign to chat (creates a run, sets plan to "running").
      await invoke("plan_assign_to_chat", { planId: plan.id, chatSessionId: params.chatSessionId });
      const run = s.planRuns.find((r) => r.planId === plan.id);
      if (!run) throw new Error("Run not created after assign");
      // Mark the task checklist complete so plan_run_complete succeeds.
      await invoke("__e2e_set_task_progress", { changeName: plan.changeName, completed: 1, total: 1 });
      // Complete the run — this flips plan.status to "finished" and run.status to "succeeded".
      await invoke("plan_run_complete", { runId: run.id, succeeded: true });
      // Emit the planning event so the UI refreshes.
      w.__emit?.("planning://event", {
        kind: "run_finished",
        entityId: run.id,
        projectPath: "C:\\basebuild-e2e\\charlie",
        sessionId: "mvp-session-charlie",
        title: plan.title,
        seq: Date.now(),
        ts: Math.floor(Date.now() / 1000),
      });
      return {
        planId: plan.id,
        runId: run.id,
        planStatus: plan.status,
        runStatus: run.status,
        changeName: plan.changeName,
      };
    }, { ideaTitle, chatSessionId });

    // ── 6. Assert the plan reached "finished" (success) ──────────────────
    expect(result.planStatus, "plan should be finished after successful run").toBe("finished");
    expect(result.runStatus, "run should be succeeded after completion").toBe("succeeded");

    // Verify from the e2e state too (double-check the mock state is consistent).
    const stateFinal = await getE2EState(page);
    const planFinal = stateFinal.plans.find((p) => p.id === result.planId);
    const runFinal = stateFinal.planRuns.find((r) => r.id === result.runId);
    expect(planFinal?.status, "plan should be finished in e2e state").toBe("finished");
    expect(runFinal?.status, "run should be succeeded in e2e state").toBe("succeeded");

    // Close the modal — the test is done.
    await modal.getByTitle("Close (Esc)").click();
    await expect(page.locator(".planning-inspector-modal")).not.toBeVisible({ timeout: 5_000 });
  });
});

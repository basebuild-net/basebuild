import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, openPlanningModal } from "./helpers";

type InvokeWindow = Window & {
  __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  __basebuildMockInteraction?: unknown;
  __emit?: (event: string, payload: unknown) => void;
};

/** Seed a plan (with a linked change) and a running run bound to the given chat. */
async function seedRun(page: Page, chatSessionId: string) {
  await page.evaluate(async ({ chatSessionId }) => {
    const w = window as InvokeWindow;
    const plan = (await w.__basebuildInvoke?.("create_plan", {
      input: { sessionId: "session-1", title: "Board plan", description: "seeded", changeName: "board-change" },
    })) as { id: string };
    await w.__basebuildInvoke?.("plan_assign_to_chat", { planId: plan.id, chatSessionId });
    await w.__basebuildInvoke?.("__e2e_set_task_progress", { changeName: "board-change", completed: 2, total: 10 });
    // Trigger live plan-list refresh so MissionControlBoard sees the seeded plan.
    w.__emit?.("planning://event", {
      kind: "plan_created",
      entityId: plan.id,
      projectPath: "C:\\basebuild-e2e\\project",
      sessionId: "session-1",
      title: "Board plan",
      seq: Date.now(),
      ts: Math.floor(Date.now() / 1000),
    });
  }, { chatSessionId });
  // Allow the async planning-event refetch to settle before opening the board.
  await page.waitForTimeout(500);
}
async function getNativeSessionId(page: Page): Promise<string> {
  await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
  return (await page.locator(".chat-panel").first().getAttribute("data-native-session-id")) ?? "";
}

async function openRunsTab(page: Page) {
  await openPlanningModal(page);
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await modal.getByTitle("Mission control — live run cards with progress and estimates").click();
  return modal;
}

test.describe("Mission control", () => {
  test("run card shows plan, state, progress, elapsed, and worktree", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);
    await seedRun(page, chatSessionId);

    const modal = await openRunsTab(page);
    const card = modal.locator(".mission-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.locator(".mission-card-title")).toHaveText("Board plan");
    await expect(card.locator(".mission-card-state")).toHaveText("Running");
    await expect(card.locator(".mission-card-progress-label")).toHaveText("2/10", { timeout: 10_000 });
    await expect(card.locator(".mission-card-worktree")).toContainText("bb-");
    // One observed tick → honest "estimating", never a fabricated number.
    await expect(card.locator(".mission-card-eta")).toContainText("estimating", { timeout: 10_000 });
  });

  test("flow board Running stage drills into mission control", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await openPlanningModal(page);
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    await modal.locator(".planning-stage-card", { hasText: "Running" }).click();
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Runs" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".mission-control")).toBeVisible();
  });

  test("pending ask_user raises the attention state and clears on answer", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);
    await seedRun(page, chatSessionId);

    // Inject a pending interaction for the owner chat.
    await page.evaluate(({ sessionId }) => {
      const w = window as InvokeWindow;
      w.__basebuildMockInteraction = {
        id: "mc-intr-1",
        sessionId,
        questions: [
          { id: "q1", prompt: "Continue?", kind: "options", options: [{ label: "Yes" }], recommended: 0, allowFreeText: false },
        ],
        status: "pending",
        createdAt: Math.floor(Date.now() / 1000),
      };
      w.__emit?.("native-chat://interactive-request", { sessionId, interactionId: "mc-intr-1" });
    }, { sessionId: chatSessionId });
    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });

    const modal = await openRunsTab(page);
    const card = modal.locator(".mission-card").first();
    await expect(card.locator(".mission-card-attention")).toContainText("Waiting on your answer", { timeout: 5_000 });

    // Answer the question in the chat — attention clears.
    await page.keyboard.press("Escape");
    await page.locator(".question-card-option", { hasText: "Yes" }).click();
    await page.locator(".question-card-actions button", { hasText: "Submit" }).click();
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });

    const modal2 = await openRunsTab(page);
    await expect(modal2.locator(".mission-card").first().locator(".mission-card-attention")).toHaveCount(0, { timeout: 5_000 });
  });

  test("Open chat focuses the owner chat", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);
    await seedRun(page, chatSessionId);

    const modal = await openRunsTab(page);
    await modal.locator(".mission-card").first().getByTitle("Focus the chat running this plan").click();
    // The planning modal closes and the chat panel is visible again.
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-panel").first()).toBeVisible();
  });

  test("unmet prerequisite raises the blocked state on the run card", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    // Plan B runs while its prerequisite plan A is unfinished → blocked.
    await page.evaluate(async ({ chatSessionId }) => {
      const w = window as InvokeWindow;
      const prereq = (await w.__basebuildInvoke?.("create_plan", {
        input: { sessionId: "session-1", title: "Prerequisite plan", description: "seeded" },
      })) as { id: string };
      const blocked = (await w.__basebuildInvoke?.("create_plan", {
        input: { sessionId: "session-1", title: "Blocked plan", description: "seeded" },
      })) as { id: string };
      await w.__basebuildInvoke?.("plan_set_dependencies", {
        request: { planId: blocked.id, prerequisites: [prereq.id] },
      });
      await w.__basebuildInvoke?.("plan_assign_to_chat", { planId: blocked.id, chatSessionId });
      w.__emit?.("planning://event", {
        kind: "run_started",
        entityId: blocked.id,
        projectPath: "C:\\basebuild-e2e\\project",
        sessionId: "session-1",
        title: "Blocked plan",
        seq: Date.now(),
        ts: Math.floor(Date.now() / 1000),
      });
    }, { chatSessionId });
    await page.waitForTimeout(500);

    const modal = await openRunsTab(page);
    const card = modal.locator(".mission-card").filter({ hasText: "Blocked plan" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".mission-card-state")).toHaveText("Blocked");
    await expect(card.locator(".mission-card-blockers")).toContainText("Waiting on prerequisites");
  });
});

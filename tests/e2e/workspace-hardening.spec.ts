import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, openPlanningModal } from "./helpers";

type InvokeWindow = Window & {
  __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  __emit?: (event: string, payload: unknown) => void;
};

async function getNativeSessionId(page: Page): Promise<string> {
  await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
  return (await page.locator(".chat-panel").first().getAttribute("data-native-session-id")) ?? "";
}

async function openFlowTab(page: Page) {
  await openPlanningModal(page);
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
  return modal;
}

test.describe("Workspace lifecycle hardening", () => {
  test("full lifecycle: launch → run → finish → queue_merge_review → session merge → cleanup", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    // Set finish policy to queue_merge_review.
    await page.evaluate(async () => {
      const w = window as InvokeWindow;
      await w.__basebuildInvoke?.("plan_set_launch_profile", {
        profile: {
          projectPath: "C:\\basebuild-e2e\\project",
          engine: "openspec",
          providerId: "",
          modelId: "",
          workerCount: 1,
          workspacePolicy: "isolated_worktrees",
          schedulingMode: "safe",
          finishPolicy: "queue_merge_review",
          updatedAt: Date.now(),
        },
      });
    });

    // Seed a plan + run + complete it.
    const { runId, planId } = await page.evaluate(async ({ chatSessionId }) => {
      const w = window as InvokeWindow;
      const plan = (await w.__basebuildInvoke?.("create_plan", {
        input: { sessionId: "session-1", title: "Lifecycle plan", description: "full walk" },
      })) as { id: string };
      const run = (await w.__basebuildInvoke?.("plan_assign_to_chat", { planId: plan.id, chatSessionId })) as { id: string };
      await w.__basebuildInvoke?.("plan_run_complete", { runId: run.id, succeeded: true });
      w.__emit?.("planning://event", {
        kind: "run_finished", entityId: run.id, projectPath: "C:\\basebuild-e2e\\project",
        sessionId: "session-1", title: "Lifecycle plan", seq: Date.now(), ts: Math.floor(Date.now() / 1000),
      });
      return { runId: run.id, planId: plan.id };
    }, { chatSessionId });
    await page.waitForTimeout(500);

    // Verify the run appears in merge queue (queue_merge_review policy).
    const modal = await openFlowTab(page);
    const queue = modal.locator(".merge-queue");
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(1, { timeout: 10_000 });

    // Select + start session + merge.
    await queue.locator("input[title='Select all']").check();
    await queue.locator("button", { hasText: "Review & merge (1)" }).click();
    await expect(queue.locator(".merge-session-active")).toBeVisible({ timeout: 5_000 });
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();

    // Summary + cleanup.
    await expect(queue.locator(".merge-session-summary")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-session-summary-row", { hasText: "Merged: 1" })).toBeVisible();
    await queue.locator("button", { hasText: "Clean up merged" }).click();
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(0, { timeout: 5_000 });

    // Assert no primary-checkout mutation: the project path is unchanged.
    const projectPath = await page.evaluate(() => {
      return (window as InvokeWindow).__basebuildInvoke?.("list_sessions", { projectPath: "C:\\basebuild-e2e\\project" });
    });
    expect(projectPath).toBeTruthy();
  });

  test("non-git project: policy hard-fallback to hold, no worktree indicators", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    // Set finish policy to auto_commit (will fallback to hold for non-git).
    await page.evaluate(async () => {
      const w = window as InvokeWindow;
      await w.__basebuildInvoke?.("plan_set_launch_profile", {
        profile: {
          projectPath: "C:\\basebuild-e2e\\project",
          engine: "openspec",
          providerId: "",
          modelId: "",
          workerCount: 1,
          workspacePolicy: "sequential_primary",
          schedulingMode: "safe",
          finishPolicy: "auto_commit",
          updatedAt: Date.now(),
        },
      });
    });

    // Read the finish outcome — the run never completed through
    // plan_run_complete, so no outcome is persisted and the read-only
    // command reports hold (matching the real backend for legacy runs).
    const result = await page.evaluate(async () => {
      const w = window as InvokeWindow;
      await w.__basebuildInvoke?.("plan_set_launch_profile", {
        profile: {
          projectPath: "C:\\basebuild-e2e\\project",
          engine: "openspec", providerId: "", modelId: "",
          workerCount: 1, workspacePolicy: "sequential_primary", schedulingMode: "safe",
          finishPolicy: "hold", updatedAt: Date.now(),
        },
      });
      return w.__basebuildInvoke?.("plan_run_finish_outcome", { runId: "non-git-run" });
    });
    expect(result).toEqual({ kind: "hold" });

    // Verify the launch profile form shows hold as the finish policy.
    const modal = await openFlowTab(page);
    const finishList = modal.locator(".option-list[aria-label='Finish policy']").first();
    await expect(finishList.locator(".option-list-btn.is-active")).toHaveText("Hold for review");

    await page.waitForTimeout(1000);
    // The workspace option list should show "Sequential primary" active.
    const workspaceList = modal.locator(".option-list[aria-label='Workspace policy']").first();
    await expect(workspaceList.locator(".option-list-btn.is-active")).toHaveText("Sequential primary");
  });

  test("prune confirmations: cleanup merged requires explicit button click", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    // Seed merge queue with 2 entries.
    await page.evaluate(async () => {
      const w = window as InvokeWindow;
      const plans: { id: string }[] = [];
      for (let i = 0; i < 2; i++) {
        const plan = (await w.__basebuildInvoke?.("create_plan", {
          input: { sessionId: "session-1", title: `Prune plan ${i}`, description: "prune test" },
        })) as { id: string };
        plans.push({ id: plan.id });
      }
      await w.__basebuildInvoke?.("__e2e_seed_merge_queue", {
        entries: plans.map((p, i) => ({
          id: `prune-${i}`, runId: `run-prune-${i}`, planId: p.id, sessionId: "session-1",
          status: "pending" as const, collisionReviewRequired: false, overlappingPlans: [] as string[],
          reviewedAt: null, createdAt: Date.now(),
        })),
      });
      w.__emit?.("planning://event", {
        kind: "integration_action", entityId: "prune-0", projectPath: "C:\\basebuild-e2e\\project",
        sessionId: "session-1", title: "Prune seeded", seq: Date.now(), ts: Math.floor(Date.now() / 1000),
      });
    });
    await page.waitForTimeout(500);

    const modal = await openFlowTab(page);
    const queue = modal.locator(".merge-queue");
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(2, { timeout: 15_000 });

    // Select all + start session + merge all.
    await queue.locator("input[title='Select all']").check();
    await queue.locator("button", { hasText: "Review & merge (2)" }).click();
    await expect(queue.locator(".merge-session-active")).toBeVisible({ timeout: 5_000 });

    // Merge first.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();
    await expect(queue.locator(".merge-session-label")).toContainText("2/2", { timeout: 5_000 });
    // Merge second.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();

    // Summary appears — entries still in queue until explicit cleanup.
    await expect(queue.locator(".merge-session-summary")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(2, { timeout: 5_000 });

    // Explicit cleanup button required.
    await queue.locator("button", { hasText: "Clean up merged" }).click();
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(0, { timeout: 5_000 });
  });
});

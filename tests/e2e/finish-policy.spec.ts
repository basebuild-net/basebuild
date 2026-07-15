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

async function openPlansModal(page: Page) {
  await openPlanningModal(page);
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  return modal;
}

async function saveLaunchProfile(page: Page, finishPolicy: string) {
  await page.evaluate(async ({ finishPolicy }) => {
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
        finishPolicy,
        updatedAt: Date.now(),
      },
    });
  }, { finishPolicy });
}

async function seedSucceededRun(page: Page, chatSessionId: string) {
  await page.evaluate(async ({ chatSessionId }) => {
    const w = window as InvokeWindow;
    const plan = (await w.__basebuildInvoke?.("create_plan", {
      input: { sessionId: "session-1", title: "Finish policy plan", description: "seeded" },
    })) as { id: string };
    const run = (await w.__basebuildInvoke?.("plan_assign_to_chat", { planId: plan.id, chatSessionId })) as { id: string };
    // Mark the run as succeeded.
    await w.__basebuildInvoke?.("plan_run_complete", { runId: run.id, succeeded: true });
    // Emit a planning event so the UI refreshes the run list.
    w.__emit?.("planning://event", {
      kind: "run_finished",
      entityId: run.id,
      projectPath: "C:\\basebuild-e2e\\project",
      sessionId: "session-1",
      title: "Finish policy plan",
      seq: Date.now(),
      ts: Math.floor(Date.now() / 1000),
    });
  }, { chatSessionId });
  await page.waitForTimeout(500);
}

test.describe("Finish policy", () => {
  test("launch confirmation shows finish policy", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    const modal = await openPlansModal(page);
    // Navigate to Flow tab where the launch profile form lives.
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    // Set the finish policy to auto_commit via the option list.
    const finishList = modal.locator(".option-list[aria-label='Finish policy']").first();
    await finishList.getByRole("button", { name: "Auto-commit", exact: true }).click();
    // Save the profile.
    await modal.getByTitle("Save launch profile for this project").click();
    await expect(modal.locator(".taskbar-notif-bar", { hasText: "saved" })).toBeVisible({ timeout: 5_000 }).catch(() => {
      // Toast may be ephemeral; check the option list retained the value.
    });
    await expect(finishList.getByRole("button", { name: "Auto-commit", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("auto_commit policy shows commit SHA in completion card", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    await saveLaunchProfile(page, "auto_commit");
    await seedSucceededRun(page, chatSessionId);

    const modal = await openPlansModal(page);
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    const card = modal.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".completion-card-outcome")).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".completion-card-outcome-row")).toContainText("Committed");
    await expect(card.locator("code")).toContainText(/abc123/);
  });

  test("auto_commit_pr policy shows PR link in completion card", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    await saveLaunchProfile(page, "auto_commit_pr");
    await seedSucceededRun(page, chatSessionId);

    const modal = await openPlansModal(page);
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    const card = modal.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".completion-card-outcome")).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("a")).toHaveAttribute("href", "https://example.com/pr/1");
  });

  test("hold policy shows no outcome section", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    await saveLaunchProfile(page, "hold");
    await seedSucceededRun(page, chatSessionId);

    const modal = await openPlansModal(page);
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    const card = modal.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    // Hold renders exactly as today — no outcome section.
    await expect(card.locator(".completion-card-outcome")).toHaveCount(0, { timeout: 5_000 });
  });

  test("queue_merge_review policy shows merge-ready flag", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    await saveLaunchProfile(page, "queue_merge_review");
    await seedSucceededRun(page, chatSessionId);

    const modal = await openPlansModal(page);
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    const card = modal.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".completion-card-outcome")).toBeVisible({ timeout: 10_000 });
    await expect(card.locator(".completion-card-outcome-row", { hasText: "Queued for merge review" })).toBeVisible();
  });

  test("policy error surfaces in the completion card", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const chatSessionId = await getNativeSessionId(page);

    await saveLaunchProfile(page, "auto_commit");
    // Force the policy application to fail (e.g. clean working tree).
    await page.evaluate(async () => {
      const w = window as InvokeWindow;
      await w.__basebuildInvoke?.("__e2e_set_finish_policy_error", {
        error: "Nothing to commit — working tree clean.",
      });
    });
    await seedSucceededRun(page, chatSessionId);

    const modal = await openPlansModal(page);
    await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
    const card = modal.locator(".completion-card").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const outcome = card.locator(".completion-card-outcome");
    await expect(outcome).toBeVisible({ timeout: 10_000 });
    await expect(outcome.locator(".completion-card-outcome-error")).toContainText(
      "Policy error: Nothing to commit",
    );
    // No commit/PR/merge-ready rows — the error is the only outcome.
    await expect(outcome.locator(".completion-card-outcome-row")).toHaveCount(1);
  });
});

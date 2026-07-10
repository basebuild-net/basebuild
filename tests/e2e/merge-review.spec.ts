import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

type InvokeWindow = Window & {
  __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  __emit?: (event: string, payload: unknown) => void;
};

async function openFlowTab(page: Page) {
  await page.getByTitle("Plans & Ideas").first().click();
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
  return modal;
}

async function seedMergeQueue(page: Page, entries: { id: string; planId: string; title: string }[]) {
  await page.evaluate(async ({ entries }) => {
    const w = window as InvokeWindow;
    // Create plans for each entry.
    const plans: { id: string }[] = [];
    for (const entry of entries) {
      const plan = (await w.__basebuildInvoke?.("create_plan", {
        input: { sessionId: "session-1", title: entry.title, description: "merge test" },
      })) as { id: string };
      plans.push({ id: plan.id });
    }
    // Seed merge queue entries.
    const queueEntries = entries.map((entry, i) => ({
      id: entry.id,
      runId: `run-${entry.id}`,
      planId: plans[i].id,
      sessionId: "session-1",
      status: "pending" as const,
      collisionReviewRequired: false,
      overlappingPlans: [] as string[],
      reviewedAt: null,
      createdAt: Date.now(),
    }));
    await w.__basebuildInvoke?.("__e2e_seed_merge_queue", { entries: queueEntries });
    // Trigger planning event to refresh the queue.
    w.__emit?.("planning://event", {
      kind: "integration_action",
      entityId: queueEntries[0].id,
      projectPath: "C:\\basebuild-e2e\\project",
      sessionId: "session-1",
      title: "Merge queue seeded",
      seq: Date.now(),
      ts: Math.floor(Date.now() / 1000),
    });
  }, { entries });
  await page.waitForTimeout(500);
}

test.describe("Workspace merge review", () => {
  test("multi-select + start session + merge all + summary + cleanup", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await seedMergeQueue(page, [
      { id: "mq-1", planId: "", title: "Merge plan A" },
      { id: "mq-2", planId: "", title: "Merge plan B" },
    ]);

    const modal = await openFlowTab(page);
    const queue = modal.locator(".merge-queue");
    await expect(queue).toBeVisible({ timeout: 10_000 });
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(2, { timeout: 10_000 });

    // Select all.
    await queue.locator("input[title='Select all']").check();
    await expect(queue.locator("button", { hasText: "Review & merge (2)" })).toBeEnabled();

    // Start session.
    await queue.locator("button", { hasText: "Review & merge (2)" }).click();
    await expect(queue.locator(".merge-session-active")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-session-label")).toContainText("1/2");

    // Merge first.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();
    await expect(queue.locator(".merge-session-label")).toContainText("2/2", { timeout: 5_000 });

    // Merge second.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();
    // Session ends, summary appears.
    await expect(queue.locator(".merge-session-summary")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-session-summary-row", { hasText: "Merged: 2" })).toBeVisible();

    // Clean up merged.
    await queue.locator("button", { hasText: "Clean up merged" }).click();
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(0, { timeout: 5_000 });
  });

  test("skip preserves entry and advances to next", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await seedMergeQueue(page, [
      { id: "mq-skip-1", planId: "", title: "Skip plan A" },
      { id: "mq-skip-2", planId: "", title: "Skip plan B" },
    ]);

    const modal = await openFlowTab(page);
    const queue = modal.locator(".merge-queue");
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(2, { timeout: 10_000 });

    // Select all + start.
    await queue.locator("input[title='Select all']").check();
    await queue.locator("button", { hasText: "Review & merge (2)" }).click();
    await expect(queue.locator(".merge-session-active")).toBeVisible({ timeout: 5_000 });

    // Skip first.
    await queue.locator(".merge-session-actions button", { hasText: "Skip" }).click();
    await expect(queue.locator(".merge-session-label")).toContainText("2/2", { timeout: 5_000 });

    // Merge second.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();
    await expect(queue.locator(".merge-session-summary")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-session-summary-row", { hasText: "Skipped: 1" })).toBeVisible();
    await expect(queue.locator(".merge-session-summary-row", { hasText: "Merged: 1" })).toBeVisible();
  });

  test("stop ends session early with partial results", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await seedMergeQueue(page, [
      { id: "mq-stop-1", planId: "", title: "Stop plan A" },
      { id: "mq-stop-2", planId: "", title: "Stop plan B" },
    ]);

    const modal = await openFlowTab(page);
    const queue = modal.locator(".merge-queue");
    await expect(queue.locator(".merge-queue-entry")).toHaveCount(2, { timeout: 10_000 });

    await queue.locator("input[title='Select all']").check();
    await queue.locator("button", { hasText: "Review & merge (2)" }).click();
    await expect(queue.locator(".merge-session-active")).toBeVisible({ timeout: 5_000 });

    // Merge first, then stop.
    await queue.locator(".merge-session-actions button", { hasText: "Merge" }).click();
    await expect(queue.locator(".merge-session-label")).toContainText("2/2", { timeout: 5_000 });
    await queue.locator(".merge-session-actions button", { hasText: "Stop" }).click();

    // Session ends with partial results.
    await expect(queue.locator(".merge-session-summary")).toBeVisible({ timeout: 5_000 });
    await expect(queue.locator(".merge-session-summary-row", { hasText: "Merged: 1" })).toBeVisible();
  });
});

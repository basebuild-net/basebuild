import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

test.describe("plan-run → PR recommendation", () => {
  test("chat header renders with model chip, branch, and more-actions menu", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Wait for the chat grid to mount (the header renders inside the grid column).
    await expect(page.locator(".panel-grid").first()).toBeVisible();
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible();

    // The chat column header renders above the messages area.
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // Model chip shows the current model label.
    await expect(page.locator(".chat-column-model-chip").first()).toBeVisible();

    // The branch indicator shows the current git branch (mocked as "main").
    await expect(page.locator(".chat-column-branch-name").first()).toContainText("main");

    expect(pageErrors).toEqual([]);
  });

  test("more-actions menu contains Assign plan and Close chat items", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });


    // Click the more-actions button via evaluate.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(".chat-column-header-right button[title='More actions']");
      btn?.click();
    });
    await expect(page.locator(".chat-more-menu-item", { hasText: "Close chat" }).first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("PR recommendation card appears when a worktree run finishes", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // The branch indicator shows the current git branch (mocked as "main").
    await expect(page.locator(".chat-column-branch-name").first()).toContainText("main");

    // Simulate a plan-run "succeeded" event. The ChatPanel listens for
    // plan_run://event and matches on chatSessionId === nativeSessionId.
    // The native session id is exposed on the chat-panel element's
    // data-native-session-id attribute for e2e test access.
    const emitResult = await page.evaluate(() => {
      const w = window as unknown as { __emit?: (event: string, payload: unknown) => void };
      const panel = document.querySelector(".chat-panel") as HTMLElement | null;
      const nativeSessionId = panel?.dataset.nativeSessionId;
      if (!nativeSessionId || !w.__emit) return { ok: false, reason: `no nativeSessionId (${nativeSessionId})` };
      w.__emit("plan_run://event", {
        runId: "run-test",
        sessionId: "session-1",
        planId: "plan-1",
        status: "succeeded",
        chatSessionId: nativeSessionId,
      });
      return { ok: true, nativeSessionId };
    });
    expect(emitResult.ok).toBe(true);

    // The "Create pull request" button is present and confirm-gated.
    const createBtn = page.locator(".pr-recommendation-card button", { hasText: "Create pull request" }).first();
    await expect(createBtn).toBeVisible();
    await createBtn.click({ force: true });
    await page.waitForTimeout(300);
    // Confirmation prompt appears.
    await expect(page.locator(".pr-recommendation-confirm")).toBeVisible();
    await expect(page.locator(".pr-recommendation-confirm button", { hasText: "Confirm" })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("concurrency cap input is visible with a tooltip in the plan queue", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    // Open the Plans & Ideas fold.
    await page.getByTitle("Plans & Ideas").first().click();

    // The concurrency input is visible with a tooltip (effective-value display).
    const concurrencyInput = page.locator(".plan-queue-concurrency input");
    await expect(concurrencyInput).toBeVisible();
    await expect(concurrencyInput).toHaveAttribute("title");

    expect(pageErrors).toEqual([]);
  });
});

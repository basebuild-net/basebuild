import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

/** Open Plans & Ideas on the Flow tab and click the Generate ideas action. */
async function startRoundFromFlowBoard(page: Page) {
  await page.getByTitle("Plans & Ideas").first().click();
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
  await modal.getByTitle("Generate more grounded ideas from the project schematic").click();
}

/** Seed an idea through the mocked backend (tagged with the active round). */
async function seedIdea(page: Page, title: string) {
  await page.evaluate(async ({ title }) => {
    const w = window as unknown as {
      __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    await w.__basebuildInvoke?.("create_idea", {
      sessionId: "session-1",
      title,
      description: "seeded during round",
      grounding: "observed gap in tests",
    });
  }, { title });
}

test.describe("Idea rounds", () => {
  test("soft gate warns without a schematic; proceed starts the round and destination picker", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundFromFlowBoard(page);

    // Fixture has no schematic — the soft gate names the gap with an
    // explicit proceed-anyway path (never a silent redirect).
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await expect(gate).toContainText(/no schematic|missing/i);
    await gate.getByTitle("Run the round with whatever grounding exists").click();

    // Round started: destination picker opens to deliver the prompt.
    await expect(page.locator(".destination-picker, .modal-overlay").filter({ hasText: "Send to" })).toBeVisible({ timeout: 5_000 });
  });

  test("gate cancel starts nothing", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundFromFlowBoard(page);
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await gate.getByTitle("Cancel the round").click();
    await expect(gate).not.toBeVisible();

    // No round exists — the planning modal stayed open; switch to Ideas.
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    await expect(modal.locator(".idea-rounds-empty")).toBeVisible({ timeout: 5_000 });
  });

  test("round captures are tagged, reviewable, and deploy creates plans", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundFromFlowBoard(page);
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await gate.getByTitle("Run the round with whatever grounding exists").click();

    // Deliver the round prompt into a new conversation.
    const picker = page.locator(".modal-overlay").filter({ hasText: "Send to" });
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await picker.getByTitle("Create a new chat panel for this prompt").click();
    await picker.getByTitle("Deliver prompt to the selected destination").click();
    await expect(picker).not.toBeVisible({ timeout: 5_000 });

    // Ideas captured while the round is active get its batch id (mock mirrors
    // the backend active-round tagging).
    await seedIdea(page, "Round idea alpha");
    await seedIdea(page, "Round idea beta");

    // Open the round review.
    await page.getByTitle("Plans & Ideas").first().click();
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();

    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow).toContainText("2 captured");
    await roundRow.click();

    // Select both ideas and deploy behind the enumerated confirmation.
    const review = modal.locator(".idea-round-review");
    await expect(review.locator(".idea-round-idea")).toHaveCount(2);
    for (const box of await review.locator("input[type=checkbox]").all()) {
      await box.check();
    }
    await review.getByTitle(/Deploy 2 idea/).click();
    const confirm = modal.locator(".idea-round-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Round idea alpha");
    await expect(confirm).toContainText("Round idea beta");
    await confirm.getByTitle("Create the plans").click();

    // Deploy lands on the Plans tab with two new draft plans.
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Round idea alpha" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Round idea beta" })).toBeVisible();
  });

  test("cancelling the destination picker abandons the round", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundFromFlowBoard(page);
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await gate.getByTitle("Run the round with whatever grounding exists").click();

    const picker = page.locator(".modal-overlay").filter({ hasText: "Send to" });
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible({ timeout: 5_000 });

    // The abandoned round is finished, not running.
    await page.getByTitle("Plans & Ideas").first().click();
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow.locator(".idea-round-status")).toHaveText("succeeded");
  });
});

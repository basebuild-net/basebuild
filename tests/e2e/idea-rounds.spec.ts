import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openMvpFixtureProject, waitForAppReady, openPlanningModal } from "./helpers";

/** Open Plans & Ideas on the Flow tab and click the Generate ideas action. */
async function startRoundFromFlowBoard(page: Page) {
  await openPlanningModal(page);
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await modal.locator(".inspector-tab", { hasText: "Flow" }).click();
  await modal.getByTitle("Generate more grounded ideas from the project schematic").click();
}
async function chooseGuidedSetup(page: Page) {
  const setup = page.getByRole("dialog", { name: "Configure idea round" });
  await expect(setup).toBeVisible({ timeout: 5_000 });
  await setup.getByRole("button", { name: /Give direction/ }).click();
  await expect(setup.getByRole("heading", { name: "Give the studio direction" })).toBeVisible();
  await setup.getByRole("textbox", { name: /What should the ideas focus on/ }).fill("Improve reliability without adding setup burden.");
  await setup.getByRole("button", { name: "Customize" }).click();
  const categories = setup.locator(".idea-round-category-option");
  const count = await categories.count();
  for (let index = 0; index < Math.min(count, 2); index += 1) {
    await categories.nth(index).click();
  }
  await expect(setup.getByTitle("Current round scope")).toContainText(count > 1 ? "2 categories" : count === 1 ? "1 category" : "Project-wide");
  await setup.getByRole("button", { name: "Choose chat" }).click();
}

async function chooseAutoGenerate(page: Page) {
  const setup = page.getByRole("dialog", { name: "Configure idea round" });
  await expect(setup).toBeVisible({ timeout: 5_000 });
  await expect(setup.getByRole("button", { name: /Auto-generate ideas/ })).toBeVisible();
  await expect(setup.getByRole("button", { name: /Give direction/ })).toBeVisible();
  await setup.getByRole("button", { name: /Auto-generate ideas/ }).click();
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

/** Start a round directly through the mocked backend (bypasses the gate UI). */
async function startRoundDirect(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    await w.__basebuildInvoke?.("start_idea_round", { sessionId: "session-1" });
  });
}

/** Open the Plans & Ideas modal on the Ideas tab. */
async function openIdeasTab(page: Page) {
  await openPlanningModal(page);
  const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
  await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
  return modal;
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
    await chooseAutoGenerate(page);

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

  test("native skill captures a grounded round and approval creates draft plans", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await ensureChatPanel(page);

    // Route the round through a connected native provider so the model can
    // inspect project context and call the propose_ideas tool.
    await page.locator(".chat-column-model-chip").first().click();
    await page.locator(".provider-card", { hasText: "Umans" }).first().click();
    await page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first().click();

    await startRoundFromFlowBoard(page);
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await gate.getByTitle("Run the round with whatever grounding exists").click();
    await chooseGuidedSetup(page);

    // Deliver to the configured chat. The transcript must show the compact
    // skill invocation immediately, not the internal system prompt.
    const picker = page.locator(".modal-overlay").filter({ hasText: "Send to" });
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await picker.locator('.destination-picker-item[title^="Send to"]').first().click();
    await picker.getByTitle("Deliver prompt to the selected destination").click();
    await expect(picker).not.toBeVisible({ timeout: 5_000 });

    const skillInvocation = page.locator(".chat-message-user").filter({ has: page.locator(".chat-command-chip") }).first();
    await expect(skillInvocation.locator(".chat-command-chip")).toContainText("/skill:basebuild-planning");
    await expect(skillInvocation).not.toContainText("You are Basebuild");
    await expect(page.locator(".chat-thinking-indicator")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".tool-card", { hasText: "read file" }).last()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".chat-message-assistant").last()).toContainText("Captured 2 grounded ideas", { timeout: 5_000 });

    // Open the round review after the native propose_ideas capture finishes.
    await openPlanningModal(page);
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();

    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow).toContainText("2 captured");
    await roundRow.click();

    // Select both ideas and approve them behind the enumerated confirmation.
    const review = modal.locator(".idea-round-review");
    await expect(review.locator(".idea-round-idea")).toHaveCount(2);
    for (const box of await review.locator("input[type=checkbox]").all()) {
      await box.check();
    }
    await review.getByTitle(/Approve 2 idea/).click();
    const confirm = modal.locator(".idea-round-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Improve onboarding");
    await expect(confirm).toContainText("Cache provider catalog");
    await confirm.getByTitle("Approve ideas and create plans").click();

    // Approval lands on the Plans tab with two independent draft plans.
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Improve onboarding" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Cache provider catalog" })).toBeVisible();

    // OpenSpec generation and queue approval are separate user decisions.
    const alphaPlan = modal.locator(".plan-card").filter({ hasText: "Improve onboarding" });
    await alphaPlan.getByRole("button", { name: "Generate OpenSpec" }).click();
    await expect(alphaPlan.getByRole("button", { name: "Approve plan" })).toBeVisible({ timeout: 5_000 });
    await alphaPlan.getByRole("button", { name: "Approve plan" }).click();
    await expect(
      modal.locator(".plan-lane").filter({ hasText: "Ready" }).filter({ hasText: "Improve onboarding" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("cancelling the destination picker abandons the round", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundFromFlowBoard(page);
    const gate = page.locator(".idea-round-gate");
    await expect(gate).toBeVisible({ timeout: 5_000 });
    await gate.getByTitle("Run the round with whatever grounding exists").click();
    await chooseGuidedSetup(page);

    const picker = page.locator(".modal-overlay").filter({ hasText: "Send to" });
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible({ timeout: 5_000 });

    // The abandoned round is finished, not running.
    await openPlanningModal(page);
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow.locator(".idea-round-status")).toHaveText("succeeded");
  });

  test("End round finishes a running round in place", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundDirect(page);
    await seedIdea(page, "Mid-round capture");

    const modal = await openIdeasTab(page);
    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow.locator(".idea-round-status")).toHaveText("running");

    const endButton = roundRow.getByTitle("End this round — new captures stop being tagged with it");
    await expect(endButton).toBeVisible();
    await endButton.click();

    // The round transitions in place; the End action disappears.
    await expect(roundRow.locator(".idea-round-status")).toHaveText("succeeded", { timeout: 5_000 });
    await expect(endButton).not.toBeVisible();

    // Captures after the round ended are no longer tagged with it.
    await seedIdea(page, "Post-round capture");
    await expect(roundRow).toContainText("1 captured", { timeout: 5_000 });
  });

  test("approval isolates per-idea failures and still creates the rest", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundDirect(page);
    await seedIdea(page, "Deploy survivor");
    await seedIdea(page, "Deploy casualty");
    // The second idea fails promotion; the first must still land as a plan.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      const ideas = (await w.__basebuildInvoke?.("list_ideas", { sessionId: "session-1" })) as { id: string; title: string }[];
      const casualty = ideas.find((i) => i.title === "Deploy casualty");
      await w.__basebuildInvoke?.("__e2e_fail_promote_ideas", { ideaIds: [casualty?.id ?? ""] });
    });

    const modal = await openIdeasTab(page);
    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await roundRow.click();

    const review = modal.locator(".idea-round-review");
    await expect(review.locator(".idea-round-idea")).toHaveCount(2);
    for (const box of await review.locator("input[type=checkbox]").all()) {
      await box.check();
    }
    await review.getByTitle(/Approve 2 idea/).click();
    await modal.locator(".idea-round-confirm").getByTitle("Approve ideas and create plans").click();

    // Partial failure is reported, not swallowed; navigation still happens.
    await expect(page.locator(".toast-title", { hasText: "1 plan(s) created, 1 failed" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Deploy survivor" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Deploy casualty" })).toHaveCount(0);
  });

  test("a round with zero captures shows the empty review state", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await startRoundDirect(page);

    const modal = await openIdeasTab(page);
    const roundRow = modal.locator(".idea-round-row").first();
    await expect(roundRow).toBeVisible({ timeout: 5_000 });
    await expect(roundRow).toContainText("0 captured");
    await roundRow.click();

    const review = modal.locator(".idea-round-review");
    await expect(review).toBeVisible({ timeout: 5_000 });
    await expect(review).toContainText("No ideas captured in this round yet.");
  });
});

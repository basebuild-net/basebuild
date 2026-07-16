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
  await setup.getByRole("button", { name: /Fixes/ }).click();
  await setup.getByPlaceholder("Example: Keep each idea achievable in one afternoon.").fill("Improve reliability without adding setup burden.");
  await expect(setup.getByTitle("Current generation scope")).toContainText("1 focus area");
  await setup.getByRole("button", { name: "Choose chat" }).click();
}

async function chooseAutoGenerate(page: Page) {
  const setup = page.getByRole("dialog", { name: "Configure idea round" });
  await expect(setup).toBeVisible({ timeout: 5_000 });
  await expect(setup.getByRole("button", { name: /Anything useful/ })).toHaveAttribute("aria-pressed", "true");
  await setup.getByRole("button", { name: "Choose chat" }).click();
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
      assessment: {
        schemaVersion: 1,
        effort: { minHours: 3, maxHours: 6 },
        difficulty: 4,
        impact: 4,
        risk: 3,
        confidence: 4,
        rationale: "The fixture spans a bounded service and UI surface.",
        grounding: ["observed gap in tests"],
        requiredCapabilities: ["tools"],
        constraints: [],
        missingEvidence: [],
        alternatives: [],
      },
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

    // No generated ideas exist; the Ideas tab presents one clear empty state.
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    await expect(modal.locator(".inspector-ideas-list .chat-idea-card")).toHaveCount(2);
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

    // Ideas appear directly as readable cards; there is no second round-history wall.
    await openPlanningModal(page);
    const modal = page.locator(".modal-overlay").filter({ hasText: "Plans & Ideas" });
    await modal.locator(".inspector-tab", { hasText: "Ideas" }).click();
    const ideas = modal.locator(".inspector-ideas-list .chat-idea-card");
    await expect(ideas).toHaveCount(4, { timeout: 5_000 });
    await expect(ideas.filter({ hasText: /Improve onboarding|Cache provider catalog/ })).toHaveCount(2);
    await expect(modal.locator(".idea-round-row")).toHaveCount(0);

    // One action promotes the idea and immediately starts OpenSpec preparation.
    const onboarding = ideas.filter({ hasText: "Improve onboarding" });
    await onboarding.getByRole("button", { name: "Make plan" }).click();
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible({ timeout: 5_000 });
    const alphaPlan = modal.locator(".plan-card, .plan-row").filter({ hasText: "Improve onboarding" });
    await expect(alphaPlan).toBeVisible({ timeout: 5_000 });
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

    const rounds = await page.evaluate(async () => {
      const w = window as unknown as {
        __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      return w.__basebuildInvoke?.("list_idea_rounds", { sessionId: "session-1" });
    }) as { status: string }[];
    expect(rounds[0]?.status).toBe("succeeded");
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
    const cards = modal.locator(".inspector-ideas-list .chat-idea-card");
    await expect(cards).toHaveCount(4);
    const deployCards = cards.filter({ hasText: /Deploy survivor|Deploy casualty/ });
    await expect(deployCards).toHaveCount(2);
    for (const box of await deployCards.locator("input[type=checkbox]").all()) {
      await box.check();
    }
    await modal.getByTitle("Promote selected ideas into plans").click();

    // Partial failure is visible; the surviving plan still enters preparation.
    await expect(modal.locator(".inspector-tab.is-active", { hasText: "Plans" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Deploy survivor" })).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".plan-card, .plan-row").filter({ hasText: "Deploy casualty" })).toHaveCount(0);
  });


  test("completed idea batch opens a review workbench and collapses into history", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 720 });
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await ensureChatPanel(page);
    await startRoundDirect(page);
    await seedIdea(page, "Recover interrupted plans");
    await seedIdea(page, "Rank models by local capacity");

    const sessionId = "nchat_mvp-charlie";
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as { __emit?: (event: string, payload: unknown) => void };
      w.__emit?.("native-chat://tool-event", {
        sessionId,
        toolCallId: "ideas-review-1",
        toolName: "propose_ideas",
        kind: "propose_ideas",
        status: "success",
        summary: "Captured 2 grounded ideas.",
        arguments: JSON.stringify({
          categoryId: null,
          ideas: [
            { title: "Recover interrupted plans", description: "seeded during round", grounding: "observed gap in tests" },
            { title: "Rank models by local capacity", description: "seeded during round", grounding: "observed gap in tests" },
          ],
        }),
      });
    }, { sessionId });

    const workbench = page.locator(".idea-review-workbench");
    await expect(workbench).toBeVisible({ timeout: 5_000 });
    await expect(workbench.locator(".idea-review-card")).toHaveCount(1);
    await expect(workbench).toBeInViewport();
    expect(await workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(workbench).toContainText("Recover interrupted plans");
    await workbench.getByTitle("Compare this estimate with connected provider routes and local usage").click();
    await expect(workbench.locator(".execution-advisor-card")).toContainText("Umans GLM 5.2");
    await expect(workbench.locator(".execution-advisor-boundary")).toContainText("no project text uploaded");
    await workbench.getByRole("button", { name: "Pass" }).click();
    await expect(workbench).toContainText("Rank models by local capacity");
    await workbench.getByTitle("Minimize idea review").click();
    const preview = page.locator(".chat-idea-batch-preview");
    await expect(preview).toContainText("2 ideas");
    await preview.click();
    await expect(workbench).toContainText("Rank models by local capacity");
    await workbench.getByRole("button", { name: "Back" }).click();
    await expect(workbench).toContainText("Passed");
  });
});

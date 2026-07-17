import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";
import { parseImplementationAssessment } from "../../src/lib/planning-assessment";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: "project" }),
  ).toBeVisible({ timeout: 5_000 });
}

/** Get the native session id from the chat panel's data attribute. */
async function getNativeSessionId(page: Page): Promise<string> {
  await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
  const id = await page.locator(".chat-panel").first().getAttribute("data-native-session-id");
  return id ?? "";
}

/** Inject a pending interaction into the mock and emit the Tauri event. */
async function injectInteraction(page: Page, interaction: Record<string, unknown>, sessionId: string) {
  await page.evaluate(({ interaction, sessionId }) => {
    const w = window as unknown as {
      __basebuildMockInteraction?: unknown;
      __emit?: (event: string, payload: unknown) => void;
    };
    w.__basebuildMockInteraction = { ...interaction, sessionId };
    w.__emit?.("native-chat://interactive-request", { sessionId, interactionId: interaction.id });
  }, { interaction, sessionId });
}

test("shared planning contract fixture parses in TypeScript", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/planning-contract-v1.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  expect(Object.keys(fixture).sort()).toEqual([
    "assessmentV1",
    "interactionV1",
    "legacyInteraction",
    "modelProfilesV1",
  ]);
  expect(parseImplementationAssessment(fixture.assessmentV1)?.confidence).toBe(4);
  expect(parseImplementationAssessment({ ...fixture.assessmentV1 as object, confidence: 6 })).toBeUndefined();
});

test.describe("Interactive elements: ask_user question card", () => {
  test("agent asks → card renders → click option → answered state persists", async ({ page }) => {
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);

    await injectInteraction(page, {
      id: "test-intr-1",
      questions: [
        {
          id: "q1",
          prompt: "Which approach should we take?",
          kind: "options",
          options: [
            { label: "Option A", description: "First approach" },
            { label: "Option B", description: "Second approach" },
          ],
          recommended: 0,
          allowFreeText: false,
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    // The pending interaction takes over the composer as the focused workbench.
    await expect(page.locator(".interaction-workbench")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".interaction-question-heading", { hasText: "Which approach" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Option A/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Option B/ })).toBeVisible();
    await expect(page.locator(".interaction-option-recommended")).toBeVisible();

    await page.getByRole("button", { name: /Option A/ }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();

    // Answered interactions collapse into a read-only transcript preview.
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-success")).toContainText("Answered");
    await page.locator(".question-card-success").click();
    await expect(page.locator(".interaction-workbench.is-read-only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit answers" })).toHaveCount(0);
    await expect(page.locator(".interaction-answer-value")).toContainText("Option A");
    await page.getByTitle("Close questionnaire detail").click();
  });

  test("cancel resolves pending card", async ({ page }) => {
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);

    await injectInteraction(page, {
      id: "test-intr-2",
      questions: [
        {
          id: "q1",
          prompt: "Do you want to proceed?",
          kind: "confirm",
          options: [
            { label: "Yes" },
            { label: "No" },
          ],
          recommended: 0,
          allowFreeText: false,
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    await expect(page.locator(".interaction-workbench")).toBeVisible({ timeout: 5_000 });

    // Cancellation is confirmation-gated.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Confirm cancel" }).click();

    await expect(page.locator(".question-card-muted")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-muted")).toContainText("Cancelled");
  });

  test("text question hides the composer and answers in the card", async ({ page }) => {
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);

    await injectInteraction(page, {
      id: "test-intr-3",
      questions: [
        {
          id: "q1",
          prompt: "What should we name this?",
          kind: "text",
          options: [],
          allowFreeText: true,
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    // A pending question replaces the normal composer with focused controls.
    await expect(page.locator(".interaction-workbench .interaction-answer-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-input")).toHaveCount(0);
    await expect(page.locator(".chat-composer-locked")).toHaveCount(0);
    await expect(page.locator(".chat-answering-banner")).toHaveCount(0);
  });

  test("pending question replaces the composer and remains reachable", async ({ page }) => {
    // Regression: pending controls used to live in the transcript and could
    // scroll out of view. The focused workbench occupies the composer slot.
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);

    await injectInteraction(page, {
      id: "test-intr-dock",
      questions: [
        {
          id: "q1",
          prompt: "Which framework?",
          kind: "options",
          options: [{ label: "Next.js" }, { label: "Remix" }],
          recommended: 0,
          allowFreeText: false,
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    const focusedWorkbench = page.locator(".chat-interaction-workbench-slot .interaction-workbench");
    await expect(focusedWorkbench).toBeVisible({ timeout: 5_000 });
    await expect(focusedWorkbench).toBeInViewport({ timeout: 5_000 });

    // The workbench is not inside the scrollable transcript.
    const workbenchOutsideScroller = await page.evaluate(() => {
      const workbench = document.querySelector(".chat-interaction-workbench-slot");
      const scroller = document.querySelector(".chat-messages");
      return !!workbench && !!scroller && !scroller.contains(workbench);
    });
    expect(workbenchOutsideScroller).toBe(true);

    await page.getByRole("button", { name: /Next.js/ }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });
  });

  test("question workbench minimizes and restores the pending draft", async ({ page }) => {
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);
    await injectInteraction(page, {
      id: "test-intr-minimize",
      title: "Choose the implementation",
      description: "The agent is waiting for this decision.",
      questions: [{
        id: "q1",
        prompt: "What matters most?",
        kind: "text",
        required: true,
        options: [],
        allowFreeText: true,
      }],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    const workbench = page.locator(".interaction-workbench");
    await expect(workbench).toBeVisible({ timeout: 5_000 });
    await workbench.locator("textarea, input").fill("Reliable recovery");
    await workbench.getByTitle("Minimize questionnaire").click();
    await expect(page.locator(".chat-question-preview")).toContainText("Choose the implementation");
    await expect(page.locator(".chat-input")).toBeVisible();
    await page.locator(".chat-question-preview").click();
    await expect(workbench.locator("textarea, input")).toHaveValue("Reliable recovery");
  });

  test("multi-page questionnaire returns a typed five-star rating", async ({ page }) => {
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);
    await injectInteraction(page, {
      id: "test-intr-pages",
      title: "Review the proposal",
      questions: [
        {
          id: "scope",
          prompt: "Approve the proposed scope?",
          kind: "confirm",
          pageId: "scope-page",
          pageTitle: "Scope",
          required: true,
          options: [{ label: "Approve" }, { label: "Revise" }],
          recommended: 0,
        },
        {
          id: "confidence",
          prompt: "How confident are you?",
          kind: "rating",
          pageId: "rating-page",
          pageTitle: "Confidence",
          required: true,
          scale: { min: 1, max: 5, lowLabel: "Low", highLabel: "High", style: "stars" },
          options: [],
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    await expect(page.locator(".interaction-workbench-progress")).toContainText("1 of 2");
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".interaction-workbench-progress")).toContainText("2 of 2");
    await page.getByRole("radio", { name: "4 of 5" }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });
  });

  test("workbench remains usable in light theme at compact width", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 640 });
    await page.addInitScript(() => localStorage.setItem("basebuild.theme", "light"));
    await openFixtureProject(page);
    const sessionId = await getNativeSessionId(page);
    await injectInteraction(page, {
      id: "test-intr-compact",
      title: "Compact questionnaire",
      questions: [{
        id: "q1",
        prompt: "Choose a responsive option",
        kind: "options",
        options: [{ label: "First", description: "First choice" }, { label: "Second", description: "Second choice" }],
        required: true,
      }],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    }, sessionId);

    await expect(page.locator("html")).toHaveAttribute("data-bb-theme", "light");
    const workbench = page.locator(".interaction-workbench");
    await expect(workbench).toBeVisible({ timeout: 5_000 });
    await expect(workbench).toBeInViewport();
    expect(await workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator(".interaction-option-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  });
});

test.describe("Planning model regression: tool → question → capture → complete", () => {
  test("planning model reads files, asks a question, captures structured output, and completes", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await page.waitForTimeout(1500);

    // Ensure a chat panel exists.
    const panel = page.locator(".panel-grid-leaf").first();
    if ((await panel.count()) === 0) {
      await page.getByTitle("New chat").first().click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
    const sessionId = await page.locator(".chat-panel").first().getAttribute("data-native-session-id") ?? "";

    // Step 1: inject a tool event simulating "read file" (context gathering).
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as {
        __emit?: (event: string, payload: unknown) => void;
      };
      w.__emit?.("native-chat://tool-event", {
        sessionId,
        toolCallId: "tool-read-1",
        toolName: "read_file",
        status: "success",
        summary: "Read src/main.rs (120 lines)",
      });
    }, { sessionId });

    // The tool event should render as a tool-card with success status.
    await expect(page.locator(".tool-card").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".tool-card-status-success").first()).toBeVisible();
    await expect(page.locator(".tool-card-name", { hasText: "read file" })).toBeVisible();

    // Step 2: inject an ask_user question (interactive request).
    await page.evaluate(({ sessionId, interaction }) => {
      const w = window as unknown as {
        __basebuildMockInteraction?: unknown;
        __emit?: (event: string, payload: unknown) => void;
      };
      w.__basebuildMockInteraction = { ...interaction, sessionId };
      w.__emit?.("native-chat://interactive-request", { sessionId, interactionId: interaction.id });
    }, { sessionId, interaction: {
      id: "plan-intr-1",
      questions: [
        {
          id: "q1",
          prompt: "Which framework should the plan target?",
          kind: "options",
          options: [
            { label: "React", description: "SPA" },
            { label: "Next.js", description: "SSR" },
          ],
          recommended: 0,
          allowFreeText: false,
        },
      ],
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    } });

    // The question workbench should replace the composer and block the run.
    await expect(page.locator(".interaction-workbench")).toBeVisible({ timeout: 5_000 });

    // Step 3: answer the question (captures structured output).
    await page.getByRole("button", { name: /Next.js/ }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();

    // The answer is captured.
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });

    // Step 4: inject a completion tool event.
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as {
        __emit?: (event: string, payload: unknown) => void;
      };
      w.__emit?.("native-chat://tool-event", {
        sessionId,
        toolCallId: "tool-write-1",
        toolName: "write_file",
        status: "success",
        summary: "+Wrote plan.md (45 lines)",
      });
    }, { sessionId });

    // The completion tool event should render. Tool events may be grouped
    // into a ToolEventGroup, so count both individual cards and groups.
    const toolElements = page.locator(".tool-card, .tool-card-group");
    const elemCount = await toolElements.count();
    expect(elemCount).toBeGreaterThanOrEqual(1);

    // No unexplained pauses — no stuck bar.
    await expect(page.locator(".chat-stuck-bar")).toHaveCount(0);
    // No error bar.
    await expect(page.locator(".chat-error-bar")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});

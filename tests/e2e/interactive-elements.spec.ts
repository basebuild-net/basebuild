import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

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

    // The QuestionCard should render with the prompt and options.
    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-prompt", { hasText: "Which approach" })).toBeVisible();
    await expect(page.locator(".question-card-option", { hasText: "Option A" })).toBeVisible();
    await expect(page.locator(".question-card-option", { hasText: "Option B" })).toBeVisible();

    // The recommended option should be marked.
    await expect(page.locator(".question-card-recommended")).toBeVisible();

    // Click Option A to select it.
    await page.locator(".question-card-option", { hasText: "Option A" }).click();

    // Submit the answer.
    await page.locator(".question-card-actions button", { hasText: "Submit" }).click();

    // The card should transition to answered state.
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-status", { hasText: "Answered" })).toBeVisible();
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

    // The QuestionCard should render.
    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });

    // Click Cancel.
    await page.locator(".question-card-actions button", { hasText: "Cancel" }).click();

    // The card should transition to cancelled state.
    await expect(page.locator(".question-card-muted")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-status", { hasText: "Cancelled" })).toBeVisible();
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

    // New flow: a pending question hides the composer; the answer is captured
    // in the docked QuestionCard's text input, not the composer.
    await expect(page.locator(".chat-question-dock .question-card-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-input")).toHaveCount(0);
    await expect(page.locator(".chat-composer-locked")).toBeVisible();
    await expect(page.locator(".chat-answering-banner")).toHaveCount(0);
  });

  test("pending question is docked above the composer and always reachable", async ({ page }) => {
    // Regression: the pending question card lived inline in the transcript and
    // scrolled out of view behind streamed content, leaving only the cryptic
    // "/send to escape" banner. It now docks above the composer, outside the
    // scroll container, so its controls are always on screen.
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

    // The pending card renders inside the dock (a sibling of the scroll
    // container, not inside it) and is in the viewport.
    const dockedCard = page.locator(".chat-question-dock .question-card-pending");
    await expect(dockedCard).toBeVisible({ timeout: 5_000 });
    await expect(dockedCard).toBeInViewport({ timeout: 5_000 });

    // The dock is NOT inside the scrollable transcript.
    const dockOutsideScroller = await page.evaluate(() => {
      const dock = document.querySelector(".chat-question-dock");
      const scroller = document.querySelector(".chat-messages");
      return !!dock && !!scroller && !scroller.contains(dock);
    });
    expect(dockOutsideScroller).toBe(true);

    // Its Submit control is clickable and resolves the question.
    await page.locator(".question-card-option", { hasText: "Next.js" }).click();
    await page.locator(".question-card-actions button", { hasText: "Submit" }).click();
    await expect(page.locator(".question-card-success")).toBeVisible({ timeout: 5_000 });
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

    // The question card should render inline (blocking the run).
    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });

    // Step 3: answer the question (captures structured output).
    await page.locator(".question-card-option", { hasText: "Next.js" }).click();
    await page.locator(".question-card-actions button", { hasText: "Submit" }).click();

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

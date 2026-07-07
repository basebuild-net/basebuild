import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" }),
  ).toBeVisible();
}

test.describe("Interactive elements: ask_user question card", () => {
  test("agent asks → card renders → click option → answered state persists", async ({ page }) => {
    await openFixtureProject(page);

    // Open the native chat panel (first chat tab).
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });

    // Simulate an ask_user event from the backend by emitting the
    // native-chat://interactive-request event with a pending interaction.
    // In the mock environment, we inject the interaction via page.evaluate.
    await page.evaluate(async () => {
      // @ts-expect-error — Tauri invoke is injected by the mock
      const invoke = window.__TAURI_INTERNALS__?.invoke ?? window.invoke;
      if (!invoke) return;
      // Create a pending interaction directly via the command (mocked).
      // The mock backend resolves list_pending with the injected interaction.
      window.__basebuildMockInteraction = {
        id: "test-intr-1",
        sessionId: "mock-session",
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
      };
      // Emit the event so the ChatPanel picks it up.
      window.dispatchEvent(
        new CustomEvent("native-chat://interactive-request", {
          detail: { sessionId: "mock-session", interactionId: "test-intr-1" },
        }),
      );
    });

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

    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });

    // Inject a pending interaction.
    await page.evaluate(() => {
      window.__basebuildMockInteraction = {
        id: "test-intr-2",
        sessionId: "mock-session",
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
      };
      window.dispatchEvent(
        new CustomEvent("native-chat://interactive-request", {
          detail: { sessionId: "mock-session", interactionId: "test-intr-2" },
        }),
      );
    });

    // The QuestionCard should render.
    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });

    // Click Cancel.
    await page.locator(".question-card-actions button", { hasText: "Cancel" }).click();

    // The card should transition to cancelled state.
    await expect(page.locator(".question-card-muted")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".question-card-status", { hasText: "Cancelled" })).toBeVisible();
  });

  test("text question captures composer with answering indicator", async ({ page }) => {
    await openFixtureProject(page);

    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });

    // Inject a pending text question.
    await page.evaluate(() => {
      window.__basebuildMockInteraction = {
        id: "test-intr-3",
        sessionId: "mock-session",
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
      };
      window.dispatchEvent(
        new CustomEvent("native-chat://interactive-request", {
          detail: { sessionId: "mock-session", interactionId: "test-intr-3" },
        }),
      );
    });

    // The answering banner should appear above the composer.
    await expect(page.locator(".chat-answering-banner")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-answering-text", { hasText: "Answering" })).toBeVisible();

    // The QuestionCard should also render with a text input.
    await expect(page.locator(".question-card-input")).toBeVisible();
  });
});

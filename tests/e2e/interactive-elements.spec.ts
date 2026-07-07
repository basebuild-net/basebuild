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

  test("text question captures composer with answering indicator", async ({ page }) => {
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

    // The answering banner should appear above the composer.
    await expect(page.locator(".chat-answering-banner")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".chat-answering-text", { hasText: "Answering" })).toBeVisible();

    // The QuestionCard should also render with a text input.
    await expect(page.locator(".question-card-input")).toBeVisible();
  });
});

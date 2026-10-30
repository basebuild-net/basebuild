import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, ensureChatPanel, openFixtureProject } from "./helpers";

const PLAN_TOGGLE = ".chat-plan-toggle";
const PLAN_BAR = ".chat-notice-bar.is-plan";

/** Select a tools-capable route, as chat-steering does; the mock ships Umans connected. */
async function selectToolsProvider(page: Page) {
  await page.locator(".chat-column-model-chip").first().click();
  const overlay = page.locator(".provider-catalog-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await page.locator(".provider-card", { hasText: "Umans" }).first().click();
  const modelRow = page.locator(".provider-model-row", { hasText: "Umans GLM 5.2" }).first();
  await expect(modelRow).toBeVisible({ timeout: 5_000 });
  await modelRow.click();
}

async function sendMessage(page: Page, text: string) {
  const input = page.getByTitle(/Chat input/).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

/** A native session only exists after the first send; plan mode and the live cap event need one. */
async function startSession(page: Page) {
  await sendMessage(page, "hello");
  await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("hello", { timeout: 15_000 });
}

async function seedContextFiles(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __basebuildInvoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    await w.__basebuildInvoke?.("__e2e_seed_context_files", {
      files: [{ label: "AGENTS.md", scope: "project", bytes: 2048, truncated: false }],
    });
  });
}

test.describe("chat plan mode, checklist, compaction, and continue", () => {
  test("the plan toggle gates the chat and the approve bar leaves plan mode", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);
    await startSession(page);

    const toggle = page.locator(PLAN_TOGGLE);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveClass(/is-active/);

    // A plan is waiting once the turn has produced output, so the approve bar is offered.
    const bar = page.locator(PLAN_BAR);
    await expect(bar).toBeVisible();
    await attachScreenshot(page, "chat-plan-mode-approve-bar.png");

    await bar.getByRole("button", { name: "Approve plan" }).click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(bar).toHaveCount(0);
    await expect(
      page.locator(".chat-message-user").filter({ hasText: "The plan is approved. Carry it out now." }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("/plan toggles plan mode from the composer", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);
    await startSession(page);

    const toggle = page.locator(PLAN_TOGGLE);
    await sendMessage(page, "/plan");
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

    await sendMessage(page, "/plan off");
    await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
  });

  test("/compact replaces earlier turns with a timeline separator", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);

    for (const word of ["alpha", "bravo", "charlie"]) {
      await sendMessage(page, word);
      await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText(word, { timeout: 15_000 });
    }

    await sendMessage(page, "/compact");
    const separator = page.locator(".chat-compaction-row");
    await expect(separator).toBeVisible({ timeout: 10_000 });
    await expect(separator).toContainText("Conversation compacted");
    await attachScreenshot(page, "chat-compaction-row.png");
  });

  test("the agent checklist renders with per-item status", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);
    await startSession(page);

    await sendMessage(page, "todo-checklist-test");
    const checklist = page.locator(".chat-todo-checklist");
    await expect(checklist).toBeVisible({ timeout: 10_000 });
    await expect(checklist).toContainText("Checklist 1/3");
    await expect(checklist.locator(".chat-todo-item")).toHaveCount(3);
    await expect(checklist.locator(".chat-todo-item.is-in_progress")).toHaveCount(1);
    await expect(checklist.locator(".chat-todo-item.is-completed")).toHaveCount(1);
    await attachScreenshot(page, "chat-todo-checklist.png");
  });

  test("the context chip reports the context files sent with each request", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);
    await seedContextFiles(page);
    await startSession(page);

    const chip = page.locator(".chat-context-chip");
    await expect(chip).toContainText("1 context file");
    await expect(chip).toHaveAttribute("title", /AGENTS\.md/);
    await attachScreenshot(page, "chat-context-chip.png");
  });

  test("a turn that hits the step limit offers Continue", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectToolsProvider(page);
    await startSession(page);

    await sendMessage(page, "iteration-cap-test");
    const notice = page.locator(".chat-notice-bar", { hasText: "reaching its step limit" });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await attachScreenshot(page, "chat-iteration-cap-continue.png");

    await notice.getByRole("button", { name: "Continue" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("Native harness echo: Continue", {
      timeout: 15_000,
    });
  });
});

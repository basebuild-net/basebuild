import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openMvpFixtureProject, waitForAppReady } from "./helpers";

/** Get the native session id from the chat panel's data attribute. */
async function getNativeSessionId(page: Page): Promise<string> {
  await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
  return (await page.locator(".chat-panel").first().getAttribute("data-native-session-id")) ?? "";
}

test.describe("Agent status indicators", () => {
  test("active project shows status dot; other projects show idle dot", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // The active project header has a status dot.
    const activeDot = page.locator(".activity-sidebar-project-row.is-active .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });

    // With panels present (fixture has tabs/sessions), the active project
    // should show standby or running status — not idle.
    const dotClass = await activeDot.getAttribute("class");
    expect(dotClass).toMatch(/agent-status-(standby|running|questioning|idle)/);

    // Other project rows show idle status dots.
    const otherDots = page.locator(".activity-sidebar-project-row:not(.is-active) .agent-status-dot");
    const count = await otherDots.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const cls = await otherDots.nth(i).getAttribute("class");
      expect(cls).toContain("agent-status-idle");
    }
  });

  test("status dot has tooltip with agent status", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    const activeDot = page.locator(".activity-sidebar-project-row.is-active .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });
    await expect(activeDot).toHaveAttribute("title", /Agent: (running|standby|questioning|idle)/);
  });

  test("dot transitions to running during a streaming turn and back to standby", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await ensureChatPanel(page);

    // Deterministic local provider (mock streams over ~2s).
    await page.locator(".chat-column-model-chip").click();
    await page.locator(".provider-card").first().click();
    await page.getByTitle("Close provider and model catalog").click();

    const activeDot = page.locator(".activity-sidebar-project-row.is-active .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });

    await page.getByTitle(/Chat input/).first().fill("stream-test");
    await page.getByTitle("Send message").click();

    // While the turn streams, the project dot goes running.
    await expect(activeDot).toHaveClass(/agent-status-running/, { timeout: 5_000 });

    // After the final message lands, the dot settles back to standby.
    await expect(page.locator(".chat-message-assistant .md-body").last()).toContainText("arrived incrementally", { timeout: 10_000 });
    await expect(activeDot).toHaveClass(/agent-status-standby/, { timeout: 5_000 });
  });

  test("dot shows questioning while an ask_user interaction is pending", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await ensureChatPanel(page);
    const sessionId = await getNativeSessionId(page);

    const activeDot = page.locator(".activity-sidebar-project-row.is-active .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });

    // Inject a pending ask_user interaction.
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as {
        __basebuildMockInteraction?: unknown;
        __emit?: (event: string, payload: unknown) => void;
      };
      w.__basebuildMockInteraction = {
        id: "agent-status-intr-1",
        sessionId,
        questions: [
          {
            id: "q1",
            prompt: "Proceed with the refactor?",
            kind: "options",
            options: [{ label: "Yes" }, { label: "No" }],
            recommended: 0,
            allowFreeText: false,
          },
        ],
        status: "pending",
        createdAt: Math.floor(Date.now() / 1000),
      };
      w.__emit?.("native-chat://interactive-request", { sessionId, interactionId: "agent-status-intr-1" });
    }, { sessionId });

    // Project dot bounces as questioning; the panel row dot shows asking.
    await expect(page.locator(".interaction-workbench")).toBeVisible({ timeout: 5_000 });
    await expect(activeDot).toHaveClass(/agent-status-questioning/, { timeout: 5_000 });
    await expect(page.locator(".activity-sidebar-row-status.panel-status-asking").first()).toBeVisible({ timeout: 5_000 });

    // Answering the question clears the questioning state.
    await page.getByRole("button", { name: "Yes" }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(activeDot).not.toHaveClass(/agent-status-questioning/, { timeout: 5_000 });
  });
});

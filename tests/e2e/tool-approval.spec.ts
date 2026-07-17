import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

/** Get the native session id from the chat panel's data attribute. */
async function getNativeSessionId(page: Page): Promise<string> {
  await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
  return (await page.locator(".chat-panel").first().getAttribute("data-native-session-id")) ?? "";
}

/** Emit a native-chat approval request for the active session. */
async function emitApprovalRequest(page: Page, sessionId: string, toolCallId: string) {
  await page.evaluate(({ sessionId, toolCallId }) => {
    const w = window as unknown as { __emit?: (event: string, payload: unknown) => void };
    w.__emit?.("native-chat://approval-request", {
      sessionId,
      toolCallId,
      toolName: "run_command",
      command: "npm test",
      arguments: JSON.stringify({ command: "npm test" }),
    });
  }, { sessionId, toolCallId });
}

test.describe("Tool approval gate", () => {
  test("approval request renders card; Allow Once resolves to approved", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const sessionId = await getNativeSessionId(page);

    await emitApprovalRequest(page, sessionId, "approval-tool-1");

    // The approval card renders in pending state with the command visible.
    const card = page.locator(".tool-card-approval").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.locator(".tool-card-status")).toContainText("pending");
    await expect(card.locator(".tool-card-arg-value").first()).toContainText("npm test");

    // All three decision buttons are present.
    await expect(card.getByTitle("Allow this tool call once")).toBeVisible();
    await expect(card.getByTitle("Allow all calls to this tool for this session")).toBeVisible();
    await expect(card.getByTitle("Deny this tool call")).toBeVisible();

    // Allow Once → card leaves the approval state and shows approved.
    await card.getByTitle("Allow this tool call once").click();
    await expect(page.locator(".tool-card").filter({ hasText: "run command" }).first().locator(".tool-card-status")).toHaveText("approved", { timeout: 5_000 });
    await expect(page.locator(".tool-card-approval-actions")).toHaveCount(0);
  });

  test("Deny resolves the card to denied error state", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const sessionId = await getNativeSessionId(page);

    await emitApprovalRequest(page, sessionId, "approval-tool-2");

    const card = page.locator(".tool-card-approval").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.getByTitle("Deny this tool call").click();

    // Denied → error styling, approval actions gone.
    const resolved = page.locator(".tool-card").filter({ hasText: "run command" }).first();
    await expect(resolved.locator(".tool-card-status")).toHaveText("denied", { timeout: 5_000 });
    await expect(resolved).toHaveClass(/tool-card-error/);
    await expect(page.locator(".tool-card-approval-actions")).toHaveCount(0);
  });

  test("approval request for another session does not render here", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await getNativeSessionId(page);

    await emitApprovalRequest(page, "nchat-unrelated-session", "approval-tool-3");
    await page.waitForTimeout(500);
    await expect(page.locator(".tool-card-approval")).toHaveCount(0);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

async function sendMessage(page: Page, text: string) {
  const input = page.getByTitle(/Chat input/).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(text);
  await page.getByTitle("Send message").click();
}

test.describe("Subagent task card", () => {
  test("folds live child statuses into rows with a summary and an approval prompt", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await selectLocalProvider(page);

    await sendMessage(page, "subagent-task-test");

    const card = page.locator(".subagent-task-card").first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.locator(".subagent-row")).toHaveCount(3, { timeout: 5_000 });
    // Completed and failed children count as done; the blocked child is called out.
    await expect(card.locator(".tool-card-summary-inline")).toContainText("2/3 done, 1 awaiting approval", {
      timeout: 5_000,
    });

    const parser = card.locator(".subagent-row", { hasText: "audit-parser" });
    await expect(parser.locator(".subagent-row-head .tool-card-status")).toHaveText("completed");

    const tests = card.locator(".subagent-row", { hasText: "audit-tests" });
    await expect(tests.locator(".subagent-row-head .tool-card-status")).toHaveText("failed");

    const tokenizer = card.locator(".subagent-row", { hasText: "audit-tokenizer" });
    await expect(tokenizer.locator(".subagent-row-head .tool-card-status")).toHaveText("awaiting approval");
    await expect(tokenizer.locator(".subagent-approval-call")).toContainText("run_command: npm test");
    await expect(tokenizer.locator('button[title="Allow this tool call once"]')).toBeVisible();
    await expect(tokenizer.locator('button[title="Deny this tool call"]')).toBeVisible();

    // The final report stays behind the Report disclosure until opened.
    await parser.locator("summary", { hasText: "Report" }).click();
    await expect(parser.locator(".subagent-report pre")).toHaveText("Parser is sound.");
  });
});

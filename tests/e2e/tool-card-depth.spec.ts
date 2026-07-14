import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

async function sendToolCardMessage(page: Page) {
  // Close any open dialogs first.
  const dialog = page.locator("dialog");
  if (await dialog.count() > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  // Select the local provider to ensure deterministic tool event generation.
  await selectLocalProvider(page);
  await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
  const input = page.getByTitle(/Chat input/).first();
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill("tool-card-test");
  await page.getByTitle("Send message").click();
  await page.waitForSelector(".chat-message-assistant", { timeout: 10000 });
  await page.waitForSelector(".tool-card", { timeout: 5000 });
}

test.describe("Tool card depth: diff display, provenance, expansion", () => {
  test("tool cards render with structured diff and approval provenance", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await sendToolCardMessage(page);

    // write_file card should show a diff with added lines.
    const writeCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(writeCard).toBeVisible();
    // Cards start collapsed — click header to expand.
    await writeCard.locator(".tool-card-header").click();
    const writeDiff = writeCard.locator(".tool-card-diff");
    await expect(writeDiff).toBeVisible();
    await expect(writeDiff.locator(".diff-add")).toContainText("console.log('hello');");

    // edit_file card should show a diff with both removed and added lines.
    const editCard = page.locator(".tool-card").filter({ hasText: "edit file" }).first();
    await expect(editCard).toBeVisible();
    await editCard.locator(".tool-card-header").click();
    const editDiff = editCard.locator(".tool-card-diff");
    await expect(editDiff).toBeVisible();
    await expect(editDiff.locator(".diff-del")).toContainText("console.log('hello');");
    await expect(editDiff.locator(".diff-add")).toContainText("console.log('world');");

    // edit_file card should show provenance (allowed by rule).
    const editProvenance = editCard.locator(".tool-card-provenance");
    await expect(editProvenance).toBeVisible();
    await expect(editProvenance).toContainText("Allowed by rule");

    // run_command card should show command argument in header.
    const cmdCard = page.locator(".tool-card").filter({ hasText: "run command" }).first();
    await expect(cmdCard).toBeVisible();
    await expect(cmdCard.locator(".tool-card-arg-value")).toContainText("node src/hello.ts");

    // run_command card should not have a diff section.
    await expect(cmdCard.locator(".tool-card-diff")).toHaveCount(0);
  });

  test("tool card expansion toggles and persists", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await sendToolCardMessage(page);

    // The run_command card starts collapsed (default).
    const cmdCard = page.locator(".tool-card").filter({ hasText: "run command" }).first();
    const expandIndicator = cmdCard.locator(".tool-card-expand");
    await expect(expandIndicator).toContainText("▶");

    // Click to expand.
    await cmdCard.locator(".tool-card-header").click();
    await expect(expandIndicator).toContainText("▼");

    // The body should be visible with the summary.
    await expect(cmdCard.locator(".tool-card-summary")).toBeVisible();

    // Click again to collapse.
    await cmdCard.locator(".tool-card-header").click();
    await expect(expandIndicator).toContainText("▶");
  });

  test("tool card header shows file path argument for file tools", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await sendToolCardMessage(page);

    // write_file card header should show the file path.
    const writeCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(writeCard.locator(".tool-card-arg-value")).toContainText("src/hello.ts");

    // edit_file card header should also show the file path.
    const editCard = page.locator(".tool-card").filter({ hasText: "edit file" }).first();
    await expect(editCard.locator(".tool-card-arg-value")).toContainText("src/hello.ts");
  });
});

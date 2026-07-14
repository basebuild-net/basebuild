import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, selectLocalProvider } from "./helpers";

async function sendSchematicWizardMessage(page: Page) {
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
  await input.fill("schematic-wizard-test");
  await page.getByTitle("Send message").click();
  await page.waitForSelector(".chat-message-assistant", { timeout: 10000 });
  await page.waitForSelector(".tool-card", { timeout: 5000 });
}

test.describe("Schematic wizard: native agent writes schematic via tool call", () => {
  test("agent writes project schematic via write_file tool call", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await sendSchematicWizardMessage(page);

    // The assistant message should mention the schematic.
    const assistantMsg = page.locator(".chat-message-assistant").first();
    await expect(assistantMsg).toContainText("schematic");

    // A write_file tool card should appear targeting .basebuild/project-schematic.md.
    const writeCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(writeCard).toBeVisible();
    await expect(writeCard).toContainText("project-schematic.md");

    // Cards start expanded — diff is visible immediately.
    const writeDiff = writeCard.locator(".tool-card-diff");
    await expect(writeDiff.locator(".diff-add").first()).toContainText("Project Schematic");

    // The card should show provenance (allowed by rule for .basebuild/**).
    const provenance = writeCard.locator(".tool-card-provenance");
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText("Allowed by rule");
  });

  test("schematic write_file tool card shows structured arguments", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    await sendSchematicWizardMessage(page);

    const writeCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(writeCard).toBeVisible();

    // Cards start expanded — arguments are visible immediately.

    // The argument display should show the file path.
    await expect(writeCard.locator(".tool-card-arg-value")).toContainText("project-schematic.md");
  });

  test("schematic wizard denial path: tool card shows denied status and provenance", async ({ page }) => {
    await openFixtureProject(page);
    await ensureChatPanel(page);
    // Select the local provider to ensure deterministic tool event generation.
    await selectLocalProvider(page);
    await expect(page.locator(".chat-panel").first()).toHaveAttribute("data-native-session-id", /.+/, { timeout: 10_000 });
    const input = page.getByTitle(/Chat input/).first();
    await input.fill("schematic-wizard-deny-test");
    await page.getByTitle("Send message").click();
    await page.waitForSelector(".chat-message-assistant", { timeout: 10000 });
    await page.waitForSelector(".tool-card", { timeout: 5000 });

    // The denied card renders in the error state with a denied status badge.
    const deniedCard = page.locator(".tool-card").filter({ hasText: "write file" }).first();
    await expect(deniedCard).toBeVisible();
    await expect(deniedCard).toHaveClass(/tool-card-error/);
    await expect(deniedCard.locator(".tool-card-status")).toContainText(/denied/i);

    // Cards start expanded — provenance is visible immediately.
    await expect(deniedCard.locator(".tool-card-provenance")).toContainText("Denied by user");

    // A denied write must not render a diff — nothing was written.
    await expect(deniedCard.locator(".tool-card-diff")).toHaveCount(0);
  });
});

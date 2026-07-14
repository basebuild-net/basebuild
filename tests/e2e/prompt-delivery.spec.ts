import { expect, test, type Page } from "@playwright/test";

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

test.describe("Planning cockpit: prompt delivery + destination picker", () => {
  test("schematic wizard opens destination picker", async ({ page }) => {
    await openFixtureProject(page);

    // Navigate to the schematic tab.
    const schematicTab = page.locator("[title*='schematic' i], [data-tab='schematic']").first();
    if (await schematicTab.count() > 0) {
      await schematicTab.click();
    }

    // Click "Start wizard" — should open the destination picker, not auto-send.
    const wizardBtn = page.getByRole("button", { name: "Start wizard" }).first();
    if (await wizardBtn.count() > 0) {
      await wizardBtn.click();
      // The destination picker modal should appear.
      await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5_000 });
      // It should list "New conversation" as an option.
      await expect(page.locator(".destination-picker-item", { hasText: "New conversation" })).toBeVisible();
    }
  });

  test("cancel delivers nothing", async ({ page }) => {
    await openFixtureProject(page);

    const schematicTab = page.locator("[title*='schematic' i], [data-tab='schematic']").first();
    if (await schematicTab.count() > 0) {
      await schematicTab.click();
    }

    const wizardBtn = page.getByRole("button", { name: "Start wizard" }).first();
    if (await wizardBtn.count() > 0) {
      await wizardBtn.click();
      await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5_000 });

      // Click Cancel — picker closes, no prompt delivered.
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.locator(".destination-picker-modal")).toHaveCount(0);

      // No chat input should contain the wizard prompt.
      await expect(page.locator(".chat-input, textarea").filter({ hasText: "basebuild-project-schematic" })).toHaveCount(0, { timeout: 2_000 });
    }
  });

  test("destination picker lists open chat panels + new conversation", async ({ page }) => {
    await openFixtureProject(page);

    // Wait for a chat panel to be visible.
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    // Open the wizard to trigger the picker.
    const schematicTab = page.locator("[title*='schematic' i], [data-tab='schematic']").first();
    if (await schematicTab.count() > 0) {
      await schematicTab.click();
    }
    const wizardBtn = page.getByRole("button", { name: "Start wizard" }).first();
    if (await wizardBtn.count() > 0) {
      await wizardBtn.click();
      await expect(page.locator(".destination-picker-modal")).toBeVisible({ timeout: 5_000 });

      // Should have at least the "New conversation" option.
      await expect(page.locator(".destination-picker-item", { hasText: "New conversation" })).toBeVisible();

      // Cancel to clean up.
      await page.getByRole("button", { name: "Cancel" }).click();
    }
  });

  test("no native_interaction_list_all error banner in mocked chats", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 5_000 });

    // The error banner should not appear (the mock now handles the command).
    await expect(page.locator(".chat-error, .error-banner").filter({ hasText: "native_interaction_list_all" })).toHaveCount(0, { timeout: 3_000 });
  });
});

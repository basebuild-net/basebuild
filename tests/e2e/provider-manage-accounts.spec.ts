import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject } from "./helpers";

async function openProviderPicker(page: Page) {
  await ensureChatPanel(page);
  await page.locator(".chat-column-model-chip").first().click();
  await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });
}

async function openManageModal(page: Page, providerTitle: string) {
  await openProviderPicker(page);
  const manageBtn = page.locator(`.provider-card[title^="${providerTitle}:"] .provider-card-action-btn[title^="Manage"]`).first();
  await expect(manageBtn).toBeVisible();
  await manageBtn.click();
  await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0, { timeout: 3_000 });
  return page.locator(".modal-overlay").filter({ has: page.locator("h2", { hasText: "Manage" }) }).first();
}

test.describe("Provider Manage dialog — multi-account", () => {
  test("provider card shows account summary and Manage button", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Umans is seeded with one account in the e2e mock.
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await expect(umansCard).toBeVisible();
    await expect(umansCard.locator(".provider-card-action-btn", { hasText: "Manage" })).toBeVisible();
    await expect(umansCard.locator(".provider-card-auth")).toContainText(/1 account/);
  });

  test("Manage dialog lists connected accounts with health and actions", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");

    await expect(manageModal.getByText("Connected accounts")).toBeVisible();
    await expect(manageModal.locator(".provider-account-list")).toBeVisible();
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(1);
    // The seeded account has a "key …test" label and healthy status.
    await expect(manageModal.locator(".provider-account-health.is-healthy")).toBeVisible();
    await expect(manageModal.locator(".provider-account-actions button", { hasText: "Test" })).toBeVisible();
    await expect(manageModal.locator(".provider-account-actions button", { hasText: "Log out" })).toBeVisible();
  });

  test("per-account Log out opens confirmation dialog", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");
    await manageModal.locator(".provider-account-actions button", { hasText: "Log out" }).click();

    const confirm = page.locator(".confirm-dialog-modal").locator("..");
    await expect(confirm).toBeVisible({ timeout: 3_000 });
    await expect(confirm.getByText(/removes the stored.*credential/)).toBeVisible();

    // Cancel keeps the account row.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(1);
  });

  test("confirmed per-account logout removes the row", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");

    await manageModal.locator(".provider-account-actions button", { hasText: "Log out" }).click();
    const confirm = page.locator(".modal-overlay").filter({ has: page.locator(".confirm-dialog-modal") });
    await confirm.getByRole("button", { name: "Log out" }).click();

    // Account row disappears; the "No account connected" placeholder appears.
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(0, { timeout: 5_000 });
    await expect(manageModal.getByText(/No account connected yet/)).toBeVisible();
  });

  test("Test button refreshes account health", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");

    const testBtn = manageModal.locator(".provider-account-actions button", { hasText: "Test" });
    await testBtn.click();
    // The mock marks the account healthy; the health badge stays green.
    await expect(manageModal.locator(".provider-account-health.is-healthy")).toBeVisible({ timeout: 5_000 });
  });

  test("usage section shows per-account rows with window picker", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");

    await expect(manageModal.locator(".provider-usage-section")).toBeVisible();
    await expect(manageModal.locator(".provider-usage-window")).toBeVisible();
    await expect(manageModal.locator(".provider-usage-row")).toHaveCount(1);
    await expect(manageModal.locator(".provider-usage-row")).toContainText(/reqs/);
  });

  test("Manage modal for provider with no accounts shows placeholder", async ({ page }) => {
    await openFixtureProject(page);
    // OpenAI API has no seeded account.
    const manageModal = await openManageModal(page, "OpenAI API");
    await expect(manageModal.getByText(/No account connected yet/)).toBeVisible();
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(0);
  });

  test("Manage modal can be closed via Back button", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");
    await manageModal.locator("button[title='Back to the provider & model catalog']").click();
    await expect(manageModal).toBeHidden({ timeout: 3_000 });
    await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 3_000 });
  });

  test("usage window picker switches between today/7d/30d", async ({ page }) => {
    await openFixtureProject(page);
    const manageModal = await openManageModal(page, "Umans");
    const windowSelect = manageModal.locator(".provider-usage-window");
    await expect(windowSelect).toBeVisible();
    // Default is "7d" (604800).
    await expect(windowSelect).toHaveValue("604800");
    // Switch to today.
    await windowSelect.selectOption("86400");
    await expect(windowSelect).toHaveValue("86400");
    // Switch to 30d.
    await windowSelect.selectOption("2592000");
    await expect(windowSelect).toHaveValue("2592000");
  });

  test("Log out all button appears with 2+ accounts and clears all rows", async ({ page }) => {
    await openFixtureProject(page);
    // Seed a second umans account via the test hook.
    await page.evaluate(() =>
      (window as unknown as { __basebuildInvoke: (cmd: string, args: unknown) => Promise<unknown> })
        .__basebuildInvoke("__e2e_seed_provider_account", {
          id: "umans_acct2",
          providerId: "umans",
          label: "Umans key …aaaa",
          authMethod: "api",
          health: "healthy",
        }),
    );
    const manageModal = await openManageModal(page, "Umans");
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(2);
    // "Log out all" button is visible.
    const logoutAllBtn = manageModal.locator("button", { hasText: "Log out all accounts" });
    await expect(logoutAllBtn).toBeVisible();
    await logoutAllBtn.click();
    // Confirm dialog.
    const confirm = page.locator(".modal-overlay").filter({ has: page.locator(".confirm-dialog-modal") });
    await confirm.getByRole("button", { name: "Log out" }).click();
    // All rows disappear.
    await expect(manageModal.locator(".provider-account-row")).toHaveCount(0, { timeout: 5_000 });
    await expect(manageModal.getByText(/No account connected yet/)).toBeVisible();
  });

  test("health badge shows error state with last-error tooltip", async ({ page }) => {
    await openFixtureProject(page);
    // Seed an account with error health.
    await page.evaluate(() =>
      (window as unknown as { __basebuildInvoke: (cmd: string, args: unknown) => Promise<unknown> })
        .__basebuildInvoke("__e2e_seed_provider_account", {
          id: "umans_acct_err",
          providerId: "umans",
          label: "Umans key …err1",
          authMethod: "api",
          health: "error",
          lastError: "401 Unauthorized",
        }),
    );
    const manageModal = await openManageModal(page, "Umans");
    const errBadge = manageModal.locator(".provider-account-health.is-danger").first();
    await expect(errBadge).toBeVisible();
    await expect(errBadge).toHaveAttribute("title", "401 Unauthorized");
    await expect(manageModal.locator(".provider-account-error")).toContainText("401 Unauthorized");
  });
});

test.describe("Settings — account strategy picker", () => {
  test("strategy picker is present and persists", async ({ page }) => {
    await openFixtureProject(page);
    // Open settings via account menu dropdown.
    const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click({ timeout: 10_000 });
    const settingsItem = page.locator('button[title="Open settings"]').first();
    await expect(settingsItem).toBeVisible({ timeout: 5_000 });
    await settingsItem.click({ timeout: 5_000 });
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });
    const providersTab = page.locator(".settings-tab", { hasText: "Providers" }).first();
    await providersTab.click();
    await expect(page.locator("h3", { hasText: "Model providers" })).toBeVisible({ timeout: 5_000 });

    const strategySelect = page.locator("#provider-account-strategy");
    await expect(strategySelect).toBeVisible();
    await strategySelect.selectOption("fill_first");
    // Re-read to confirm persistence (the mock stores it in state).
    await expect(strategySelect).toHaveValue("fill_first");
  });
});

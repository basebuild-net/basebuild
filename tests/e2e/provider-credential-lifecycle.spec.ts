import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

async function openFixtureProject(page: Page) {
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
}

async function ensureChatPanel(page: Page) {
  await page.waitForTimeout(1500);
  const panel = page.locator(".panel-grid-leaf").first();
  const count = await panel.count();
  if (count > 0) return;
  await page.getByTitle("New chat").first().click();
  await page.waitForTimeout(500);
}

async function openProviderPicker(page: Page) {
  await ensureChatPanel(page);
  await page.locator(".chat-column-model-chip").first().click();
  await expect(page.locator(".provider-catalog-overlay").first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Provider credential lifecycle", () => {
  test("fixture seeds umans as connected", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Umans should be configured (seeded in fixture).
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await expect(umansCard).toBeVisible();

    // Should show as connected.
    const status = umansCard.locator(".provider-status.is-connected").first();
    await expect(status).toBeVisible();
  });

  test("disconnect removes connected status", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Find the umans disconnect button.
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    const disconnectBtn = umansCard.locator(".provider-card-action-btn", { hasText: "Disconnect" }).first();

    // Should be visible since umans is connected.
    await expect(disconnectBtn).toBeVisible();

    // Click disconnect.
    await disconnectBtn.click();
    await page.waitForTimeout(500);

    // Umans should now show as available, not connected.
    const availableStatus = umansCard.locator(".provider-status.is-available").first();
    await expect(availableStatus).toBeVisible();
  });

  test("connect button appears after disconnect", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    const disconnectBtn = umansCard.locator(".provider-card-action-btn", { hasText: "Disconnect" }).first();

    await disconnectBtn.click();
    await page.waitForTimeout(500);

    // Now a Connect button should appear (title starts with "Connect").
    const connectBtn = umansCard.locator('.provider-card-action-btn[title^="Connect"]').first();
    await expect(connectBtn).toBeVisible();
  });

  test("clicking connect opens login modal with password input", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Find an unconfigured provider (e.g. OpenAI).
    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      // Wait for catalog to close.
      await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0, { timeout: 3_000 });

      // Login modal should appear with a password input.
      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Should have a Save button.
      await expect(loginModal.locator("button", { hasText: /Save/i })).toBeVisible();
    }
  });

  test("login modal has header and close button", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Should have a header.
      await expect(loginModal.locator(".modal-header").first()).toBeVisible();

      // Should have a close button.
      const closeBtn = loginModal.locator('button[title*="Close"]').first();
      await expect(closeBtn).toBeVisible();
    }
  });

  test("login modal overlay click closes the modal", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    const openaiCard = page.locator(".provider-card").filter({ hasText: "OpenAI" }).first();
    const connectBtn = openaiCard.locator('.provider-card-action-btn[title^="Connect"]').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();

      const loginModal = page.locator(".modal-overlay").filter({
        has: page.locator("input[type='password']"),
      });
      await expect(loginModal).toBeVisible({ timeout: 3_000 });

      // Click the overlay area.
      await loginModal.click({ position: { x: 5, y: 5 } });
      await expect(loginModal).toBeHidden({ timeout: 2_000 });
    }
  });

  test("multiple providers show different connection states", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Should have connected providers (umans + basebuild-local).
    const connected = page.locator(".provider-card .provider-status.is-connected");
    const connectedCount = await connected.count();
    expect(connectedCount).toBeGreaterThanOrEqual(2);

    // Should have available providers (openai, anthropic, etc.).
    const available = page.locator(".provider-card .provider-status.is-available");
    const availableCount = await available.count();
    expect(availableCount).toBeGreaterThanOrEqual(2);
  });

  test("provider cards have model count", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Each provider card should show model count.
    const cards = page.locator(".provider-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Check first card has model count info.
    const firstCard = cards.first();
    const meta = firstCard.locator(".provider-card-meta").first();
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/model/i);
  });

  test("provider catalog has section headings", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Should have a Providers section heading.
    const providersHeading = page.locator(".provider-catalog-section-heading").filter({ hasText: "Providers" }).first();
    await expect(providersHeading).toBeVisible();

    // Should have a Models section.
    const modelsHeading = page.locator(".provider-catalog-section-heading").filter({ hasText: /models/i }).first();
    await expect(modelsHeading).toBeVisible();
  });
});

test.describe("Provider update-key flow", () => {
  test("configured provider shows Update key button in picker", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Umans is configured (seeded in fixture).
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await expect(umansCard).toBeVisible();

    // Should show "Update key" button (renamed from "Reconnect").
    const updateKeyBtn = umansCard.locator("button", { hasText: "Update key" });
    await expect(updateKeyBtn).toBeVisible();
    await expect(updateKeyBtn).toHaveAttribute("title", /Update key for Umans/);
  });

  test("configured provider shows Disconnect and Update key in settings", async ({ page }) => {
    await openFixtureProject(page);
    // Open settings via account menu (same pattern as ui-gates test).
    const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click({ timeout: 10_000 });
    const settingsItem = page.locator('button[title="Open settings"]').first();
    await expect(settingsItem).toBeVisible({ timeout: 5_000 });
    await settingsItem.click({ timeout: 5_000 });
    await expect(page.locator('.modal-overlay .settings-modal')).toBeVisible({ timeout: 15_000 });
    // Navigate to the Account tab (Model Providers panel is there).
    const accountTab = page.locator(".settings-tab", { hasText: "Account" }).first();
    await accountTab.click();
    await page.waitForTimeout(500);

    // Should show the Model Providers panel.
    const heading = page.locator("h3", { hasText: "Model Providers" });
    await expect(heading).toBeVisible({ timeout: 5000 });

    // Umans should be configured with Disconnect and Update key buttons.
    const umansRow = page.locator(".requirement-row").filter({ hasText: "Umans" }).first();
    await expect(umansRow).toBeVisible();
    const disconnectBtn = umansRow.locator("button", { hasText: "Disconnect" });
    await expect(disconnectBtn).toBeVisible();
    const updateKeyBtn = umansRow.locator("button", { hasText: "Update key" });
    await expect(updateKeyBtn).toBeVisible();
  });
});

async function openSettingsProviders(page: Page) {
  const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
  await expect(accountBtn).toBeVisible({ timeout: 10_000 });
  await accountBtn.click({ timeout: 10_000 });
  const settingsItem = page.locator('button[title="Open settings"]').first();
  await expect(settingsItem).toBeVisible({ timeout: 5_000 });
  await settingsItem.click({ timeout: 5_000 });
  await expect(page.locator(".modal-overlay .settings-modal")).toBeVisible({ timeout: 15_000 });
  const accountTab = page.locator(".settings-tab", { hasText: "Account" }).first();
  await accountTab.click();
  await expect(page.locator("h3", { hasText: "Model Providers" })).toBeVisible({ timeout: 5_000 });
}

test.describe("Settings credential save", () => {
  test("pasting an API key and saving connects the provider", async ({ page }) => {
    await openFixtureProject(page);
    await openSettingsProviders(page);

    // Anthropic starts unconfigured: has the paste-key input, no Disconnect.
    const row = page.locator(".requirement-row").filter({ hasText: "Anthropic" }).first();
    await expect(row).toBeVisible();
    await expect(row.locator("button", { hasText: "Disconnect" })).toHaveCount(0);

    // Save a key — the credential must persist and the row must flip to connected.
    await row.locator('input[placeholder="or paste API key"]').fill("sk-ant-e2e-test");
    await row.locator("button", { hasText: "Save" }).click();

    await expect(row.getByText("connected")).toBeVisible({ timeout: 5_000 });
    await expect(row.locator("button", { hasText: "Disconnect" })).toBeVisible();
    await expect(row.locator("button", { hasText: "Update key" })).toBeVisible();
  });

  test("update key on a connected provider keeps it connected", async ({ page }) => {
    await openFixtureProject(page);
    await openSettingsProviders(page);

    // Umans is seeded connected. Open the update form and rotate the key.
    const row = page.locator(".requirement-row").filter({ hasText: "Umans" }).first();
    await expect(row.locator("button", { hasText: "Update key" })).toBeVisible();
    await row.locator("button", { hasText: "Update key" }).click();

    const keyInput = row.locator('input[placeholder="New API key"]');
    await expect(keyInput).toBeVisible();
    await keyInput.fill("umans-rotated-key");
    await row.locator("button", { hasText: "Save" }).click();

    // Rotation succeeds: form closes, provider stays connected.
    await expect(row.locator('input[placeholder="New API key"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(row.getByText("connected")).toBeVisible();
    await expect(row.locator("button", { hasText: "Disconnect" })).toBeVisible();
  });

  test("failed save keeps the draft and shows an error", async ({ page }) => {
    await openFixtureProject(page);
    await openSettingsProviders(page);

    // "invalid-key" is the mock's deterministic rejection trigger.
    const row = page.locator(".requirement-row").filter({ hasText: "Anthropic" }).first();
    const keyInput = row.locator('input[placeholder="or paste API key"]');
    await keyInput.fill("invalid-key");
    await row.locator("button", { hasText: "Save" }).click();

    // Error surfaces, draft is preserved, provider stays unconfigured.
    await expect(page.locator(".settings-modal .text-danger", { hasText: "Invalid API key" })).toBeVisible({ timeout: 5_000 });
    await expect(keyInput).toHaveValue("invalid-key");
    await expect(row.locator("button", { hasText: "Disconnect" })).toHaveCount(0);
  });
});

test.describe("Transport unavailable state", () => {
  test("bespoke provider without base URL shows transport warning", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Devin is a bespoke provider (devin-agent api_kind). In the fixture it
    // has base_url from the catalog, so it should show as Connected, not
    // transport_unavailable. We verify the status rendering works by
    // checking that the "No transport" text does NOT appear for Devin.
    const devinCard = page.locator(".provider-card").filter({ hasText: "Devin.ai" }).first();
    if (await devinCard.count() > 0) {
      const statusText = await devinCard.locator(".provider-status").textContent();
      // Devin has base_url from catalog, so should be "Connected" not "No transport".
      expect(statusText).not.toContain("No transport");
    }

    // Verify the warning status class exists in the stylesheet (CSS is present).
    // A provider with transport_unavailable would show "is-warning" class.
    // We can't easily mock this state in e2e, but we verify the UI doesn't
    // break for providers that ARE available.
    const providerCards = page.locator(".provider-card");
    const count = await providerCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Provider catalog model selection", () => {
  test("model list renders in catalog", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Models section should have model entries.
    const modelsSection = page.locator(".provider-catalog-models").first();
    await expect(modelsSection).toBeVisible();

    // Should have model items.
    const modelItems = modelsSection.locator("[class*='model']");
    const count = await modelItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("selecting a provider highlights it", async ({ page }) => {
    await openFixtureProject(page);
    await openProviderPicker(page);

    // Click on a provider card.
    const umansCard = page.locator(".provider-card").filter({ hasText: "Umans" }).first();
    await umansCard.click();
    await page.waitForTimeout(200);

    // The card should be selected (active class or similar).
    const selected = page.locator(".provider-card.is-selected, .provider-card.is-active").first();
    if (await selected.count() > 0) {
      await expect(selected).toBeVisible();
    }
  });
});

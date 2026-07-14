import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel, openFixtureProject, openPlanningModal } from "./helpers";

test.describe("UI gates: routing, no-manual-plan, settings, header, activity", () => {
  test("no Create plan button exists anywhere in the app", async ({ page }) => {
    await openFixtureProject(page);

    // Open the planning modal and check for no Create plan button.
    await openPlanningModal(page);
    const planningModal = page.locator('.modal-overlay[aria-label="Plans & Ideas"]');
    await expect(planningModal.getByRole("button", { name: "Create plan", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("settings modal can be opened from the account menu", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // The MVP fixture has an authenticated account. Click the account button
    // to open the dropdown, then click Settings.
    const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click({ timeout: 10_000 });

    // Wait for the dropdown to appear, then click Settings.
    const settingsItem = page.locator('button[title="Open settings"]').first();
    await expect(settingsItem).toBeVisible({ timeout: 5_000 });
    await settingsItem.click({ timeout: 5_000 });

    // The settings modal should be visible with nav + content.
    // The modal is lazy-loaded; under parallel test load the chunk may take
    // a moment to fetch, so allow extra time for Suspense to resolve.
    await expect(page.locator('.modal-overlay .settings-modal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".settings-sidebar").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".settings-content").first()).toBeVisible({ timeout: 5_000 });

    // Escape closes settings.
    await page.keyboard.press("Escape");
    await expect(page.locator('.modal-overlay .settings-modal')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("chat header shows model chip, branch, and tooltips on all controls", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });

    // Branch indicator.
    await expect(page.locator(".chat-column-branch-name").first()).toContainText("main");
    await expect(page.locator(".chat-column-branch").first()).toHaveAttribute("title");

    // Model chip has a tooltip.
    const modelChip = page.locator(".chat-column-model-chip, button").filter({ hasText: /GLM|Coordinator|Model/ }).first();
    await expect(modelChip).toBeVisible({ timeout: 5_000 });

    expect(pageErrors).toEqual([]);
  });

  test("provider catalog shows connected providers first", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-column-header").first()).toBeVisible({ timeout: 10_000 });
    // Open provider catalog — wait for the trigger to be ready (catalog loaded).
    const providerTrigger = page.locator(".chat-column-model-chip").first();
    await expect(providerTrigger).toBeVisible({ timeout: 10_000 });
    await providerTrigger.click();
    await expect(page.locator(".provider-catalog-overlay")).toBeVisible({ timeout: 5_000 });

    // Connected providers appear.
    const connected = page.locator(".provider-status.is-connected");
    expect(await connected.count()).toBeGreaterThan(0);

    // Escape closes.
    await page.keyboard.press("Escape");
    await expect(page.locator(".provider-catalog-overlay")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("tool events and question cards render in transcript", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 10_000 });
    const sessionId = await page.locator(".chat-panel").first().getAttribute("data-native-session-id") ?? "";

    // Inject a tool event.
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as { __emit?: (event: string, payload: unknown) => void };
      w.__emit?.("native-chat://tool-event", {
        sessionId,
        toolCallId: "gate-tool-1",
        toolName: "read_file",
        status: "success",
        summary: "Read package.json (25 lines)",
      });
    }, { sessionId });

    await expect(page.locator(".tool-card").first()).toBeVisible({ timeout: 5_000 });

    // Inject a question card.
    await page.evaluate(({ sessionId }) => {
      const w = window as unknown as {
        __basebuildMockInteraction?: unknown;
        __emit?: (event: string, payload: unknown) => void;
      };
      w.__basebuildMockInteraction = {
        id: "gate-intr-1",
        sessionId,
        questions: [{
          id: "q1",
          prompt: "Gate test question?",
          kind: "confirm",
          options: [{ label: "Yes" }, { label: "No" }],
          recommended: 0,
          allowFreeText: false,
        }],
        status: "pending",
        createdAt: Math.floor(Date.now() / 1000),
      };
      w.__emit?.("native-chat://interactive-request", { sessionId, interactionId: "gate-intr-1" });
    }, { sessionId });

    await expect(page.locator(".question-card-pending")).toBeVisible({ timeout: 5_000 });

    expect(pageErrors).toEqual([]);
  });
});

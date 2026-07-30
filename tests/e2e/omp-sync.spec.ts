import { expect, test, type Page } from "@playwright/test";
import { attachScreenshot, openFixtureProject } from "./helpers";

test.describe("OMP <-> Basebuild IDE sync", () => {
  test.skip("shows detection-gated Oh My Pi tab and live telemetry HUD", async ({ page }) => {
    // TODO: re-enable when the ActivitySidebar has a "New OMP" button to create
    // an OMP panel in the panel grid. The OMP telemetry HUD renders inside
    // OmpTerminalTab, which requires an omp-type panel.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await page.waitForTimeout(1000);

    // Create a chat panel (if none exists).
    const panel = page.locator(".panel-grid-leaf").first();
    if ((await panel.count()) === 0) {
      await page.getByTitle("New chat").first().click();
      await page.waitForTimeout(500);
    }

    // The OMP telemetry HUD is rendered inside the chat panel when omp is detected.
    // The chat panel shows the OMP status button when omp is installed.
    await expect(page.locator(".omp-telemetry-hud")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".omp-hud-title")).toContainText("Telemetry");
    // Live context from the mocked snapshot.
    await expect(page.locator(".omp-hud-body")).toContainText("anthropic");
    await expect(page.locator(".omp-hud-body")).toContainText("claude-sonnet-4");
    await expect(page.locator(".omp-hud-body")).toContainText("Claude Max");
    // A window utilization bar renders.
    await expect(page.locator(".omp-window-row").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("signed-in Account page shows usage sync panel + projected usage", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Open Settings and navigate to the Account tab.
    // The MVP fixture has an authenticated account; click the account button
    // to open the dropdown, then click Settings.
    const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click({ timeout: 10_000 });
    const settingsItem = page.locator('button[title="Open settings"]').first();
    await expect(settingsItem).toBeVisible({ timeout: 5_000 });
    await settingsItem.click({ timeout: 5_000 });
    // Wait for the lazy-loaded settings modal.
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Analytics", exact: true }).click();
    // Usage covers provider windows, the locally solved drain rate, and
    // per-model daily averages.
    await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan drain rate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Session and weekly usage" })).toBeVisible();
    await expect(page.getByText("Session (5h)", { exact: true })).toBeVisible();
    await expect(page.getByText("Weekly (7d)", { exact: true })).toBeVisible();
    const usageBars = page.locator("progress.usage-window-bar");
    await expect(usageBars).toHaveCount(2);
    await expect(usageBars.first()).toHaveAttribute("value", "42");
    await expect(page.getByRole("heading", { name: "Per-model usage" })).toBeVisible();
    // The drain card answers "how many more requests do I get", which is the
    // number no provider publishes. One row per solved window.
    const drainRows = page.locator(".usage-drain-confidence");
    await expect(drainRows).toHaveCount(3);
    await expect(page.getByText("anthropic · 5h", { exact: true })).toBeVisible();
    await expect(page.getByText("121", { exact: true })).toBeVisible();
    await expect(page.getByText("0.19%", { exact: true })).toBeVisible();
    await expect(page.getByText("2.3k", { exact: true })).toBeVisible();
    await expect(page.getByText("not draining", { exact: true })).toBeVisible();
    await expect(page.getByText(/Privacy-safe request spans and quota snapshots/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "What never uploads" })).toBeVisible();
    await expect(page.getByText(/Prompts, responses, reasoning, tool arguments/)).toBeVisible();
    await expect(page.getByText("Account attribution")).toBeVisible();

    const sourceRows = page.locator(".usage-source-row");
    await expect(sourceRows).toHaveCount(5);
    // Installed sources sort first, so a not-installed one never sits above a
    // tool that is actively reporting usage.
    await expect(sourceRows.last()).toContainText("Not installed");
    await expect(sourceRows.filter({ hasText: "Claude Code" })).toContainText("Retrying");
    await expect(sourceRows.filter({ hasText: "Claude Code" })).toContainText(
      "Upload was not acknowledged. Retry is pending.",
    );
    await expect(sourceRows.filter({ hasText: "Oh My Pi" })).toContainText("Not installed");
    await expect(sourceRows.filter({ hasText: "Oh My Pi" })).toContainText("Oh My Pi is not installed");
    // A synced source reports how long ago, not a raw timestamp.
    await expect(sourceRows.filter({ hasText: "Codex CLI" })).toContainText("Synced");
    await expect(sourceRows.filter({ hasText: "Codex CLI" })).toContainText("minutes ago");
    await expect(page.getByTitle("Retry pending usage sources now")).toBeVisible();
    await attachScreenshot(page, "usage-sync-source-status.png");

    // Toggling off maps the explicit backend reason; toggling on clears it.
    const toggle = page.locator('input[type="checkbox"][title="Sync usage automatically: periodically and shortly after usage changes"]');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.getByText(/Auto-sync is off. Turn it on/)).toBeVisible();
    await toggle.check();
    await expect(page.getByText(/Auto-sync is off. Turn it on/)).toBeHidden();

    // Retry invokes the dedicated native command and refreshes source state.
    await page.getByTitle("Retry pending usage sources now").click();
    await expect(sourceRows.filter({ hasText: "Claude Code" })).toContainText("Synced");
    await expect(page.getByTitle("Retry pending usage sources now")).toBeHidden();

    // Projected usage keeps the usage bars and per-model table visible.
    await expect(page.locator("progress.usage-window-bar").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Per-model usage" })).toBeVisible();
    await expect(page.locator(".usage-table:not(.usage-drain-table)"))
      .toContainText("claude-sonnet-4");

    // "Sync now" still triggers without error.
    await page.getByTitle("Sync usage and quota observations now").click();

    expect(pageErrors).toEqual([]);
  });

  test("signed-out settings identify private-installation attribution", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });
    await page.goto("/");
    await page.getByTitle("Open Settings").click();
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Analytics", exact: true }).click();

    await expect(page.getByText("Private installation attribution")).toBeVisible();
    await expect(page.getByText(/It is not a hardware ID and is not merged into an account later/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Session and weekly usage" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Provider Plans" })).toBeHidden();
    await page.getByTitle("Sync usage and quota observations now").click();
    await expect(page.getByText("Account sign-in required for projected usage")).toBeHidden();
  });
});

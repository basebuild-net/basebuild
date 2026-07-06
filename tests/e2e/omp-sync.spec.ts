import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" })).toBeVisible();
}

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

    // Open Settings, navigate to the Account tab, and sign in.
    await page.getByTitle("Sign in to basebuild.net").click();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByTitle("Open browser to sign in to basebuild.net").click();
    // The mocked device flow resolves to success; account state refreshes.
    await expect(page.locator(".account-name")).toContainText("TestUser", { timeout: 10_000 });
    // The Usage Sync panel renders with the auto-sync toggle, which defaults
    // to ON after sign-in.
    await expect(page.getByRole("heading", { name: "Usage Sync" })).toBeVisible();
    const toggle = page.locator('input[type="checkbox"][title="Enable hourly auto-sync to basebuild.net"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();

    // Toggling off persists; toggling back on flips the checkbox.
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();

    // Projected usage renders (live utilization + per-model table).
    await expect(page.getByRole("heading", { name: "Live Utilization" })).toBeVisible();
    await expect(page.locator(".usage-window-row").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Per-Model Usage/ })).toBeVisible();
    await expect(page.locator(".usage-table")).toContainText("claude-sonnet-4");

    // "Sync now" triggers without error.
    await page.getByTitle("Sync usage now").click();

    expect(pageErrors).toEqual([]);
  });
});

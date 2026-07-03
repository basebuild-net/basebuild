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
  test("shows detection-gated Oh My Pi tab and live telemetry HUD", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await page.waitForTimeout(1000);

    // The "+" menu should offer "Oh My Pi" because omp_status reports installed.
    await page.getByTitle("New tab").click();
    const ompEntry = page.getByRole("button", { name: "Oh My Pi", exact: true });
    await expect(ompEntry).toBeVisible();
    await ompEntry.click();

    // An OMP tab opens with the telemetry HUD.
    await expect(page.locator(".omp-telemetry-hud")).toBeVisible();
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
    // The Usage Sync panel renders with the auto-sync toggle.
    await expect(page.getByRole("heading", { name: "Usage Sync" })).toBeVisible();
    const toggle = page.locator('input[type="checkbox"][title="Enable hourly auto-sync to basebuild.net"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    // Enable auto-sync; the checkbox flips.
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

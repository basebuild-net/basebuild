import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

/**
 * Invariant 18: no surface renders nothing, a false empty state, or a false
 * negative while its data is in flight.
 *
 * These assertions are only meaningful against a slow backend — with the
 * instant mock the loading window does not exist. `__BASEBUILD_E2E_INVOKE_DELAY_MS__`
 * plus `__BASEBUILD_E2E_SLOW_COMMANDS__` hold the named commands open so the
 * loading state can be observed, then released so the settled state can be
 * checked too. Both halves matter: a permanent skeleton is as wrong as none.
 */
const SETTLE_MS = 3_500;

async function openSettingsWithSlowCommands(page: Page, commands: string[]) {
  await page.addInitScript((slow: string[]) => {
    const w = window as typeof window & {
      __BASEBUILD_E2E_INVOKE_DELAY_MS__?: number;
      __BASEBUILD_E2E_SLOW_COMMANDS__?: string[];
    };
    w.__BASEBUILD_E2E_INVOKE_DELAY_MS__ = 3_000;
    w.__BASEBUILD_E2E_SLOW_COMMANDS__ = slow;
  }, commands);
  await openMvpFixtureProject(page);
  await waitForAppReady(page);
  await page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first().click();
  await page.locator('button[title="Open settings"]').first().click();
  await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });
}

test.describe("Loading states", () => {
  test("analytics shows the source section with skeletons, never a blank gap", async ({ page }) => {
    await openSettingsWithSlowCommands(page, [
      "usage_sync_status",
      "usage_sync_projected_usage",
      "usage_detect_provider_plans",
    ]);
    await page.getByRole("button", { name: "Analytics", exact: true }).click();

    // The section frame is present immediately — it must not pop in.
    await expect(page.locator(".usage-source-section")).toBeVisible();
    await expect(page.locator(".bb-skeleton").first()).toBeVisible();
    await expect(page.locator(".usage-sync-outcome")).toContainText("Checking…");
    // Screen readers get the wait announced, not silence.
    await expect(page.getByText("Loading source status…")).toBeAttached();
    // No source row may claim a state before the data arrives.
    await expect(page.locator(".usage-source-row")).toHaveCount(0);

    // …and the skeleton is temporary.
    await expect(page.locator(".usage-source-row").first()).toBeVisible({ timeout: SETTLE_MS });
    await expect(page.locator(".bb-skeleton")).toHaveCount(0);
  });

  test("a setting's checkbox never renders 'off' before its value loads", async ({ page }) => {
    await openSettingsWithSlowCommands(page, ["usage_sync_status"]);
    await page.getByRole("button", { name: "Analytics", exact: true }).click();

    const row = page.locator("label").filter({ hasText: "Sync usage automatically" });
    // The control is absent, not unchecked: an unchecked box is a claim that
    // the setting is off, and the user can act on it.
    await expect(row.locator(".bb-skeleton-control")).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(row.getByLabel("Loading the automatic sync setting")).toBeAttached();

    // The real control replaces it, and the fixture's value is ON — exactly
    // the state the old placeholder misreported.
    await expect(row.locator('input[type="checkbox"]')).toBeChecked({ timeout: SETTLE_MS });
    await expect(row.locator(".bb-skeleton-control")).toHaveCount(0);
  });

  test("settings sections never assert 'none configured' before their fetch lands", async ({
    page,
  }) => {
    await openSettingsWithSlowCommands(page, [
      "mcp_list_servers",
      "mcp_reload",
      "final_touch_list_steps",
    ]);

    await page.getByRole("button", { name: "MCP Servers", exact: true }).click();
    await expect(page.locator(".bb-skeleton").first()).toBeVisible();
    await expect(page.getByText("No MCP servers configured.")).toHaveCount(0);
    // The truthful empty state appears only once the fetch settled.
    await expect(page.getByText("No MCP servers configured.")).toBeVisible({ timeout: SETTLE_MS });

    await page.getByRole("button", { name: "Final Touches", exact: true }).click();
    await expect(page.locator(".bb-skeleton").first()).toBeVisible();
    await expect(page.getByText(/No steps configured/)).toHaveCount(0);
    await expect(page.getByText(/No steps configured/)).toBeVisible({ timeout: SETTLE_MS });
  });

  test("OpenSpec does not report 'missing' while it is still checking", async ({ page }) => {
    await openSettingsWithSlowCommands(page, ["openspec_runtime_status"]);
    await page.getByRole("button", { name: "OpenSpec", exact: true }).click();

    // The old code rendered a definitive "OpenSpec: missing" badge plus full
    // manual-install instructions during a normal load.
    await expect(page.locator(".bb-loading-block")).toBeVisible();
    await expect(page.getByText(/OpenSpec: missing/)).toHaveCount(0);
    await expect(page.locator(".bb-loading-block")).toBeHidden({ timeout: SETTLE_MS });
  });
});

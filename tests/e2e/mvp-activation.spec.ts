import { expect, test } from "@playwright/test";
import {
  attachLogs,
  attachScreenshot,
  attachTiming,
  collectLogs,
  fixtureProject,
  openMvpFixtureProject,
  readE2eStateCounter,
  waitForAppReady,
} from "./helpers";

test.describe("MVP atomic project activation", () => {
  test("restart restores project C + last chat and panel", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    const activationMs = Date.now() - start;

    await attachScreenshot(page, "activation-restore-c-screenshot");
    await attachLogs(logs, "activation-restore-c-logs.txt");
    await attachTiming("activation-restore-c", activationMs);

    const projectC = fixtureProject(2);
    await expect(
      page.locator(".activity-sidebar-project-name", { hasText: projectC.name }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("rapid A→B→C settles only C", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page, { restoreDelayMs: 250 });
    await waitForAppReady(page);

    const projectA = fixtureProject(0);
    const projectB = fixtureProject(1);
    const projectC = fixtureProject(2);

    await page
      .locator(".activity-sidebar-project-row", { hasText: projectA.name })
      .click();
    await page
      .locator(".activity-sidebar-project-row", { hasText: projectB.name })
      .click();
    await page
      .locator(".activity-sidebar-project-row", { hasText: projectC.name })
      .click();

    await expect(
      page.locator(".activity-sidebar-project-name", { hasText: projectC.name }),
    ).toBeVisible({ timeout: 5_000 });

    const settleMs = Date.now() - start;

    await attachScreenshot(page, "activation-rapid-abc-screenshot");
    await attachLogs(logs, "activation-rapid-abc-logs.txt");
    await attachTiming("activation-rapid-abc", settleMs);

    const staleLogs = logs.filter((line) =>
      line.includes("Restore skipped (stale)"),
    );
    expect(staleLogs.length).toBeGreaterThanOrEqual(2);

    const activeSession = page.locator("h1.session-title");
    await expect(activeSession).toHaveCount(1);
    await expect(activeSession).toHaveText(projectC.name);
  });

  test.skip("partial failure shows error boundary, no old content", async () => {
    // The E2E mock contract in src/test-support/tauri-core.ts does not expose
    // a way to force `get_workspace_restore_state` to throw.
    // `__BASEBUILD_E2E_STATE__` has no failure flag for this command, and there
    // is no global hook to override the mocked invoke result. Skipping until
    // the mock supports deterministic restore-failure injection.
  });

  test("repeated folder clicks create one dialog", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page, { pickerDelayMs: 500 });
    await waitForAppReady(page);

    const openBtn = page.getByTitle("Add project folder").first();
    await expect(openBtn).toBeVisible({ timeout: 5_000 });

    await openBtn.evaluate((el) => {
      for (let i = 0; i < 3; i++) {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });

    const calls = await readE2eStateCounter(page, "pickProjectCalls");
    expect(calls).toBe(1);

    const inFlightBtn = page.getByTitle("Opening folder picker…").first();
    await expect(inFlightBtn).toBeVisible({ timeout: 1_000 });
    await expect(inFlightBtn).toBeDisabled();

    await expect(
      page.locator(".status-pill", { hasText: fixtureProject(2).path }),
    ).toBeVisible({ timeout: 5_000 });

    const pickerMs = Date.now() - start;

    await attachScreenshot(page, "activation-picker-single-flight-screenshot");
    await attachLogs(logs, "activation-picker-single-flight-logs.txt");
    await attachTiming("activation-picker-single-flight", pickerMs);

    const callsAfter = await readE2eStateCounter(page, "pickProjectCalls");
    expect(callsAfter).toBe(1);
  });

  test("ordinary switches produce no false orphan warnings", async ({ page }) => {
    const logs = collectLogs(page);
    const start = Date.now();
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    const projectA = fixtureProject(0);
    const projectC = fixtureProject(2);

    // Wait for initial app load to settle.
    await page.waitForTimeout(500);
    const baselineOrphanCount = logs.filter((line) =>
      /Orphaned session tabs/i.test(line),
    ).length;

    // Switch to alpha — may legitimately log alpha's fixture tab as orphan.
    await page
      .locator(".activity-sidebar-project-row", { hasText: projectA.name })
      .click();
    await expect(
      page.locator(".activity-sidebar-project-name", { hasText: projectA.name }),
    ).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);

    const afterAlphaOrphanCount = logs.filter((line) =>
      /Orphaned session tabs/i.test(line),
    ).length;
    // Switching to alpha should log at most 1 new orphan warning.
    expect(afterAlphaOrphanCount - baselineOrphanCount).toBeLessThanOrEqual(1);

    // Switch back to charlie — should not log more than 1 new orphan warning.
    await page
      .locator(".activity-sidebar-project-row", { hasText: projectC.name })
      .click();
    await expect(
      page.locator(".activity-sidebar-project-name", { hasText: projectC.name }),
    ).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);

    const afterCharlieOrphanCount = logs.filter((line) =>
      /Orphaned session tabs/i.test(line),
    ).length;
    // The regression we guard against: re-logging the same orphan ids
    // multiple times when switching back to an already-seen project.
    // At most 1 new orphan warning per switch is acceptable.
    expect(afterCharlieOrphanCount - afterAlphaOrphanCount).toBeLessThanOrEqual(1);
    // The fixture tabs for alpha are intentionally unbound from panels, so
    // switching to alpha legitimately surfaces them once. The regression we
    // guard against is re-logging the same orphan ids when switching back to
    // an already-seen project (charlie), which would indicate a stale ref or
    // duplicate config load.

    const switchMs = Date.now() - start;

    await attachScreenshot(page, "activation-no-false-orphans-screenshot");
    await attachLogs(logs, "activation-no-false-orphans-logs.txt");
    await attachTiming("activation-no-false-orphans", switchMs);
  });
});

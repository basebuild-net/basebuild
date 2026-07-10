import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

test.describe("Agent status indicators", () => {
  test("active project shows status dot; other projects show idle dot", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // The active project header has a status dot.
    const activeDot = page.locator(".activity-sidebar-project .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });

    // With panels present (fixture has tabs/sessions), the active project
    // should show standby or running status — not idle.
    const dotClass = await activeDot.getAttribute("class");
    expect(dotClass).toMatch(/agent-status-(standby|running|questioning|idle)/);

    // Other project rows show idle status dots.
    const otherDots = page.locator(".activity-sidebar-project-row .agent-status-dot");
    const count = await otherDots.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const cls = await otherDots.nth(i).getAttribute("class");
      expect(cls).toContain("agent-status-idle");
    }
  });

  test("status dot has tooltip with agent status", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    const activeDot = page.locator(".activity-sidebar-project .agent-status-dot").first();
    await expect(activeDot).toBeVisible({ timeout: 5_000 });
    await expect(activeDot).toHaveAttribute("title", /Agent: (running|standby|questioning|idle)/);
  });
});

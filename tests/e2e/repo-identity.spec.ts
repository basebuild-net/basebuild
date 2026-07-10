import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, fixtureProject } from "./helpers";

test.describe("Left column: repo identity and all projects visible", () => {
  test("all projects visible; active project shows repo icon, name, and branch", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // The active project header shows repo icon, name, and branch.
    const activeProject = page.locator(".activity-sidebar-project").first();
    await expect(activeProject).toBeVisible({ timeout: 5_000 });
    await expect(activeProject.locator(".repo-icon-svg")).toBeVisible();
    await expect(activeProject.locator(".activity-sidebar-project-name")).not.toBeEmpty();
    await expect(activeProject.locator(".activity-sidebar-project-branch")).toContainText("main");
  });

  test("other projects visible with repo icons and clickable", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Other projects are listed below the panel list.
    const otherProjects = page.locator(".activity-sidebar-project-row");
    await expect(otherProjects.first()).toBeVisible({ timeout: 5_000 });
    const count = await otherProjects.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Each other project row has a repo icon and name.
    for (let i = 0; i < count; i++) {
      const row = otherProjects.nth(i);
      await expect(row.locator(".repo-icon-svg")).toBeVisible();
      await expect(row.locator(".activity-sidebar-row-title")).not.toBeEmpty();
    }

    // Clicking an other project switches to it.
    const target = fixtureProject(1);
    const targetRow = page.locator(".activity-sidebar-project-row").filter({ hasText: target.path.split(/[\\/]/).pop() ?? target.path }).first();
    await targetRow.click();
    // After switching, the new project becomes the active project header.
    await expect(page.locator(".activity-sidebar-project")).toContainText(target.path.split(/[\\/]/).pop() ?? target.path);
  });
});

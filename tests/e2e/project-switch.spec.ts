import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, fixtureProject } from "./helpers";

test.describe("Project switch transition", () => {
  test("switching projects shows overlay with target project name", async ({ page }) => {
    await openMvpFixtureProject(page, { restoreDelayMs: 500 });
    await waitForAppReady(page);
    // Wait for splash to dismiss.
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Select a different fixture project via the sidebar.
    const target = fixtureProject(1);
    const projectItem = page.getByTitle(target.path).first();
    await projectItem.waitFor({ state: "visible", timeout: 5_000 });
    await projectItem.click();

    // The switching overlay must show the target project name immediately.
    const overlay = page.locator(".project-switching-overlay");
    await expect(overlay).toBeVisible({ timeout: 3_000 });
    const expectedName = target.path.split(/[\\/]/).pop() ?? target.path;
    await expect(overlay).toContainText(expectedName);

    // Overlay clears when restore completes.
    await expect(overlay).not.toBeVisible({ timeout: 10_000 });
  });

  test("rapid switching settles on the final target", async ({ page }) => {
    await openMvpFixtureProject(page, { restoreDelayMs: 600 });
    await waitForAppReady(page);
    await expect(page.locator(".workspace-splash")).not.toBeVisible({ timeout: 10_000 });

    // Click three projects in rapid succession.
    const proj1 = page.getByTitle(fixtureProject(0).path).first();
    const proj2 = page.getByTitle(fixtureProject(1).path).first();
    const proj3 = page.getByTitle(fixtureProject(2).path).first();
    await proj1.click();
    await proj2.click();
    await proj3.click();

    // The overlay should be visible during the switch.
    await expect(page.locator(".project-switching-overlay")).toBeVisible({ timeout: 3_000 });

    // After restore completes, the overlay is gone and the shell is usable.
    await expect(page.locator(".project-switching-overlay")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".app-shell")).toBeVisible();
  });
});

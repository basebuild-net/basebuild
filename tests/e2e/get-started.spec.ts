import { expect, test } from "@playwright/test";
import { openFixtureProject, waitForAppReady } from "./helpers";

test.describe("Get started home", () => {
  test("empty workspace shows three step cards; a connected provider counts as done", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });
    await page.goto("/");
    await waitForAppReady(page);

    const home = page.locator(".get-started");
    await expect(home).toBeVisible({ timeout: 10_000 });
    await expect(home.locator("h2")).toHaveText("Get started");
    await expect(home.locator(".get-started-progress")).toHaveText("1 of 3 done");
    await expect(home.locator(".get-started-card")).toHaveCount(3);
    await expect(home.locator(".get-started-card.is-done")).toHaveCount(1);
    await expect(home.getByRole("button", { name: "Open project" })).toBeVisible();
    await expect(home.getByRole("button", { name: "New chat" })).toBeDisabled();
  });

  test("choose provider card opens the provider settings", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
    });
    await page.goto("/");
    await waitForAppReady(page);

    const home = page.locator(".get-started");
    await expect(home).toBeVisible({ timeout: 10_000 });
    await home.getByRole("button", { name: "Choose provider" }).click();
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 10_000 });
  });

  test("home is hidden once a project has surfaces", async ({ page }) => {
    await openFixtureProject(page);
    await expect(page.locator(".get-started")).toHaveCount(0);
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible({ timeout: 10_000 });
  });
});

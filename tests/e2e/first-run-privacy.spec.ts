import { expect, test } from "@playwright/test";

test.describe("First-run privacy step", () => {
  test("anonymous usage sharing starts unchecked on a fresh install", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });
    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await page.getByTitle("Use dark mode").click();
    await page.getByTitle("Start setup").click();
    await page.getByTitle("Continue to terminal setup").click();
    await page.getByTitle("Continue to Windows startup setup").click();
    await page.getByTitle("Continue to privacy setup").click();

    const share = page.getByTitle("Share anonymous aggregate usage with basebuild.net after setup completes");
    await expect(share).toBeVisible({ timeout: 10_000 });
    await expect(share).not.toBeChecked();
  });
});

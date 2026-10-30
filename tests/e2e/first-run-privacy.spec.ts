import { expect, test } from "@playwright/test";

test.describe("First-run privacy step", () => {
  test("anonymous usage sharing starts unchecked on a fresh install", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("basebuild:first-run-complete");
    });
    await page.goto("/");

    const modal = page.locator(".modal-first-run");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    const share = page.getByTitle("Share anonymous usage");
    await expect(share).toBeVisible({ timeout: 10_000 });
    await expect(share).not.toBeChecked();
  });
});

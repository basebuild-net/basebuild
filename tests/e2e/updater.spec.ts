import { expect, test } from "@playwright/test";

test.describe("updater taskbar", () => {
  test("shows detected update and starts one-click install", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });

    await page.goto("/");

    const updateButton = page.getByTitle("Download and install Basebuild 0.0.5");
    await expect(updateButton).toBeVisible();
    await expect(updateButton).toContainText("Update 0.0.5");

    await updateButton.click();
    await expect(updateButton).toContainText("Installing…");
  });
});

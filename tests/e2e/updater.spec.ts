import { expect, test } from "@playwright/test";

test.describe("updater taskbar", () => {
  test("shows silent auto-update status indicator (no install CTA)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });

    await page.goto("/");

    // Silent auto-update: the taskbar shows a non-interactive status
    // indicator, not an install button. The backend auto-installs.
    const status = page.getByTitle(/Downloading Basebuild 0\.0\.5 in the background/);
    // The status indicator shows "Updating" initially, then transitions to
    // "Installing…" once the silent auto-install begins. Either is valid.
    await expect(status).toContainText(/Updating 0\.0\.5|Installing…/);
    await expect(status).toBeDisabled();
  });
});

import { expect, test } from "@playwright/test";

test.describe("updater taskbar", () => {
  test("downloads in background, then offers Restart to apply (no forced restart)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("basebuild:first-run-complete", "true");
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });

    await page.goto("/");

    // The update downloads silently and is staged; the app keeps running.
    // The taskbar then shows an explicit "Restart to apply update" CTA —
    // the app never restarts on its own mid-session.
    const restartCta = page.getByTitle(/Basebuild 0\.0\.5 is downloaded — click to restart and apply it/);
    await expect(restartCta).toContainText("Restart to apply update");
    await expect(restartCta).toBeEnabled();

    // Clicking the CTA is the only path that triggers the install/restart.
    await restartCta.click();
    await expect(restartCta).toBeDisabled();
    await expect(restartCta).toContainText("Restarting…");
  });
});

import { expect, test } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady } from "./helpers";

test.describe("UI scale (zoom)", () => {
  test("CTRL+= zooms in, CTRL+0 resets, and the scale persists", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    const readZoom = () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("zoom") || "1");

    await page.keyboard.press("Control+=");
    expect(await readZoom()).toBe("1.1");
    await page.keyboard.press("Control+=");
    expect(await readZoom()).toBe("1.2");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.zoom"))).toBe("120");

    // Persists across reloads via the pre-paint bootstrap.
    await page.reload();
    await waitForAppReady(page);
    expect(await readZoom()).toBe("1.2");

    await page.keyboard.press("Control+0");
    expect(await readZoom()).toBe("1");
    expect(await page.evaluate(() => localStorage.getItem("basebuild.zoom"))).toBe("100");
  });

  test("scale clamps at the maximum and the layout keeps the composer visible", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.zoom", "150");
      } catch {
        // ignore
      }
    });
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("zoom")),
    ).toBe("1.5");
    // Clamped: another zoom-in stays at the bound.
    await page.keyboard.press("Control+=");
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("zoom")),
    ).toBe("1.5");
    // The composer (chat input area) must remain visible at maximum scale.
    await expect(page.locator(".chat-input-area").first()).toBeVisible({ timeout: 10_000 });
  });

  test("out-of-bounds persisted scale falls back to 100%", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("basebuild.zoom", "999");
      } catch {
        // ignore
      }
    });
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("zoom") || "1"),
    ).toBe("1");
  });

  test("settings Appearance group leads and hosts theme plus scale", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    // Open settings via the account menu.
    const accountBtn = page.locator('button[title*="MVPUser"], button[title*="Sign in"]').first();
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click({ timeout: 10_000 });
    await page.locator('button[title="Open settings"]').first().click({ timeout: 5_000 });
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 15_000 });

    // Appearance group renders first, above the group containing Updates.
    await expect(page.locator(".settings-group-label").first()).toHaveText("Appearance");
    const groups = page.locator(".settings-group");
    await expect(groups.first().locator(".settings-tab", { hasText: "Appearance" })).toBeVisible();

    await page.locator(".settings-tab", { hasText: "Appearance" }).click();
    await expect(page.locator(".theme-picker")).toBeVisible();
    const value = page.locator(".ui-scale-value");
    await expect(value).toHaveText("100%");
    await page.getByTitle("Increase UI scale (CTRL+=)").click();
    await expect(value).toHaveText("110%");
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("zoom")),
    ).toBe("1.1");
    await page.getByTitle("Reset UI scale to 100% (CTRL+0)").click();
    await expect(value).toHaveText("100%");
  });

  test("plans dropdown actions live in the shared row menu", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await page.locator('.planning-indicator[data-stage="plans"]').first().click();
    const dropdown = page.locator('.planning-notification-dropdown[data-stage="plans"]');
    await expect(dropdown).toBeVisible();
    const row = dropdown.locator(".planning-dropdown-row").first();
    await expect(row.locator(".planning-notification-item-title")).toBeVisible();
    // No inline action icons — a single `…` menu carries the actions.
    const rowTitle = (await row.locator(".planning-notification-item-title").textContent()) ?? "";
    await row.getByTitle(`More actions for ${rowTitle}`).click();
    await expect(dropdown.getByRole("button", { name: "Copy plan id" })).toBeVisible();
    await expect(dropdown.getByRole("button", { name: "Delete plan" })).toBeVisible();
  });
});

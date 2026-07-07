import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" }),
  ).toBeVisible();
}

async function openPlanningInspector(page: Page) {
  await openFixtureProject(page);
  // The planning inspector lives behind the "Plans & Ideas" button in the
  // activity sidebar or the chat environment panel.
  const plansBtn = page.getByRole("button", { name: "Plans & Ideas" }).first();
  await plansBtn.click();
  // Wait for the inspector tabs to appear.
  await expect(page.locator(".inspector-tab").first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Planning cockpit: OpenSpec change catalog", () => {
  test("Changes tab is visible in planning inspector", async ({ page }) => {
    await openPlanningInspector(page);

    const changesTab = page.locator(".inspector-tab", { hasText: "Changes" }).first();
    await expect(changesTab).toBeVisible({ timeout: 5_000 });
  });

  test("Changes tab renders the changes panel when clicked", async ({ page }) => {
    await openPlanningInspector(page);

    const changesTab = page.locator(".inspector-tab", { hasText: "Changes" }).first();
    await changesTab.click();

    await expect(page.locator(".changes-panel")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".changes-panel-title", { hasText: "OpenSpec Changes" })).toBeVisible();
  });

  test("changes panel shows empty state when no changes exist", async ({ page }) => {
    await openPlanningInspector(page);

    const changesTab = page.locator(".inspector-tab", { hasText: "Changes" }).first();
    await changesTab.click();

    await expect(page.locator(".changes-panel-empty")).toBeVisible({ timeout: 5_000 });
  });
});

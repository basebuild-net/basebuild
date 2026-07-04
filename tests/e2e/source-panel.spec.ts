import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" })).toBeVisible();
}

async function openSourcePanel(page: Page) {
  const expandSource = page.getByTitle("Expand Source").first();
  if (await expandSource.count()) {
    await expandSource.click();
  }
  await expect(page.locator(".source-panel")).toBeVisible();
}

test.describe("source panel", () => {
  test("generates an AI commit message into the commit textarea", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await openSourcePanel(page);

    const changeRow = page.locator(".source-file-row", { hasText: "SourcePanel.tsx" }).first();
    await expect(changeRow).toBeVisible();
    await changeRow.locator('input[type="checkbox"]').check();

    await expect(page.locator(".source-section", { hasText: "Staged Changes" })).toContainText("SourcePanel.tsx");
    await page.getByTitle("Generate commit message with AI").click();

    await expect(page.locator('textarea[title="Commit message"]')).toHaveValue("Rework patch system to target sbox-public");
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

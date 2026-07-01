import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".status-pill", { hasText: "C:\\basebuild-e2e\\project" })).toBeVisible();
}

test.describe("plan context generation", () => {
  test("opens a chat draft instead of black-screening", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await page.getByTitle("Generate plans from goal").click();
    await page.getByRole("button", { name: /From project context/ }).click();
    await page.getByRole("button", { name: "Generate from context" }).click();

    await expect(page.locator(".app-container")).toBeVisible();
    await expect(page.getByTitle("Chat input — type a message and press Enter to send")).toHaveValue(/Project Schematic/);
    await expect(page.getByText("Basebuild renderer crashed")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

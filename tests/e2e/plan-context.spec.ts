import { expect, test, type Page } from "@playwright/test";

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".activity-sidebar-project-name", { hasText: "project" })).toBeVisible();
}

test.describe("plan context generation", () => {
  test("chat composer is reachable without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // The Generate plans modal was removed (schematic-grounded-planning).
    // Generation now runs through the chat planning menu. For now, just
    // verify the app shell renders without crashes and the chat input is
    // reachable. The full generation flow is exercised once the menu is
    // rewired (task 4.3).
    await expect(page.locator(".app-container")).toBeVisible();
    await expect(page.getByTitle("Chat input — type a message and press Enter to send")).toBeVisible();
    await expect(page.getByText("Basebuild renderer crashed")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

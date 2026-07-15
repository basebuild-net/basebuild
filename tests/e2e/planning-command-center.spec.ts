import { expect, test, type Page } from "@playwright/test";
import { openPlanningModal } from "./helpers";
async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(
    page.locator(".activity-sidebar-project-name, .activity-sidebar-row-title", { hasText: "project" }),
  ).toBeVisible({ timeout: 5_000 });
}

test.describe("Visual planning command center", () => {
  test("command center renders stage cards with counts", async ({ page }) => {
    await openFixtureProject(page);

    // Open the Plans & Ideas modal via the planning indicators.
    await openPlanningModal(page);

    // Click the Flow tab.
    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();
    await expect(page.locator(".flow-board")).toBeVisible({ timeout: 5_000 });

    // Command center should render with stage cards.
    await expect(page.locator(".planning-command-center")).toBeVisible({ timeout: 5_000 });

    // Eight stage cards: Ideas, OpenSpec, Ready, Queued, Running, Blocked, Review, Finished.
    const stageCards = page.locator(".planning-stage-card");
    const count = await stageCards.count();
    expect(count).toBeGreaterThanOrEqual(8);

    // Verify labels are present.
    await expect(page.locator(".planning-stage-label", { hasText: "Ideas" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "OpenSpec" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Ready" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Running" })).toBeVisible();
    await expect(page.locator(".planning-stage-label", { hasText: "Finished" })).toBeVisible();
  });

  test("command center shows primary action buttons", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningModal(page);

    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();

    // Every visible action is wired to a concrete coordinator surface.
    await expect(page.locator(".planning-command-actions button", { hasText: "Generate ideas" })).toBeVisible();
    await expect(page.locator(".planning-command-actions button", { hasText: "Review ideas" })).toBeVisible();
    await expect(page.getByTitle("Review finished runs awaiting review")).toBeVisible();
    await expect(page.locator(".planning-command-actions button", { hasText: "Archive/Sync" })).toBeVisible();
    await page.locator(".planning-stage-card", { hasText: "Running" }).click();
    await expect(page.locator(".inspector-tab.is-active", { hasText: "Runs" })).toBeVisible();
  });

  test("stage cards have title tooltips with count and action", async ({ page }) => {
    await openFixtureProject(page);
    await openPlanningModal(page);

    const flowTab = page.locator(".inspector-tab", { hasText: "Flow" }).first();
    await flowTab.click();

    // Each stage card must have a title attribute.
    const cards = page.locator(".planning-stage-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const title = await cards.nth(i).getAttribute("title");
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(0);
    }
  });

  test("ideas indicator provides complete quick management actions", async ({ page }) => {
    await openFixtureProject(page);

    await page.locator(".planning-indicator[data-stage='ideas']").click();
    const dropdown = page.locator(".planning-notification-dropdown[data-stage='ideas']");
    await expect(dropdown).toBeVisible();
    await expect(
      dropdown.getByRole("button", { name: "Generate more ideas" }),
    ).toBeVisible();

    await dropdown.getByRole("button", { name: "New idea" }).click();
    await dropdown.getByTitle("Create idea title").fill("Quick menu idea");
    await dropdown.getByTitle("Create idea description").fill("Created without opening the full planning modal.");
    await dropdown.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dropdown.locator(".planning-quick-idea-title")).toHaveText("Quick menu idea");

    await dropdown.locator(".planning-quick-idea-main", { hasText: "Quick menu idea" }).click();
    await dropdown.getByTitle("Edit idea title").fill("Updated quick menu idea");
    await dropdown.getByTitle("Save idea changes").click();
    await expect(dropdown.locator(".planning-quick-idea-title")).toHaveText("Updated quick menu idea");

    await dropdown
      .getByRole("button", { name: "Upgrade Updated quick menu idea to a plan" })
      .click();
    await expect(dropdown.getByTitle("Change status for Updated quick menu idea")).toHaveValue("picked");
    await expect(page.locator(".planning-indicator[data-stage='plans']")).toHaveAttribute("title", /Plans: 1/);

    await dropdown
      .getByRole("button", { name: "Delete Updated quick menu idea" })
      .click();
    await dropdown
      .getByRole("button", { name: "Confirm deletion of Updated quick menu idea" })
      .click();
    await expect(dropdown.locator(".planning-quick-idea")).toHaveCount(0);

    await dropdown.getByRole("button", { name: "Generate more ideas" }).click();
    await expect(page.getByRole("dialog", { name: "Schematic incomplete" })).toBeVisible();
  });
});

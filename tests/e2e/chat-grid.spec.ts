import { expect, test, type Page } from "@playwright/test";
import { ensureChatPanel } from "./helpers";

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

async function pointerDrag(page: Page, sourceSelector: string, targetSelector: string, targetEdge: "center" | "right" = "center") {
  const sourceBox = await page.locator(sourceSelector).first().boundingBox();
  const targetBox = await page.locator(targetSelector).first().boundingBox();
  if (!sourceBox || !targetBox) throw new Error(`Missing drag bounds for ${sourceSelector} -> ${targetSelector}`);
  await page.mouse.move(sourceBox.x + sourceBox.width / 3, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetEdge === "right" ? targetBox.x + targetBox.width - 4 : targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

test.describe("panel grid", () => {
  test("a chat panel renders with compact header controls", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    await expect(page.locator(".panel-grid")).toBeVisible();
    await expect(page.locator(".panel-grid-leaf").first()).toBeVisible();
    await expect(page.locator(".chat-column-header").first()).toBeVisible();
    await expect(page.locator(".chat-column-model-chip").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Permission mode:/ }).first()).toBeVisible();
    await expect(page.locator(".chat-column-model-chip").first()).toHaveAttribute("title");

    const panelHeader = page.locator(".panel-header").first();
    await expect(panelHeader.getByTitle("Split horizontally (top and bottom)")).toBeVisible();
    await expect(panelHeader.getByTitle("Split vertically (left and right)")).toBeVisible();
    await expect(panelHeader.getByTitle("Close and move to History")).toBeVisible();
    await expect(panelHeader.getByTitle("More actions")).toHaveCount(0);

    await panelHeader.getByTitle("Split horizontally (top and bottom)").click();
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    const splitBoxes = await page.locator(".panel-grid-leaf").evaluateAll((leaves) =>
      leaves.map((leaf) => {
        const rect = leaf.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      }),
    );
    expect(Math.abs(splitBoxes[0].x - splitBoxes[1].x)).toBeLessThan(4);
    expect(splitBoxes[1].y).toBeGreaterThan(splitBoxes[0].y + 20);

    await page.getByTitle("More chat actions").first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Duplicate window" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(pageErrors).toEqual([]);
  });

  test("chat windows can be added, rearranged, hidden, and restored", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    const addChat = page.locator(".sidebar-top-actions button[title='Add chat window']");
    await addChat.click();
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-group-label", { hasText: "Linked group" })).toContainText("2");
    const rowLeftEdges = await page.locator(".surface-row.is-visible").evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().left),
    );
    expect(Math.abs(rowLeftEdges[0] - rowLeftEdges[1])).toBeLessThan(1);

    const before = await page.locator(".panel-grid-leaf").evaluateAll((leaves) =>
      leaves.map((leaf) => leaf.getAttribute("data-surface-id")),
    );
    await pointerDrag(
      page,
      `.panel-grid-leaf[data-surface-id="${before[0]}"] .panel-header`,
      `.panel-grid-leaf[data-surface-id="${before[1]}"]`,
      "right",
    );
    await expect.poll(async () =>
      page.locator(".panel-grid-leaf").evaluateAll((leaves) =>
        leaves.map((leaf) => leaf.getAttribute("data-surface-id")),
      ),
    ).toEqual([before[1], before[0]]);

    await pointerDrag(page, ".panel-grid-leaf:first-child .panel-header", ".surface-unlink-dropzone");
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);
    await expect(page.locator(".surface-group-label", { hasText: "Linked group" })).toHaveCount(0);
    await expect(page.locator(".surface-group-label.is-unlinked")).toContainText("1");

    await page.locator(".surface-row.is-hidden").dragTo(page.locator(".surface-row.is-visible"));
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(0);
    await expect(page.locator(".surface-group-label", { hasText: "Linked group" })).toContainText("2");

    expect(pageErrors).toEqual([]);
  });

  test("the chat panel sends and renders a turn", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // Type and send a message.
    await page.getByTitle(/Chat input/).first().fill("Hello from the grid");
    await page.getByTitle("Send message").click();

    await expect(page.locator(".chat-message-user")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant")).toHaveCount(1);
    await expect(page.locator(".chat-message-assistant .chat-message-content")).toContainText("Native harness echo");

    expect(pageErrors).toEqual([]);
  });

  test("the panel grid is present and well-formed", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);
    await ensureChatPanel(page);

    // The grid container is present.
    await expect(page.locator(".panel-grid")).toBeVisible();
    // At least one leaf is rendered.
    const leaves = page.locator(".panel-grid-leaf");
    await expect(leaves.first()).toBeVisible();
    expect(await leaves.count()).toBeGreaterThanOrEqual(1);

    expect(pageErrors).toEqual([]);
  });
});

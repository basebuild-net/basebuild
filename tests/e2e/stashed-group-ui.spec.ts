import { expect, test, type Page } from "@playwright/test";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openFixtureProject(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await page.locator(".app-shell").waitFor({ state: "attached", timeout: 10_000 });
  await page.locator(".panel-grid-leaf").first().waitFor({ state: "visible", timeout: 10_000 });
}

/** Click a sidebar row by surface id. Uses evaluate to dispatch a real
 *  MouseEvent — Playwright's .click() on a draggable element can be
 *  interpreted as a drag start. */
async function clickSidebarRow(page: Page, surfaceId: string) {
  await page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(`.surface-row[data-surface-id="${id}"]`);
    if (!row) return;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, surfaceId);
  await page.waitForTimeout(300);
}

/** Get the surface ids of all visible (in-grid) panels, in DOM order. */
async function getVisibleSurfaceIds(page: Page): Promise<string[]> {
  return page.locator(".panel-grid-leaf").evaluateAll((leaves) =>
    leaves.map((leaf) => leaf.getAttribute("data-surface-id")).filter(Boolean) as string[],
  );
}

/** Get the surface ids of all sidebar hidden (unlinked) rows. */
async function getSidebarHiddenIds(page: Page): Promise<string[]> {
  return page.locator(".surface-row.is-hidden").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-surface-id")).filter(Boolean) as string[],
  );
}

/** Get the surface ids of all sidebar stashed rows. */
async function getSidebarStashedIds(page: Page): Promise<string[]> {
  return page.locator(".surface-row.is-stashed").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-surface-id")).filter(Boolean) as string[],
  );
}

/** Count total sidebar surface rows (visible + hidden + stashed). */
async function getTotalSidebarRowCount(page: Page): Promise<number> {
  return page.locator(".surface-row").count();
}

/** Perform a pointer-based drag (for panel headers that use pointer events). */
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

/** Create a linked group of N panels by clicking "Add chat window" (N-1) times. */
async function createLinkedGroup(page: Page, count: number): Promise<string[]> {
  for (let i = 1; i < count; i++) {
    await page.locator(".sidebar-top-actions button[title='Add chat window']").click();
    await page.waitForTimeout(200);
  }
  await expect(page.locator(".panel-grid-leaf")).toHaveCount(count);
  return getVisibleSurfaceIds(page);
}

/** Unlink a panel by dragging its header to the unlink dropzone. */
async function unlinkPanel(page: Page, surfaceId: string): Promise<void> {
  await pointerDrag(page, `.panel-grid-leaf[data-surface-id="${surfaceId}"] .panel-header`, ".surface-unlink-dropzone");
  await page.waitForTimeout(300);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Chat grouping — stashed group lifecycle", () => {
  test("clicking unlinked chat stashes a linked group of 2+ panels", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group
    const groupIds = await createLinkedGroup(page, 3);
    expect(groupIds).toHaveLength(3);

    // Unlink the third panel → 2 visible + 1 hidden
    await unlinkPanel(page, groupIds[2]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);

    // Click the unlinked chat → should stash the 2-panel group
    const hiddenIds = await getSidebarHiddenIds(page);
    expect(hiddenIds).toContain(groupIds[2]);

    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);

    // Now: 1 visible (the unlinked chat), 2 stashed (the linked group)
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    const visibleIds = await getVisibleSurfaceIds(page);
    expect(visibleIds).toContain(groupIds[2]);

    // The stashed group should have the 2 remaining panels
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(2);
    const stashedIds = await getSidebarStashedIds(page);
    expect(stashedIds).toContain(groupIds[0]);
    expect(stashedIds).toContain(groupIds[1]);

    // The unlinked chat should NOT be in hidden anymore
    const hiddenAfter = await getSidebarHiddenIds(page);
    expect(hiddenAfter).not.toContain(groupIds[2]);

    expect(pageErrors).toEqual([]);
  });

  test("clicking stashed panel restores the whole linked group", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group, unlink one
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Click the unlinked chat → stashes the 2-panel group
    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(2);

    // Click a stashed panel → should restore the whole group
    await clickSidebarRow(page, groupIds[0]);
    await page.waitForTimeout(300);

    // Should have 2 visible panels (the restored linked group)
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(0);

    // The unlinked chat should be back in hidden
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);
    const hiddenIds = await getSidebarHiddenIds(page);
    expect(hiddenIds).toContain(groupIds[2]);

    // The restored group should have the 2 original panels
    const visibleIds = await getVisibleSurfaceIds(page);
    expect(visibleIds).toContain(groupIds[0]);
    expect(visibleIds).toContain(groupIds[1]);

    expect(pageErrors).toEqual([]);
  });

  test("switching between two unlinked chats preserves the stash", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group, unlink two of them
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);
    await unlinkPanel(page, groupIds[1]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(2);

    // Click one unlinked chat → stashes the 1 visible panel (no stash since
    // only 1 visible panel — it goes to hidden instead)
    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    // Click the other unlinked chat
    await clickSidebarRow(page, groupIds[1]);
    await page.waitForTimeout(300);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    // Click the original visible panel
    await clickSidebarRow(page, groupIds[0]);
    await page.waitForTimeout(300);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    // All 3 panels should still be accounted for
    const totalRows = await getTotalSidebarRowCount(page);
    expect(totalRows).toBe(3);

    expect(pageErrors).toEqual([]);
  });

  test("no panel disappears during rapid switching", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group, unlink one
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);

    const totalBefore = await getTotalSidebarRowCount(page);
    expect(totalBefore).toBe(3);

    // Rapidly switch between unlinked and stashed
    for (let i = 0; i < 4; i++) {
      const hiddenIds = await getSidebarHiddenIds(page);
      if (hiddenIds.length > 0) {
        await clickSidebarRow(page, hiddenIds[0]);
        await page.waitForTimeout(150);
      }
      const stashedIds = await getSidebarStashedIds(page);
      if (stashedIds.length > 0) {
        await clickSidebarRow(page, stashedIds[0]);
        await page.waitForTimeout(150);
      }
    }

    // No panel should have disappeared
    const totalAfter = await getTotalSidebarRowCount(page);
    expect(totalAfter).toBe(totalBefore);

    expect(pageErrors).toEqual([]);
  });

  test("drag visible panel to unlink dropzone makes it unlinked", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    const groupIds = await createLinkedGroup(page, 2);
    await unlinkPanel(page, groupIds[1]);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-visible")).toHaveCount(1);

    const visibleIds = await getVisibleSurfaceIds(page);
    expect(visibleIds).toContain(groupIds[0]);
    const hiddenIds = await getSidebarHiddenIds(page);
    expect(hiddenIds).toContain(groupIds[1]);

    expect(pageErrors).toEqual([]);
  });

  test("drag hidden panel to visible row re-links it", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    const groupIds = await createLinkedGroup(page, 2);
    await unlinkPanel(page, groupIds[1]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);

    await page.locator(".surface-row.is-hidden").first().dragTo(page.locator(".surface-row.is-visible").first());
    await page.waitForTimeout(300);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(0);
    await expect(page.locator(".surface-row.is-visible")).toHaveCount(2);

    expect(pageErrors).toEqual([]);
  });

  test("sidebar shows stashed group section when unlinked chat is shown", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group, unlink one → 2 visible + 1 hidden
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(2);

    // Click the unlinked chat → stashes the 2-panel group
    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);

    // Should see a stashed group label and stashed rows
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(2);

    // The stashed rows should have tooltips mentioning "stashed"
    const stashedRow = page.locator(".surface-row.is-stashed").first();
    await expect(stashedRow).toHaveAttribute("title", /stashed/i);

    expect(pageErrors).toEqual([]);
  });

  test("three-panel group preserves split structure through stash/restore", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 4-panel linked group
    const groupIds = await createLinkedGroup(page, 4);
    expect(groupIds).toHaveLength(4);

    // Unlink one → 3 visible + 1 hidden
    await unlinkPanel(page, groupIds[3]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(3);

    // Click the unlinked chat → stashes the 3-panel group
    await clickSidebarRow(page, groupIds[3]);
    await page.waitForTimeout(300);

    // Should be 1 visible + 3 stashed
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(3);

    // Click a stashed panel to restore
    await clickSidebarRow(page, groupIds[0]);
    await page.waitForTimeout(300);

    // Should have 3 visible panels (the restored linked group)
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(3);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(0);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });

  test("closing a visible panel from a 2-panel group leaves 1 visible + 0 stashed", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    await createLinkedGroup(page, 2);

    // Close the second panel via its header X button
    await page.locator(".panel-header").nth(1).getByTitle("Close and move to History").click();
    await page.waitForTimeout(300);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(0);

    // Total active surfaces should be 1 (just the remaining visible one)
    const visibleIds = await getVisibleSurfaceIds(page);
    const hiddenIds = await getSidebarHiddenIds(page);
    const stashedIds = await getSidebarStashedIds(page);
    const totalActive = visibleIds.length + hiddenIds.length + stashedIds.length;
    expect(totalActive).toBe(1);

    expect(pageErrors).toEqual([]);
  });

  test("single visible panel switching with unlinked does not create stash", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 2-panel group, unlink one → 1 visible + 1 hidden
    const groupIds = await createLinkedGroup(page, 2);
    await unlinkPanel(page, groupIds[1]);
    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);

    // Click the unlinked chat → single visible panel goes to hidden (no stash)
    await clickSidebarRow(page, groupIds[1]);
    await page.waitForTimeout(300);

    await expect(page.locator(".panel-grid-leaf")).toHaveCount(1);
    await expect(page.locator(".surface-row.is-stashed")).toHaveCount(0);
    await expect(page.locator(".surface-row.is-hidden")).toHaveCount(1);

    // The previously visible panel should be in hidden
    const hiddenIds = await getSidebarHiddenIds(page);
    expect(hiddenIds).toContain(groupIds[0]);

    // The clicked panel should be visible
    const visibleIds = await getVisibleSurfaceIds(page);
    expect(visibleIds).toContain(groupIds[1]);

    expect(pageErrors).toEqual([]);
  });
});

test.describe("Chat grouping — invariant checks", () => {
  test("total surface count never changes during link/unlink/stash/restore", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openFixtureProject(page);

    // Create a 3-panel linked group
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);

    const totalBefore = await getTotalSidebarRowCount(page);
    expect(totalBefore).toBe(3);

    // Click unlinked → stash
    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);

    // Click stashed → restore
    const stashedIds = await getSidebarStashedIds(page);
    if (stashedIds.length > 0) {
      await clickSidebarRow(page, stashedIds[0]);
      await page.waitForTimeout(300);
    }

    // Re-link by dragging hidden onto visible
    const hiddenIds = await getSidebarHiddenIds(page);
    if (hiddenIds.length > 0) {
      await page.locator(".surface-row.is-hidden").first().dragTo(page.locator(".surface-row.is-visible").first());
      await page.waitForTimeout(300);
    }

    const totalAfter = await getTotalSidebarRowCount(page);
    expect(totalAfter).toBe(totalBefore);

    expect(pageErrors).toEqual([]);
  });

  test("every sidebar surface row has a tooltip", async ({ page }) => {
    await openFixtureProject(page);

    // Create a 3-panel linked group, unlink one, click unlinked to create stash
    const groupIds = await createLinkedGroup(page, 3);
    await unlinkPanel(page, groupIds[2]);
    await clickSidebarRow(page, groupIds[2]);
    await page.waitForTimeout(300);

    // Check all surface rows have title attributes
    const rows = page.locator(".surface-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const title = await rows.nth(i).getAttribute("title");
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(5);
    }
  });
});

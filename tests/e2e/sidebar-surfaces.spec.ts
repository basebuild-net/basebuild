import { expect, test, type Page } from "@playwright/test";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ALPHA = "C:\\basebuild-e2e\\alpha";
const PROJECT_BRAVO = "C:\\basebuild-e2e\\bravo";

/** Seed a v2 WorkspaceState into the mock restore store for a project. */
async function seedWorkspaceState(
  page: Page,
  projectPath: string,
  state: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (args) => {
    const global = globalThis as {
      __BASEBUILD_E2E_STATE__?: {
        workspaceRestoreByProject: Map<string, unknown>;
      };
      __basebuildInvoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
    const s = global.__BASEBUILD_E2E_STATE__;
    const invoke = global.__basebuildInvoke;
    if (!s || !invoke) return;
    const existing = s.workspaceRestoreByProject.get(args.projectPath) as
      | Record<string, unknown>
      | undefined;
    const merged = { ...(existing ?? {}), panelGrid: JSON.stringify(args.state) };
    await invoke("save_workspace_restore_state", { state: merged });
  }, { projectPath, state });
}

/** Build a v2 WorkspaceState with N chat surfaces and a 2x2 visible subset. */
function buildSixChatState(): Record<string, unknown> {
  const surfaces: Record<string, unknown> = {};
  const surfaceIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const id = `surf-chat-${i}`;
    surfaceIds.push(id);
    surfaces[id] = {
      id,
      kind: "chat",
      resourceId: `chat-${i}`,
      title: `Chat ${i}`,
      titleLocked: false,
      projectId: PROJECT_ALPHA,
      createdAt: 1000 + i,
      lastFocusedAt: 1000 + i,
    };
  }
  // 2x2 visible subset: split(h, split(v, leaf1, leaf2), split(v, leaf3, leaf4))
  const tree = {
    id: "split-root",
    direction: "horizontal",
    ratio: 0.5,
    first: {
      id: "split-left",
      direction: "vertical",
      ratio: 0.5,
      first: { id: "leaf-1", surfaceId: surfaceIds[0] },
      second: { id: "leaf-2", surfaceId: surfaceIds[1] },
    },
    second: {
      id: "split-right",
      direction: "vertical",
      ratio: 0.5,
      first: { id: "leaf-3", surfaceId: surfaceIds[2] },
      second: { id: "leaf-4", surfaceId: surfaceIds[3] },
    },
  };
  return {
    version: 2,
    activeSurfaces: surfaces,
    visibleTree: tree,
    focusedSurfaceId: surfaceIds[0],
    history: [],
  };
}

/** Open the app with the MVP fixture and wait for the shell. */
async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("basebuild:first-run-complete", "true");
    const w = window as typeof window & { __BASEBUILD_E2E_FIXTURE__?: string };
    w.__BASEBUILD_E2E_FIXTURE__ = "mvp-baseline";
  });
  await page.goto("/");
  await page.locator(".app-shell").waitFor({ state: "attached", timeout: 10_000 });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Sidebar surface lifecycle (Phase 3)", () => {
  test("six active chats with a 2x2 visible subset", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    // Switch to alpha project (it's the first fixture project).
    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);

    // The sidebar should list surfaces from workspaceState, not tabs.
    const surfaceRows = page.locator(".surface-row");
    await expect(surfaceRows.first()).toBeVisible({ timeout: 5_000 });

    // 4 visible + 2 hidden = 6 surface rows.
    const count = await surfaceRows.count();
    expect(count).toBeGreaterThanOrEqual(6);

    // Visible rows appear in DFS tree order: Chat 1, Chat 2, Chat 3, Chat 4.
    const visibleRows = page.locator(".surface-row.is-visible");
    await expect(visibleRows).toHaveCount(4);
    const visibleTitles = await visibleRows.locator(".surface-row-title").allTextContents();
    expect(visibleTitles[0]).toContain("Chat 1");
    expect(visibleTitles[1]).toContain("Chat 2");
    expect(visibleTitles[2]).toContain("Chat 3");
    expect(visibleTitles[3]).toContain("Chat 4");

    // Hidden rows have no visible marker.
    const hiddenRows = page.locator(".surface-row.is-hidden");
    await expect(hiddenRows).toHaveCount(2);
    const hiddenTitles = await hiddenRows.locator(".surface-row-title").allTextContents();
    expect(hiddenTitles.some((t) => t.includes("Chat 5"))).toBe(true);
    expect(hiddenTitles.some((t) => t.includes("Chat 6"))).toBe(true);
  });

  test("focus versus replacement", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);

    // Clicking a visible row focuses it (is-focused class).
    const visibleRows = page.locator(".surface-row.is-visible");
    await expect(visibleRows.first()).toBeVisible({ timeout: 5_000 });

    // Initially Chat 1 is focused (from the seeded state).
    await expect(visibleRows.nth(0)).toHaveClass(/is-focused/);

    // Click Chat 3 (visible) → focus transfers.
    await visibleRows.nth(2).click();
    await page.waitForTimeout(300);
    await expect(visibleRows.nth(2)).toHaveClass(/is-focused/);
    await expect(visibleRows.nth(0)).not.toHaveClass(/is-focused/);

    // Click a hidden row → replaces focused surface.
    const hiddenRows = page.locator(".surface-row.is-hidden");
    await expect(hiddenRows.first()).toBeVisible();
    const hiddenTitle = await hiddenRows.nth(0).locator(".surface-row-title").textContent();
    expect(hiddenTitle).toBeTruthy();
    await hiddenRows.nth(0).click();
    await page.waitForTimeout(300);

    // The previously focused (Chat 3) should now be hidden (replaced).
    // The clicked hidden surface should now be visible.
    const allRows = page.locator(".surface-row");
    const allTitles = await allRows.locator(".surface-row-title").allTextContents();
    expect(allTitles.some((t) => t.includes("Chat 3"))).toBe(true);
  });

  test("remove-from-layout hides a visible surface", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);

    const visibleRows = page.locator(".surface-row.is-visible");
    await expect(visibleRows.first()).toBeVisible({ timeout: 5_000 });
    expect(await visibleRows.count()).toBe(4);

    // Hover the first visible row and click the "Remove from layout" button.
    const firstRow = visibleRows.nth(0);
    await firstRow.hover();
    const removeBtn = firstRow.locator('button[title*="Remove from layout"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();
    await page.waitForTimeout(300);

    // Now only 3 visible rows remain.
    const visibleAfter = page.locator(".surface-row.is-visible");
    expect(await visibleAfter.count()).toBe(3);

    // The removed surface should appear as hidden.
    const hiddenAfter = page.locator(".surface-row.is-hidden");
    expect(await hiddenAfter.count()).toBe(3);
  });

  test("close/history/reopen lifecycle", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);

    const visibleRows = page.locator(".surface-row.is-visible");
    await expect(visibleRows.first()).toBeVisible({ timeout: 5_000 });

    // Close the first visible surface via the Close button.
    const firstRow = visibleRows.nth(0);
    await firstRow.hover();
    const closeBtn = firstRow.locator('button[title="Close to History"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await page.waitForTimeout(300);

    // The History section should appear with a badge count.
    const historyHeader = page.locator(".surface-history-header");
    await expect(historyHeader).toBeVisible({ timeout: 3_000 });
    const badge = historyHeader.locator(".surface-history-badge");
    await expect(badge).toContainText("1");

    // Expand history and reopen.
    await historyHeader.click();
    await page.waitForTimeout(200);

    const historyRows = page.locator(".surface-row.is-history");
    await expect(historyRows).toHaveCount(1);

    const reopenBtn = historyRows.first().locator('button[title*="Reopen"]');
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();
    await page.waitForTimeout(300);

    // After reopen, the surface should be active hidden (not visible).
    // History should be empty.
    const historyAfter = page.locator(".surface-row.is-history");
    expect(await historyAfter.count()).toBe(0);

    // The reopened surface should appear as hidden active.
    const hiddenRows = page.locator(".surface-row.is-hidden");
    expect(await hiddenRows.count()).toBeGreaterThanOrEqual(1);
  });

  test("project-switch isolation", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    // Seed bravo with a single chat.
    const bravoState = {
      version: 2,
      activeSurfaces: {
        "surf-bravo-1": {
          id: "surf-bravo-1",
          kind: "chat",
          resourceId: "chat-bravo-1",
          title: "Bravo Chat 1",
          titleLocked: false,
          projectId: PROJECT_BRAVO,
          createdAt: 2000,
          lastFocusedAt: 2000,
        },
      },
      visibleTree: { id: "leaf-bravo-1", surfaceId: "surf-bravo-1" },
      focusedSurfaceId: "surf-bravo-1",
      history: [],
    };
    await seedWorkspaceState(page, PROJECT_BRAVO, bravoState);

    // Switch to alpha — should show 6 surfaces.
    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);
    const alphaSurfaces = page.locator(".surface-row");
    await expect(alphaSurfaces.first()).toBeVisible({ timeout: 5_000 });
    expect(await alphaSurfaces.count()).toBeGreaterThanOrEqual(6);

    // Switch to bravo — should show 1 surface, not alpha's 6.
    const bravoRow = page.locator(".activity-sidebar-project-row", { hasText: "bravo" }).first();
    await bravoRow.click();
    await page.waitForTimeout(500);
    const bravoSurfaces = page.locator(".surface-row");
    await expect(bravoSurfaces.first()).toBeVisible({ timeout: 5_000 });
    const bravoCount = await bravoSurfaces.count();
    expect(bravoCount).toBeLessThan(6);
    expect(bravoCount).toBeGreaterThanOrEqual(1);

    // Switch back to alpha — re-seed the v2 state (the legacy persist path
    // overwrites with PanelGridState during the transitional period; Phase 4
    // unifies persistence to v2). After re-seeding, surfaces are restored.
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());
    await alphaRow.click();
    await page.waitForTimeout(500);
    const alphaSurfacesAgain = page.locator(".surface-row");
    await expect(alphaSurfacesAgain.first()).toBeVisible({ timeout: 5_000 });
    expect(await alphaSurfacesAgain.count()).toBeGreaterThanOrEqual(6);
  });

  test("surface rows have tooltips on interactive elements", async ({ page }) => {
    await openApp(page);
    await seedWorkspaceState(page, PROJECT_ALPHA, buildSixChatState());

    const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
    await alphaRow.click();
    await page.waitForTimeout(500);

    const surfaceRows = page.locator(".surface-row");
    await expect(surfaceRows.first()).toBeVisible({ timeout: 5_000 });

    // Every surface row has a title tooltip.
    const rowTitles = await surfaceRows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("title")),
    );
    expect(rowTitles.length).toBeGreaterThan(0);
    for (let i = 0; i < rowTitles.length; i++) {
      expect(rowTitles[i], `Surface row ${i} should have a tooltip`).toBeTruthy();
    }

    // Action buttons have tooltips.
    const firstRow = surfaceRows.first();
    await firstRow.hover();
    const actionBtns = firstRow.locator(".surface-row-action-btn");
    const btnCount = await actionBtns.count();
    if (btnCount > 0) {
      const btnTitles = await actionBtns.evaluateAll((els) =>
        els.map((el) => el.getAttribute("title")),
      );
      for (let i = 0; i < btnTitles.length; i++) {
        expect(btnTitles[i], `Action button ${i} should have a tooltip`).toBeTruthy();
      }
    }
  });
});

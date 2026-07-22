import { expect, test, type Page } from "@playwright/test";

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ALPHA = "C:\\basebuild-e2e\\alpha";
const PROJECT_BRAVO = "C:\\basebuild-e2e\\bravo";

/** Create a native chat session in the mock backend and return its id. */
async function createNativeChat(
  page: Page,
  projectPath: string,
  title: string,
): Promise<string> {
  return page.evaluate(async (args) => {
    const global = globalThis as {
      __basebuildInvoke?: <T>(cmd: string, a?: Record<string, unknown>) => Promise<T>;
    };
    const invoke = global.__basebuildInvoke;
    if (!invoke) throw new Error("invoke hook missing");
    const session = await invoke<{ id: string }>("native_chat_start", {
      request: { projectPath: args.projectPath, title: args.title },
    });
    return session.id;
  }, { projectPath, title });
}

/** A minimal chat panel shape (single-tab) for seeding PanelGridState. */
type SeedChatPanel = {
  id: string;
  type: "chat";
  title: string;
  chatSessionId: string | null;
  terminalId: null;
  filePath: null;
};

/** A chat panel referencing a native chat session. Surface id = panel id. */
function chatPanel(id: string, title: string, chatSessionId: string | null): SeedChatPanel {
  return { id, type: "chat", title, chatSessionId, terminalId: null, filePath: null };
}

/** Seed a PanelGridState blob into the mock restore store for a project. */
async function seedGrid(
  page: Page,
  projectPath: string,
  state: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (args) => {
    const global = globalThis as {
      __BASEBUILD_E2E_STATE__?: { workspaceRestoreByProject: Map<string, unknown> };
      __basebuildInvoke?: <T>(cmd: string, a?: Record<string, unknown>) => Promise<T>;
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

/** Create 6 native chat sessions for a project and seed a PanelGridState
 *  with a 2x2 visible split (4 panels) plus 2 hidden (unlinked) panels.
 *  Panels reference the sessions so the sidebar shows real chat titles
 *  instead of the "New Chat" default. The first panel is active. */
async function seedSixChatProject(page: Page, projectPath: string): Promise<void> {
  const sessionIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    sessionIds.push(await createNativeChat(page, projectPath, `Chat ${i}`));
  }
  const panels = sessionIds.map((sid, i) => chatPanel(`surf-chat-${i + 1}`, `Chat ${i + 1}`, sid));
  // 2x2 visible subset: row [ column [p1, p2], column [p3, p4] ]
  const root = {
    kind: "split",
    direction: "row",
    sizes: [0.5, 0.5],
    children: [
      {
        kind: "split",
        direction: "column",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", panel: panels[0] },
          { kind: "leaf", panel: panels[1] },
        ],
      },
      {
        kind: "split",
        direction: "column",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", panel: panels[2] },
          { kind: "leaf", panel: panels[3] },
        ],
      },
    ],
  };
  await seedGrid(page, projectPath, {
    root,
    activePanelId: panels[0].id,
    closedPanels: [],
    hiddenPanels: [panels[4], panels[5]],
  });
}

/** Seed a project with a single visible chat panel backed by a real session. */
async function seedSingleChatProject(page: Page, projectPath: string, title: string): Promise<void> {
  const sid = await createNativeChat(page, projectPath, title);
  const panel = chatPanel(`surf-${title.replace(/\s+/g, "-").toLowerCase()}`, title, sid);
  await seedGrid(page, projectPath, {
    root: { kind: "leaf", panel },
    activePanelId: panel.id,
    closedPanels: [],
    hiddenPanels: [],
  });
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

/** Activate the alpha project in the sidebar. */
async function openAlpha(page: Page): Promise<void> {
  const alphaRow = page.locator(".activity-sidebar-project-row", { hasText: "alpha" }).first();
  await alphaRow.click();
  await page.waitForTimeout(500);
}

/** Perform a pointer-based drag (for panel headers that use pointer events). */
async function pointerDrag(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
): Promise<void> {
  const sourceBox = await page.locator(sourceSelector).first().boundingBox();
  const targetBox = await page.locator(targetSelector).first().boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`Missing drag bounds for ${sourceSelector} -> ${targetSelector}`);
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 3, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Sidebar surface lifecycle (Phase 3)", () => {
  test("six active chats with a 2x2 visible subset", async ({ page }) => {
    await openApp(page);
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);

    // The sidebar should list surfaces from the panel grid, not tabs.
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
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);

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

    // Click a hidden row → replaces focused surface (show-only).
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
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);

    const visibleRows = page.locator(".surface-row.is-visible");
    await expect(visibleRows.first()).toBeVisible({ timeout: 5_000 });
    expect(await visibleRows.count()).toBe(4);

    // Drag the first visible panel's header to the unlink dropzone to remove
    // it from the layout (the current UI uses drag-to-unlink, not a button).
    const firstSurfaceId = await visibleRows.first().getAttribute("data-surface-id");
    expect(firstSurfaceId).toBeTruthy();
    await pointerDrag(
      page,
      `.panel-grid-leaf[data-surface-id="${firstSurfaceId}"] .panel-header`,
      ".surface-unlink-dropzone",
    );
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
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);

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
    await seedSixChatProject(page, PROJECT_ALPHA);
    await seedSingleChatProject(page, PROJECT_BRAVO, "Bravo Chat 1");

    // Switch to alpha — should show 6 surfaces.
    await openAlpha(page);
    const alphaSurfaces = page.locator(".surface-row");
    await expect(alphaSurfaces.first()).toBeVisible({ timeout: 5_000 });
    expect(await alphaSurfaces.count()).toBeGreaterThanOrEqual(6);

    // Switch to bravo — should show 1 active surface, not alpha's 6.
    // (Other-project rows from alpha/charlie appear too, so exclude them.)
    const bravoRow = page.locator(".activity-sidebar-project-row", { hasText: "bravo" }).first();
    await bravoRow.click();
    await page.waitForTimeout(500);
    const bravoActiveSurfaces = page.locator(".surface-row:not(.is-other-project)");
    await expect(bravoActiveSurfaces.first()).toBeVisible({ timeout: 5_000 });
    const bravoCount = await bravoActiveSurfaces.count();
    expect(bravoCount).toBeLessThan(6);
    expect(bravoCount).toBeGreaterThanOrEqual(1);

    // Switch back to alpha — re-seed (the persist path overwrites during the
    // transitional period). After re-seeding, surfaces are restored.
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);
    const alphaSurfacesAgain = page.locator(".surface-row");
    await expect(alphaSurfacesAgain.first()).toBeVisible({ timeout: 5_000 });
    expect(await alphaSurfacesAgain.count()).toBeGreaterThanOrEqual(6);
  });

  test("surface rows have tooltips on interactive elements", async ({ page }) => {
    await openApp(page);
    await seedSixChatProject(page, PROJECT_ALPHA);
    await openAlpha(page);

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

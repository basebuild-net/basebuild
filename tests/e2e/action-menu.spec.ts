import { expect, test, type Page } from "@playwright/test";
import { openMvpFixtureProject, waitForAppReady, openPlanningModal } from "./helpers";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Open the portaled ActionMenu for a plan card in the full planning modal. */
async function openPlanCardMenu(page: Page, planTitle: string): Promise<void> {
  const card = page.locator(".plan-card", { hasText: planTitle }).first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  await card.getByTitle("More plan actions").click();
}

/** Open the portaled ActionMenu for an idea card in the Ideas tab. */
async function openIdeaCardMenu(page: Page, ideaTitle: string): Promise<void> {
  const card = page.locator(".chat-idea-card", { hasText: ideaTitle }).first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  await card.getByTitle("More idea actions").click();
}

/** The portaled menu lives at document.body, not inside any dropdown/modal. */
function portalMenu(page: Page) {
  return page.locator(".context-menu-portal");
}

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe("ActionMenu: portal positioning and dismissal", () => {
  test("menu portals to document.body, not inside the hosting container", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    // Plans tab has fixture plans with `…` menus.
    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");

    const menu = portalMenu(page);
    await expect(menu).toBeVisible();
    // The portal is a direct child of document.body, not nested in the modal.
    const parentTag = await menu.evaluate((el) => el.parentElement?.tagName ?? "");
    expect(parentTag).toBe("BODY");
  });

  test("menu is position:fixed so overflow:hidden panels cannot clip it", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");

    const menu = portalMenu(page);
    const position = await menu.evaluate((el) => window.getComputedStyle(el).position);
    expect(position).toBe("fixed");
  });

  test("Escape closes the menu but leaves the hosting modal open", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");
    const menu = portalMenu(page);
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // The planning modal must survive — Escape only dismisses the menu.
    await expect(page.locator(".planning-inspector")).toBeVisible();
  });

  test("outside click closes the menu but leaves the hosting modal open", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");
    const menu = portalMenu(page);
    await expect(menu).toBeVisible();

    // Click on the side-section header area (outside the menu, inside the modal).
    await page.locator(".side-section-header").first().click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".planning-inspector")).toBeVisible();
  });

  test("trigger button is always visible without hover (no opacity:0 gate)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    const trigger = page
      .locator(".plan-card", { hasText: "Atomic activation" })
      .first()
      .getByTitle("More plan actions");
    await expect(trigger).toBeVisible();
    // The trigger must be at full opacity without hovering first.
    const opacity = await trigger.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });
});

test.describe("ActionMenu: plan card menu items", () => {
  test("plan card menu offers Edit, Copy reference, and Delete", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");
    const menu = portalMenu(page);

    await expect(menu.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy reference" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("Copy reference copies the plan reference id to the clipboard", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    await openPlanCardMenu(page, "Atomic activation");
    const menu = portalMenu(page);

    // Grant clipboard permissions and click Copy reference.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await menu.getByRole("menuitem", { name: "Copy reference" }).click();
    // Menu should close after a non-keepOpen action.
    await expect(menu).toHaveCount(0);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("MVP-001");
  });

  test("Delete removes the plan card immediately (one-step in the full modal)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();
    const card = page.locator(".plan-card", { hasText: "Clamp shell popovers" }).first();
    await expect(card).toBeVisible();
    await card.getByTitle("More plan actions").click();
    const menu = portalMenu(page);

    // Plan card delete is one-step (the dropdown row delete is two-step).
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(menu).toHaveCount(0);
    await expect(card).toHaveCount(0);
  });
});

test.describe("ActionMenu: idea card menu items", () => {
  test("idea card menu offers Pass, Defer, and Delete for concept ideas", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Ideas" }).first().click();
    // "Viewport-safe popovers" is a concept-status idea in the fixture.
    await openIdeaCardMenu(page, "Viewport-safe popovers");
    const menu = portalMenu(page);

    await expect(menu.getByRole("menuitem", { name: "Pass" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Defer" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("Pass rejects the idea (it leaves the active concept list)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Ideas" }).first().click();
    const card = page.locator(".chat-idea-card", { hasText: "Viewport-safe popovers" }).first();
    await expect(card).toBeVisible();
    await card.getByTitle("More idea actions").click();
    const menu = portalMenu(page);

    await menu.getByRole("menuitem", { name: "Pass" }).click();
    // Rejected ideas leave the active concept list (they appear in history).
    await expect(card).toHaveCount(0);
  });

  test("Defer archives the idea (it leaves the active list)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Ideas" }).first().click();
    const card = page.locator(".chat-idea-card", { hasText: "Shared run board" }).first();
    await expect(card).toBeVisible();
    await card.getByTitle("More idea actions").click();
    const menu = portalMenu(page);

    await menu.getByRole("menuitem", { name: "Defer" }).click();
    // The deferred idea should no longer appear in the active ideas list.
    await expect(card).toHaveCount(0);
  });

  test("idea Delete removes the idea immediately (one-step in the full modal)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Ideas" }).first().click();
    const card = page.locator(".chat-idea-card", { hasText: "Shared run board" }).first();
    await expect(card).toBeVisible();
    await card.getByTitle("More idea actions").click();
    const menu = portalMenu(page);

    // Idea card delete is one-step (the dropdown row delete is two-step).
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(card).toHaveCount(0);
  });
});

test.describe("ActionMenu: dropdown row menu (small popup)", () => {
  test("plans dropdown row menu portals outside the 340px dropdown panel", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    // Open the plans indicator dropdown (a small 340px popup).
    await page.locator('.planning-indicator[data-stage="plans"]').first().click();
    const dropdown = page.locator('.planning-notification-dropdown[data-stage="plans"]');
    await expect(dropdown).toBeVisible();
    const row = dropdown.locator(".planning-dropdown-row").first();
    await expect(row.locator(".planning-notification-item-title")).toBeVisible();

    const rowTitle = (await row.locator(".planning-notification-item-title").textContent()) ?? "";
    await row.getByTitle(`More actions for ${rowTitle}`).click();
    const menu = portalMenu(page);
    await expect(menu).toBeVisible();

    // The menu is NOT a descendant of the dropdown — it portals to body.
    const isInsideDropdown = await menu.evaluate((el, dropdownSel) => {
      const dd = document.querySelector(dropdownSel);
      return dd ? dd.contains(el) : false;
    }, '.planning-notification-dropdown[data-stage="plans"]');
    expect(isInsideDropdown).toBe(false);

    // The menu must be wider than zero and positioned within the viewport.
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  test("ideas dropdown row menu: Upgrade to plan promotes the idea", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await page.locator(".planning-indicator[data-stage='ideas']").click();
    const dropdown = page.locator(".planning-notification-dropdown[data-stage='ideas']");
    await expect(dropdown).toBeVisible();

    // Create a fresh idea to promote.
    await dropdown.getByRole("button", { name: "New idea" }).click();
    await dropdown.getByTitle("Create idea title").fill("Portal menu promotion idea");
    await dropdown.getByTitle("Create idea description").fill("Promote via the portaled menu.");
    await dropdown.getByRole("button", { name: "Create", exact: true }).click();
    // Target the newly created idea specifically (not the fixture ideas).
    const newRow = dropdown.locator(".planning-dropdown-row", { hasText: "Portal menu promotion idea" });
    await expect(newRow.locator(".planning-notification-item-title")).toHaveText("Portal menu promotion idea");

    await newRow.getByTitle("More actions for Portal menu promotion idea").click();
    const menu = portalMenu(page);
    await menu.getByRole("menuitem", { name: "Upgrade to plan" }).click();

    // The newly promoted idea should have status "picked" (Planned).
    await expect(dropdown.locator(".planning-quick-idea", { hasText: "Portal menu promotion idea" })).toHaveAttribute("data-status", "picked");
    await expect(page.locator(".planning-indicator[data-stage='plans']")).toHaveAttribute("title", /Plans: \d/);
  });

  test("only one menu is open at a time (Escape closes, then another opens)", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);

    await page.locator('.planning-indicator[data-stage="plans"]').first().click();
    const dropdown = page.locator('.planning-notification-dropdown[data-stage="plans"]');
    await expect(dropdown).toBeVisible();
    const rows = dropdown.locator(".planning-dropdown-row");
    const firstTitle = (await rows.nth(0).locator(".planning-notification-item-title").textContent()) ?? "";
    const secondTitle = (await rows.nth(1).locator(".planning-notification-item-title").textContent()) ?? "";

    // Open the first row's menu.
    await rows.nth(0).getByTitle(`More actions for ${firstTitle}`).click();
    await expect(portalMenu(page)).toHaveCount(1);

    // Escape closes the menu — standard behavior when a menu covers other rows.
    await page.keyboard.press("Escape");
    await expect(portalMenu(page)).toHaveCount(0);

    // Now the second row's trigger is accessible.
    await rows.nth(1).getByTitle(`More actions for ${secondTitle}`).click();
    const menus = portalMenu(page);
    await expect(menus).toHaveCount(1);
    // The surviving menu should reference the second plan (Copy plan id is present).
    await expect(menus.getByRole("menuitem", { name: "Copy plan id" })).toBeVisible();
  });
});

test.describe("ActionMenu: viewport clamping", () => {
  test("menu clamps within the viewport when trigger is near the right edge", async ({ page }) => {
    await openMvpFixtureProject(page);
    await waitForAppReady(page);
    await openPlanningModal(page);

    await page.locator(".inspector-tab", { hasText: "Plans" }).first().click();

    // Narrow the viewport so the rightmost plan card's `…` button is near the edge.
    await page.setViewportSize({ width: 640, height: 480 });

    // The last plan card's menu trigger should still produce a fully visible menu.
    const cards = page.locator(".plan-card");
    const lastCard = cards.last();
    await lastCard.getByTitle("More plan actions").click();
    const menu = portalMenu(page);
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(640);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  });
});

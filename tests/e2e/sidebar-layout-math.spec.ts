import { expect, test } from "@playwright/test";
import { buildSidebarUnits } from "../../src/lib/sidebarLayout";
import type { LeafNode, SurfaceRecord, TreeNode, WorkspaceState } from "../../src/lib/workspaceState";

// ── Helpers ────────────────────────────────────────────────────────────────

function surf(id: string, createdAt: number, lastFocusedAt: number): SurfaceRecord {
  return {
    id,
    kind: "chat",
    resourceId: `r-${id}`,
    title: id,
    titleLocked: false,
    projectId: "p",
    createdAt,
    lastFocusedAt,
  };
}

function leaf(surfaceId: string): LeafNode {
  return { id: `leaf-${surfaceId}`, surfaceId };
}

function split(first: TreeNode, second: TreeNode): TreeNode {
  return { id: `split-${Math.random()}`, direction: "horizontal", ratio: 0.5, first, second };
}

function ws(partial: Partial<WorkspaceState>): WorkspaceState {
  return {
    version: 2,
    activeSurfaces: {},
    visibleTree: null,
    focusedSurfaceId: null,
    history: [],
    ...partial,
  };
}

function idsOf(unit: { surfaces: SurfaceRecord[] }): string[] {
  return unit.surfaces.map((s) => s.id);
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("buildSidebarUnits", () => {
  test("keeps groups contiguous, orders units by recency, members in tree order", () => {
    const a = surf("a", 1, 10);
    const b = surf("b", 2, 30);
    const c = surf("c", 3, 20);
    const d = surf("d", 4, 5);
    const state = ws({
      activeSurfaces: { a, b, c, d },
      visibleTree: split(leaf("a"), leaf("b")),
      stashedGroups: [split(leaf("c"), leaf("d"))],
      focusedSurfaceId: "b",
    });

    const units = buildSidebarUnits(state);

    expect(units).toHaveLength(2);
    // Visible group first (recency 30 > 20); members keep split-tree order.
    expect(units[0].isVisible).toBe(true);
    expect(units[0].kind).toBe("group");
    expect(idsOf(units[0])).toEqual(["a", "b"]);
    // Stashed group second; members keep split-tree order.
    expect(units[1].isVisible).toBe(false);
    expect(idsOf(units[1])).toEqual(["c", "d"]);
  });

  test("interleaves hidden solos with groups by recency", () => {
    const a = surf("a", 1, 50);
    const b = surf("b", 2, 60); // visible focused, most recent
    const f = surf("f", 3, 40);
    const g = surf("g", 4, 45);
    const state = ws({
      activeSurfaces: { a, b, f, g },
      visibleTree: split(leaf("a"), leaf("b")),
      focusedSurfaceId: "b",
    });

    const units = buildSidebarUnits(state);

    expect(units.map((u) => idsOf(u))).toEqual([["a", "b"], ["g"], ["f"]]);
    expect(units[0].isVisible).toBe(true);
    expect(units[1].kind).toBe("solo");
    expect(units[2].kind).toBe("solo");
  });

  test("group colour is stable by creation order, independent of recency", () => {
    // group1 (a,b) created earliest but least recent; group2 (c,d) visible + recent.
    const a = surf("a", 1, 5);
    const b = surf("b", 2, 6);
    const c = surf("c", 3, 100);
    const d = surf("d", 4, 90);
    const state = ws({
      activeSurfaces: { a, b, c, d },
      visibleTree: split(leaf("c"), leaf("d")),
      stashedGroups: [split(leaf("a"), leaf("b"))],
      focusedSurfaceId: "c",
    });

    const units = buildSidebarUnits(state);

    // Display order is recency: visible group2 first, stashed group1 second.
    expect(units[0].isVisible).toBe(true);
    expect(idsOf(units[0])).toEqual(["c", "d"]);
    // …but colour index follows creation order: group1=0, group2=1.
    expect(units[0].colorIndex).toBe(1);
    expect(units[1].colorIndex).toBe(0);
  });

  test("a stashed group decayed to one live surface renders as a solo", () => {
    const a = surf("a", 1, 10);
    const b = surf("b", 2, 20);
    const state = ws({
      activeSurfaces: { a, b },
      visibleTree: leaf("a"),
      // group tree referencing only b (its partner was closed).
      stashedGroups: [leaf("b")],
      focusedSurfaceId: "a",
    });

    const units = buildSidebarUnits(state);

    const bUnit = units.find((u) => idsOf(u).includes("b"));
    expect(bUnit?.kind).toBe("solo");
    expect(bUnit?.colorIndex).toBe(-1);
    expect(units.every((u) => u.kind !== "group")).toBe(true);
  });

  test("drops dangling leaves whose surface is missing", () => {
    const a = surf("a", 1, 10);
    const state = ws({
      activeSurfaces: { a },
      visibleTree: split(leaf("a"), leaf("ghost")),
      focusedSurfaceId: "a",
    });

    const units = buildSidebarUnits(state);

    expect(units).toHaveLength(1);
    expect(idsOf(units[0])).toEqual(["a"]);
    expect(units[0].kind).toBe("solo"); // only one live leaf remains
  });

  test("returns no units for an empty workspace", () => {
    expect(buildSidebarUnits(ws({}))).toEqual([]);
  });
});

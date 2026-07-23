import { expect, test } from "@playwright/test";
import {
  createSurface,
  emptyWorkspaceState,
  focusSurface,
  removeSurfaceFromLayout,
  splitFocusedSurface,
  type SurfaceKind,
  type WorkspaceState,
} from "../../src/lib/workspaceState";
import {
  MIN_WIDTH_CHAT,
  MIN_WIDTH_TERMINAL,
  MIN_HEIGHT_SURFACE,
  surfaceMinWidth,
  surfaceMinHeight,
  computeLeafSizes,
  canSplit,
  allLeavesFit,
  applyCapacityHiding,
  clampRatioToPixelMinimum,
} from "../../src/lib/layoutCapacity";

const PROJECT = "C:/projects/demo";

/** Create a surface and optionally place it in the tree by splitting the
 *  currently focused leaf. Returns the updated state and the new surface id. */
function addSurface(
  state: WorkspaceState,
  kind: SurfaceKind,
  direction?: "horizontal" | "vertical",
  title?: string,
): { state: WorkspaceState; surfaceId: string } {
  const { state: s1, surfaceId } = createSurface(state, {
    kind,
    resourceId: `resource-${Math.random().toString(36).slice(2, 8)}`,
    title: title ?? kind,
    projectId: PROJECT,
  });
  if (direction) {
    return { state: splitFocusedSurface(s1, surfaceId, direction), surfaceId };
  }
  // No direction: if the tree is empty, place as root via split.
  if (!s1.visibleTree) {
    return { state: splitFocusedSurface(s1, surfaceId, "horizontal"), surfaceId };
  }
  return { state: s1, surfaceId };
}

/** Build a state with N chat surfaces, each placed via sequential horizontal splits. */
function makeChatState(n: number): { state: WorkspaceState; ids: string[] } {
  let state = emptyWorkspaceState(PROJECT);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const result = addSurface(state, "chat", i === 0 ? undefined : "horizontal");
    state = result.state;
    ids.push(result.surfaceId);
  }
  return { state, ids };
}

// ── Capacity tokens ──────────────────────────────────────────────────────────

test("surfaceMinWidth: chat and omp-chat share the same minimum, terminal has its own", () => {
  expect(surfaceMinWidth("chat")).toBe(MIN_WIDTH_CHAT);
  expect(surfaceMinWidth("omp-chat")).toBe(MIN_WIDTH_CHAT);
  expect(surfaceMinWidth("terminal")).toBe(MIN_WIDTH_TERMINAL);
  expect(MIN_WIDTH_CHAT).toBe(24);
  expect(MIN_WIDTH_TERMINAL).toBe(24);
});

test("surfaceMinHeight: all kinds share the same minimum height", () => {
  for (const kind of ["chat", "omp-chat", "terminal"] as SurfaceKind[]) {
    expect(surfaceMinHeight(kind)).toBe(MIN_HEIGHT_SURFACE);
  }
  expect(MIN_HEIGHT_SURFACE).toBe(24);
});


// ── computeLeafSizes: empty / one / two / 2×2 / deep ─────────────────────────

test("computeLeafSizes: empty tree returns empty map", () => {
  const state = emptyWorkspaceState(PROJECT);
  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(0);
});

test("computeLeafSizes: single leaf gets full container", () => {
  const { state } = makeChatState(1);
  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(1);
  for (const sz of sizes.values()) {
    expect(sz).toEqual({ width: 1000, height: 800 });
  }
});

test("computeLeafSizes: horizontal split divides width by ratio", () => {
  const { state } = makeChatState(2);
  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(2);
  for (const sz of sizes.values()) {
    expect(sz.width).toBeCloseTo(500, 1);
    expect(sz.height).toBe(800);
  }
});

test("computeLeafSizes: vertical split divides height by ratio", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "vertical");
  state = r2.state;
  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(2);
  for (const sz of sizes.values()) {
    expect(sz.width).toBe(1000);
    expect(sz.height).toBeCloseTo(400, 1);
  }
});

test("computeLeafSizes: 2×2 grid (split then split child vertically)", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  // Focus the second surface and split it vertically
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "vertical");
  state = r3.state;

  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(3);
  // First surface: 500×800
  expect(sizes.get(r1.surfaceId)!.width).toBeCloseTo(500, 1);
  expect(sizes.get(r1.surfaceId)!.height).toBe(800);
  // Second surface: 500×400
  expect(sizes.get(r2.surfaceId)!.width).toBeCloseTo(500, 1);
  expect(sizes.get(r2.surfaceId)!.height).toBeCloseTo(400, 1);
  // Third surface: 500×400
  expect(sizes.get(r3.surfaceId)!.width).toBeCloseTo(500, 1);
  expect(sizes.get(r3.surfaceId)!.height).toBeCloseTo(400, 1);
});

test("computeLeafSizes: deep nested tree (3 levels)", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "vertical");
  state = r3.state;
  state = focusSurface(state, r3.surfaceId);
  const r4 = addSurface(state, "chat", "horizontal");
  state = r4.state;

  const sizes = computeLeafSizes(state.visibleTree, 1000, 800);
  expect(sizes.size).toBe(4);
  // r1: 500×800
  expect(sizes.get(r1.surfaceId)!.width).toBeCloseTo(500, 1);
  expect(sizes.get(r1.surfaceId)!.height).toBe(800);
  // r2: 500×400
  expect(sizes.get(r2.surfaceId)!.width).toBeCloseTo(500, 1);
  expect(sizes.get(r2.surfaceId)!.height).toBeCloseTo(400, 1);
  // r3: 250×400
  expect(sizes.get(r3.surfaceId)!.width).toBeCloseTo(250, 1);
  expect(sizes.get(r3.surfaceId)!.height).toBeCloseTo(400, 1);
  // r4: 250×400
  expect(sizes.get(r4.surfaceId)!.width).toBeCloseTo(250, 1);
  expect(sizes.get(r4.surfaceId)!.height).toBeCloseTo(400, 1);
});

// ── canSplit: capacity rejection ─────────────────────────────────────────────

test("canSplit: empty tree allows split", () => {
  const state = emptyWorkspaceState(PROJECT);
  const result = canSplit(state, "horizontal", "chat", 1000, 800);
  expect(result.ok).toBe(true);
});

test("canSplit: always allows horizontal split regardless of width", () => {
  const { state } = makeChatState(1);
  // canSplit is a no-op stub — arbitrary grid densities are allowed.
  const result = canSplit(state, "horizontal", "chat", 40, 800);
  expect(result.ok).toBe(true);
});

test("canSplit: allows horizontal split when width is exactly 2× chat minimum", () => {
  const { state } = makeChatState(1);
  // 2× chat minimum = 48px. Give exactly 48px → halfAvailable = 24 = min
  const result = canSplit(state, "horizontal", "chat", 48, 800);
  expect(result.ok).toBe(true);
});

test("canSplit: always allows vertical split regardless of height", () => {
  const { state } = makeChatState(1);
  // canSplit is a no-op stub — arbitrary grid densities are allowed.
  const result = canSplit(state, "vertical", "chat", 1000, 40);
  expect(result.ok).toBe(true);
});

test("canSplit: mixed chat/terminal always allows split", () => {
  const { state } = makeChatState(1);
  // canSplit is a no-op stub — arbitrary grid densities are allowed.
  const result = canSplit(state, "horizontal", "terminal", 40, 800);
  expect(result.ok).toBe(true);
  const result2 = canSplit(state, "horizontal", "terminal", 48, 800);
  expect(result2.ok).toBe(true);
});

test("canSplit: always allows split for terminal regardless of width", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r = addSurface(state, "terminal");
  state = r.state;
  // canSplit is a no-op stub — arbitrary grid densities are allowed.
  const result = canSplit(state, "horizontal", "terminal", 48, 800);
  expect(result.ok).toBe(true);
  const result2 = canSplit(state, "horizontal", "terminal", 40, 800);
  expect(result2.ok).toBe(true);
});

// ── allLeavesFit ─────────────────────────────────────────────────────────────

test("allLeavesFit: true for single leaf that meets minimums", () => {
  const { state } = makeChatState(1);
  expect(allLeavesFit(state, 500, 300)).toBe(true);
});

test("allLeavesFit: false when a leaf is below width minimum", () => {
  const { state } = makeChatState(2);
  // 40px wide, two leaves at 20px each → 20 < 24 (chat min)
  expect(allLeavesFit(state, 40, 300)).toBe(false);
});

test("allLeavesFit: false when a leaf is below height minimum", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "vertical");
  state = r2.state;
  // 40px tall, two leaves at 20px each → 20 < 24 (height min)
  expect(allLeavesFit(state, 1000, 40)).toBe(false);
});

test("allLeavesFit: true when all leaves meet minimums", () => {
  const { state } = makeChatState(2);
  // 1000px wide, two leaves at 500px each → 500 ≥ 24
  expect(allLeavesFit(state, 1000, 300)).toBe(true);
});

// ── applyCapacityHiding: LRU hiding and restoration ──────────────────────────

test("applyCapacityHiding: hides nothing when all leaves fit", () => {
  const { state } = makeChatState(2);
  const result = applyCapacityHiding(state, 1000, 300);
  expect(result.hidden).toEqual([]);
  expect(result.state.visibleTree).not.toBeNull();
});

test("applyCapacityHiding: never hides even when capacity insufficient", () => {
  // applyCapacityHiding is a no-op stub — arbitrary grid densities are
  // allowed and panels simply shrink to fit.
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "horizontal");
  state = r3.state;
  state = focusSurface(state, r3.surfaceId);

  const result = applyCapacityHiding(state, 60, 300);
  expect(result.hidden).toEqual([]);
  expect(result.state.visibleTree).not.toBeNull();
});

test("applyCapacityHiding: never hides the last remaining leaf", () => {
  const { state } = makeChatState(1);
  // Single leaf, tiny container — should not hide
  const result = applyCapacityHiding(state, 100, 100);
  expect(result.hidden).toEqual([]);
  expect(result.state.visibleTree).not.toBeNull();
});

test("applyCapacityHiding: all surfaces remain in activeSurfaces", () => {
  const { state, ids } = makeChatState(2);
  const state2 = focusSurface(state, ids[1]);
  // applyCapacityHiding is a no-op stub — nothing is hidden.
  const result = applyCapacityHiding(state2, 40, 40);
  expect(result.hidden).toEqual([]);
  expect(result.state.activeSurfaces[ids[0]]).toBeDefined();
  expect(result.state.activeSurfaces[ids[1]]).toBeDefined();
});

test("applyCapacityHiding: never hides — state passes through unchanged", () => {
  // applyCapacityHiding is a no-op stub — arbitrary grid densities are
  // allowed and panels simply shrink to fit.
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "horizontal");
  state = r3.state;

  const result = applyCapacityHiding(state, 60, 300);
  expect(result.hidden).toEqual([]);
  expect(result.state).toBe(state);
});

// ── clampRatioToPixelMinimum: splitter limits ────────────────────────────────

test("clampRatioToPixelMinimum: clamps to first child minimum", () => {
  // totalPx=1000, firstMin=400, secondMin=400
  // minRatio = 400/1000 = 0.4, maxRatio = 1 - 400/1000 = 0.6
  // ratio 0.1 → clamped to 0.4
  const result = clampRatioToPixelMinimum(0.1, 400, 400, 1000);
  expect(result).toBeCloseTo(0.4, 5);
});

test("clampRatioToPixelMinimum: clamps to second child minimum", () => {
  // ratio 0.9 → clamped to 0.6
  const result = clampRatioToPixelMinimum(0.9, 400, 400, 1000);
  expect(result).toBeCloseTo(0.6, 5);
});

test("clampRatioToPixelMinimum: passes through valid ratio", () => {
  const result = clampRatioToPixelMinimum(0.5, 400, 400, 1000);
  expect(result).toBeCloseTo(0.5, 5);
});

test("clampRatioToPixelMinimum: handles zero total", () => {
  // totalPx=0 → returns clamped ratio (no division)
  const result = clampRatioToPixelMinimum(0.5, 400, 400, 0);
  expect(result).toBeGreaterThanOrEqual(0.1);
  expect(result).toBeLessThanOrEqual(0.9);
});

test("clampRatioToPixelMinimum: asymmetric minimums", () => {
  // totalPx=1000, firstMin=440 (chat), secondMin=320 (terminal)
  // minRatio = 0.44, maxRatio = 0.68
  const result = clampRatioToPixelMinimum(0.1, 440, 320, 1000);
  expect(result).toBeCloseTo(0.44, 5);
  const result2 = clampRatioToPixelMinimum(0.9, 440, 320, 1000);
  expect(result2).toBeCloseTo(0.68, 5);
});

test("clampRatioToPixelMinimum: impossible minimums clamp to midpoint", () => {
  // totalPx=500, firstMin=400, secondMin=400 → need 800px but only 500
  // minRatio = 0.8, maxRatio = 0.2 → minRatio > maxRatio
  // midpoint = (0.8 + 0.2) / 2 = 0.5
  const result = clampRatioToPixelMinimum(0.3, 400, 400, 500);
  expect(result).toBeCloseTo(0.5, 5);
});

// ── Duplicate prevention ─────────────────────────────────────────────────────

test("splitFocusedSurface: new surface gets a unique id (no duplicate)", () => {
  const { state, ids } = makeChatState(2);
  expect(ids.length).toBe(2);
  expect(new Set(ids).size).toBe(2); // no duplicates
  expect(Object.keys(state.activeSurfaces).length).toBe(2);
});

test("splitFocusedSurface: repeated splits produce all-unique ids", () => {
  const { state, ids } = makeChatState(6);
  expect(new Set(ids).size).toBe(ids.length);
  expect(Object.keys(state.activeSurfaces).length).toBe(6);
});

import { expect, test } from "vitest";
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

test("surfaceMinWidth: chat and omp-chat share 440px, terminal is 320px", () => {
  expect(surfaceMinWidth("chat")).toBe(MIN_WIDTH_CHAT);
  expect(surfaceMinWidth("omp-chat")).toBe(MIN_WIDTH_CHAT);
  expect(surfaceMinWidth("terminal")).toBe(MIN_WIDTH_TERMINAL);
  expect(MIN_WIDTH_CHAT).toBe(440);
  expect(MIN_WIDTH_TERMINAL).toBe(320);
});

test("surfaceMinHeight: all kinds share the same minimum height", () => {
  for (const kind of ["chat", "omp-chat", "terminal"] as SurfaceKind[]) {
    expect(surfaceMinHeight(kind)).toBe(MIN_HEIGHT_SURFACE);
  }
  expect(MIN_HEIGHT_SURFACE).toBe(200);
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

test("canSplit: rejects horizontal split when width is below 2× chat minimum", () => {
  const { state } = makeChatState(1);
  // 2× chat minimum = 880px. Give 800px → halfAvailable = 400 < 440
  const result = canSplit(state, "horizontal", "chat", 800, 800);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("width");
});

test("canSplit: allows horizontal split when width is exactly 2× chat minimum", () => {
  const { state } = makeChatState(1);
  // 2× chat minimum = 880px. Give exactly 880px → halfAvailable = 440 = min
  const result = canSplit(state, "horizontal", "chat", 880, 800);
  expect(result.ok).toBe(true);
});

test("canSplit: rejects vertical split when height is below 2× minimum height", () => {
  const { state } = makeChatState(1);
  // 2× height minimum = 400px. Give 350px → halfAvailable = 175 < 200
  const result = canSplit(state, "vertical", "chat", 1000, 350);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("height");
});

test("canSplit: mixed chat/terminal — terminal has smaller minimum", () => {
  const { state } = makeChatState(1);
  // Splitting chat horizontally with a terminal: need max(440, 320)×2 = 880
  // Give 800 → halfAvailable = 400 ≥ 320 (terminal min) but < 440 (chat min)
  const result = canSplit(state, "horizontal", "terminal", 800, 800);
  expect(result.ok).toBe(false);
  // Give 880 → halfAvailable = 440 ≥ both
  const result2 = canSplit(state, "horizontal", "terminal", 880, 800);
  expect(result2.ok).toBe(true);
});

test("canSplit: allows split when terminal is the existing surface with less width", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r = addSurface(state, "terminal");
  state = r.state;
  // Splitting terminal with terminal: need max(320, 320)×2 = 640
  const result = canSplit(state, "horizontal", "terminal", 640, 800);
  expect(result.ok).toBe(true);
  // 600 → halfAvailable = 300 < 320
  const result2 = canSplit(state, "horizontal", "terminal", 600, 800);
  expect(result2.ok).toBe(false);
});

// ── allLeavesFit ─────────────────────────────────────────────────────────────

test("allLeavesFit: true for single leaf that meets minimums", () => {
  const { state } = makeChatState(1);
  expect(allLeavesFit(state, 500, 300)).toBe(true);
});

test("allLeavesFit: false when a leaf is below width minimum", () => {
  const { state } = makeChatState(2);
  // 800px wide, two leaves at 400px each → 400 < 440 (chat min)
  expect(allLeavesFit(state, 800, 300)).toBe(false);
});

test("allLeavesFit: false when a leaf is below height minimum", () => {
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "vertical");
  state = r2.state;
  // 300px tall, two leaves at 150px each → 150 < 200 (height min)
  expect(allLeavesFit(state, 1000, 300)).toBe(false);
});

test("allLeavesFit: true when all leaves meet minimums", () => {
  const { state } = makeChatState(2);
  // 1000px wide, two leaves at 500px each → 500 ≥ 440
  expect(allLeavesFit(state, 1000, 300)).toBe(true);
});

// ── applyCapacityHiding: LRU hiding and restoration ──────────────────────────

test("applyCapacityHiding: hides nothing when all leaves fit", () => {
  const { state } = makeChatState(2);
  const result = applyCapacityHiding(state, 1000, 300);
  expect(result.hidden).toEqual([]);
  expect(result.state.visibleTree).not.toBeNull();
});

test("applyCapacityHiding: hides LRU non-focused leaf when capacity insufficient", () => {
  // Three chat surfaces: r1 (oldest focus), r2, r3 (focused)
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  // Focus r1 (makes it LRU when we later focus r3)
  state = focusSurface(state, r1.surfaceId);
  // Split r1 horizontally → creates r3 as sibling of r1
  // Actually we need to focus r2 and split to get 3 leaves
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "horizontal");
  state = r3.state;
  // Now focus r3 so it's the most recently focused
  state = focusSurface(state, r3.surfaceId);
  // Focus r1 to set its lastFocusedAt, then focus r3 to make r1 the LRU
  state = focusSurface(state, r1.surfaceId);
  state = focusSurface(state, r3.surfaceId);

  // Small container: 3 chat surfaces need 3×440 = 1320px width minimum
  // Give 800px → not enough, one must be hidden
  const result = applyCapacityHiding(state, 800, 300);
  expect(result.hidden.length).toBeGreaterThan(0);
  // The focused surface (r3) should never be hidden
  expect(result.hidden).not.toContain(r3.surfaceId);
  // The LRU candidate (r1, focused longest ago) should be hidden first
  expect(result.hidden[0]).toBe(r1.surfaceId);
});

test("applyCapacityHiding: never hides the last remaining leaf", () => {
  const { state } = makeChatState(1);
  // Single leaf, tiny container — should not hide
  const result = applyCapacityHiding(state, 100, 100);
  expect(result.hidden).toEqual([]);
  expect(result.state.visibleTree).not.toBeNull();
});

test("applyCapacityHiding: hidden surfaces remain in activeSurfaces", () => {
  const { state, ids } = makeChatState(2);
  // Force the first surface to be LRU by focusing the second
  const state2 = focusSurface(state, ids[1]);
  // Tiny container → first surface gets hidden
  const result = applyCapacityHiding(state2, 100, 100);
  expect(result.hidden).toContain(ids[0]);
  expect(result.state.activeSurfaces[ids[0]]).toBeDefined();
});

test("applyCapacityHiding: restoration — removing a surface lets others refit", () => {
  // Build 3 chat surfaces via horizontal splits
  let state = emptyWorkspaceState(PROJECT);
  const r1 = addSurface(state, "chat");
  state = r1.state;
  const r2 = addSurface(state, "chat", "horizontal");
  state = r2.state;
  state = focusSurface(state, r2.surfaceId);
  const r3 = addSurface(state, "chat", "horizontal");
  state = r3.state;

  // 3 leaves at 1000px → ~333px each, below 440px chat minimum
  expect(allLeavesFit(state, 1000, 300)).toBe(false);

  // Hide one via capacity hiding
  const hidden = applyCapacityHiding(state, 1000, 300);
  expect(hidden.hidden.length).toBe(1);

  // After hiding, the remaining two should fit (500px each ≥ 440)
  expect(allLeavesFit(hidden.state, 1000, 300)).toBe(true);
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

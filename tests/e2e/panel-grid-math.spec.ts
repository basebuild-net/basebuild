import { expect, test } from "@playwright/test";
import {
  MIN_SPLIT_SIZE,
  closePanel,
  deletePanelFromHistory,
  emptyGrid,
  equalizeSplit,
  findPanel,
  findParentSplit,
  flattenPanels,
  getDragAffectedIds,
  insertPanel,
  movePanel,
  newPanelId,
  normalizePanelGridState,
  panelCount,
  parsePanelGrid,
  parsePanelGridWithDiagnostics,
  removePanelFromGrid,
  removePanel,
  reopenPanel,
  detectOrphanedTabs,
  repairActivePanelId,
  resizeSplitChild,
  resolveDragDistance,
  resolveDragIndex,
  resolveDragOffset,
  serializePanelGrid,
  singlePanelGrid,
  splitPanelAt,
  type Panel,
  type PanelDragState,
  type PanelGridState,
  type PanelMetric,
  type SplitNode,
} from "../../src/lib/panelGrid";

function makePanel(id: string, type: Panel["type"] = "chat"): Panel {
  return { id, type, title: `Panel ${id}`, chatSessionId: type === "chat" ? `chat-${id}` : null, terminalId: type === "terminal" ? 1 : null, filePath: type === "file" ? "/foo" : null };
}

function makeLeaf(id: string, type: Panel["type"] = "chat"): SplitNode {
  return { kind: "leaf", panel: makePanel(id, type) };
}

const A = makePanel("a");
const B = makePanel("b");
const C = makePanel("c");
const D = makePanel("d");

test.describe("panelGrid split-tree math", () => {
  test("emptyGrid produces an empty grid state", () => {
    const g = emptyGrid();
    expect(g.root).toBeNull();
    expect(g.activePanelId).toBeNull();
    expect(g.closedPanels).toEqual([]);
    expect(panelCount(g.root)).toBe(0);
    expect(flattenPanels(g.root)).toEqual([]);
  });

  test("singlePanelGrid produces a 1×1 grid", () => {
    const g = singlePanelGrid(A);
    expect(g.root).toEqual({ kind: "leaf", panel: A });
    expect(g.activePanelId).toBe("a");
    expect(panelCount(g.root)).toBe(1);
    expect(flattenPanels(g.root)).toEqual([A]);
  });

  test("findPanel locates a panel by id", () => {
    const g = singlePanelGrid(A);
    expect(findPanel(g.root, "a")).toEqual(A);
    expect(findPanel(g.root, "missing")).toBeNull();
    expect(findPanel(null, "a")).toBeNull();
  });

  test("splitPanelAt left on empty tree creates a single leaf", () => {
    const root = splitPanelAt(null, "a", A, "left");
    expect(root).toEqual({ kind: "leaf", panel: A });
  });

  test("splitPanelAt right on a leaf wraps in a row split", () => {
    const leaf = makeLeaf("a");
    const root = splitPanelAt(leaf, "a", B, "right");
    expect(root).toEqual({
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    });
  });

  test("splitPanelAt left on a leaf wraps in a row split (new panel first)", () => {
    const leaf = makeLeaf("a");
    const root = splitPanelAt(leaf, "a", B, "left");
    expect(root).toEqual({
      kind: "split",
      direction: "row",
      children: [makeLeaf("b"), makeLeaf("a")],
      sizes: [0.5, 0.5],
    });
  });

  test("splitPanelAt bottom on a leaf wraps in a column split", () => {
    const leaf = makeLeaf("a");
    const root = splitPanelAt(leaf, "a", B, "bottom");
    expect(root).toEqual({
      kind: "split",
      direction: "column",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    });
  });

  test("splitPanelAt top on a leaf wraps in a column split (new panel first)", () => {
    const leaf = makeLeaf("a");
    const root = splitPanelAt(leaf, "a", B, "top");
    expect(root).toEqual({
      kind: "split",
      direction: "column",
      children: [makeLeaf("b"), makeLeaf("a")],
      sizes: [0.5, 0.5],
    });
  });

  test("splitPanelAt right on a panel in an existing row split inserts into that row", () => {
    // Start: [a | b] (row)
    let root: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    };
    // Split right of a → [a | c | b]
    root = splitPanelAt(root, "a", C, "right");
    expect(root).toEqual({
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("c"), makeLeaf("b")],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    });
  });

  test("splitPanelAt bottom on a panel in an existing row split wraps it in a column split", () => {
    // Start: [a | b] (row)
    let root: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    };
    // Split bottom of a → [ [a / c] | b ]
    root = splitPanelAt(root, "a", C, "bottom");
    expect(root?.kind).toBe("split");
    if (root?.kind !== "split") return;
    expect(root.direction).toBe("row");
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toEqual({
      kind: "split",
      direction: "column",
      children: [makeLeaf("a"), makeLeaf("c")],
      sizes: [0.5, 0.5],
    });
    expect(root.children[1]).toEqual(makeLeaf("b"));
  });

  test("splitPanelAt supports nested {x}:{y} layouts", () => {
    // Build: [a | [b / c]] — a on left, b-over-c column on right.
    let root: SplitNode = makeLeaf("a");
    root = splitPanelAt(root, "a", B, "right"); // [a | b]
    root = splitPanelAt(root, "b", C, "bottom"); // [a | [b / c]]
    expect(panelCount(root)).toBe(3);
    expect(flattenPanels(root).map((p) => p.id)).toEqual(["a", "b", "c"]);
    // Verify structure: root is a row split with 2 children.
    expect(root.kind).toBe("split");
    if (root.kind !== "split") return;
    expect(root.direction).toBe("row");
    expect(root.children[0]).toEqual(makeLeaf("a"));
    expect(root.children[1]?.kind).toBe("split");
    if (root.children[1]?.kind !== "split") return;
    expect(root.children[1].direction).toBe("column");
  });

  test("findParentSplit finds the split containing a panel", () => {
    // [a | [b / c]]
    let root: SplitNode = makeLeaf("a");
    root = splitPanelAt(root, "a", B, "right");
    root = splitPanelAt(root, "b", C, "bottom");
    // Panel b's parent is the inner column split.
    const innerSplit = findParentSplit(root, "b");
    expect(innerSplit?.kind).toBe("split");
    if (innerSplit?.kind !== "split") return;
    expect(innerSplit.direction).toBe("column");
    // Panel a's parent is the outer row split.
    const outerSplit = findParentSplit(root, "a");
    expect(outerSplit).toBe(root);
  });

  test("removePanel collapses single-child splits", () => {
    // [a | b] → remove a → just b (leaf, not a split with one child)
    let root: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    };
    const after = removePanel(root, "a");
    expect(after).toEqual(makeLeaf("b"));
  });

  test("removePanel returns null when tree becomes empty", () => {
    const leaf = makeLeaf("a");
    expect(removePanel(leaf, "a")).toBeNull();
  });

  test("removePanel rebalances sizes", () => {
    // [a | b | c] → remove b → [a | c] with sizes [0.5, 0.5]
    let root: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    };
    const after = removePanel(root, "b");
    expect(after).toEqual({
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("c")],
      sizes: [0.5, 0.5],
    });
  });

  test("removePanel on nested tree collapses correctly", () => {
    // [a | [b / c]] → remove b → [a | c] (row split, c unwrapped from column)
    let root: SplitNode = makeLeaf("a");
    root = splitPanelAt(root, "a", B, "right");
    root = splitPanelAt(root, "b", C, "bottom"); // [a | [b / c]]
    const after = removePanel(root, "b");
    // The column split had [b, c]; removing b leaves just c, so it collapses.
    expect(after).toEqual({
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("c")],
      sizes: [0.5, 0.5],
    });
  });

  test("movePanel removes and re-inserts", () => {
    // [a | b | c] → drag a to right of c → [b | c | a]
    let root: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    };
    const after = movePanel(root, "a", "c", "right");
    expect(flattenPanels(after).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  test("resizeSplitChild adjusts adjacent sizes with clamping", () => {
    const split: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    };
    const resized = resizeSplitChild(split, split, 0, 0.1);
    if (resized.kind !== "split") return;
    expect(Math.abs(resized.sizes[0] - 0.6)).toBeLessThan(0.001);
    expect(Math.abs(resized.sizes[1] - 0.4)).toBeLessThan(0.001);
  });

  test("resizeSplitChild clamps to MIN_SPLIT_SIZE", () => {
    const split: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b")],
      sizes: [0.5, 0.5],
    };
    // Try to shrink child 0 to -0.5 (would make it 0.0).
    const resized = resizeSplitChild(split, split, 0, -0.5);
    if (resized.kind !== "split") return;
    expect(resized.sizes[0]).toBeGreaterThanOrEqual(MIN_SPLIT_SIZE);
    expect(resized.sizes[1]).toBeLessThanOrEqual(1 - MIN_SPLIT_SIZE);
  });

  test("equalizeSplit resets sizes to equal", () => {
    const split: SplitNode = {
      kind: "split",
      direction: "row",
      children: [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")],
      sizes: [0.6, 0.3, 0.1],
    };
    const equalized = equalizeSplit(split, split);
    if (equalized.kind !== "split") return;
    expect(equalized.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  test("closePanel moves panel to history and picks new active", () => {
    const g = singlePanelGrid(A);
    // Add a second panel so there's something to activate.
    const root = splitPanelAt(g.root, "a", B, "right")!;
    const state = { root, activePanelId: "a", closedPanels: [] as Panel[] };
    const after = closePanel(state, "a");
    expect(findPanel(after.root, "a")).toBeNull();
    expect(after.closedPanels.find((p) => p.id === "a")).toBeTruthy();
    expect(after.activePanelId).toBe("b");
  });

  test("closePanel does not duplicate history entries", () => {
    const leaf = makeLeaf("a");
    const state = { root: leaf, activePanelId: "a", closedPanels: [] as Panel[] };
    const firstClose = closePanel(state, "a");
    // Add a again somehow (shouldn't happen in practice, but test the guard).
    const state2 = { ...firstClose, root: leaf, activePanelId: "a" };
    const secondClose = closePanel(state2, "a");
    expect(secondClose.closedPanels.filter((p) => p.id === "a")).toHaveLength(1);
  });

  test("reopenPanel moves panel from history back to grid", () => {
    const g = singlePanelGrid(A);
    const root = splitPanelAt(g.root, "a", B, "right")!;
    const state = { root, activePanelId: "a", closedPanels: [] as Panel[] };
    const closed = closePanel(state, "a");
    expect(closed.closedPanels).toHaveLength(1);
    const reopened = reopenPanel(closed, "a");
    expect(reopened.closedPanels).toHaveLength(0);
    expect(findPanel(reopened.root, "a")).toBeTruthy();
    expect(reopened.activePanelId).toBe("a");
  });

  test("reopenPanel on empty grid creates a single leaf", () => {
    const state = emptyGrid();
    state.closedPanels = [A];
    const after = reopenPanel(state, "a");
    expect(after.root).toEqual({ kind: "leaf", panel: A });
    expect(after.activePanelId).toBe("a");
  });

  test("deletePanelFromHistory removes from closedPanels", () => {
    const state = { root: null, activePanelId: null, closedPanels: [A, B] };
    const after = deletePanelFromHistory(state, "a");
    expect(after.closedPanels).toEqual([B]);
  });

  test("serializePanelGrid and parsePanelGrid round-trip", () => {
    const g = singlePanelGrid(A);
    const root = splitPanelAt(g.root, "a", B, "right")!;
    const state = { root, activePanelId: "a", closedPanels: [C] };
    const json = serializePanelGrid(state);
    const parsed = parsePanelGrid(json);
    expect(parsed.activePanelId).toBe("a");
    expect(findPanel(parsed.root, "a")).toBeTruthy();
    expect(findPanel(parsed.root, "b")).toBeTruthy();
    expect(parsed.closedPanels.find((p) => p.id === "c")).toBeTruthy();
  });

  test("parsePanelGrid returns empty grid on null/invalid", () => {
    expect(parsePanelGrid(null)).toEqual(emptyGrid());
    expect(parsePanelGrid("not json")).toEqual(emptyGrid());
    expect(parsePanelGrid('{"root": null}')).toEqual(emptyGrid());
  });

  // ── Drag-reorder math (ported from reference IDE) ───────────────────────

  function makeMetrics(ids: string[], size = 200): PanelMetric[] {
    return ids.map((id, i) => ({ id, start: i * size, size }));
  }

  test("resolveDragDistance clamps to split bounds", () => {
    const state: PanelDragState = {
      draggedId: "a",
      initialIndex: 0,
      currentIndex: 0,
      startX: 0,
      currentX: 50,
      moved: true,
      metrics: makeMetrics(["a", "b", "c"]),
    };
    // Drag right by 50px.
    expect(resolveDragDistance(state)).toBe(50);
    // Drag left past the first panel — clamped.
    state.currentX = -500;
    expect(resolveDragDistance(state)).toBe(0); // firstMetric.start - initialMetric.start = 0
    // Drag right past the last panel — clamped.
    state.currentX = 10000;
    const last = state.metrics[2];
    const maxDrag = last.start + last.size - state.metrics[0].start - state.metrics[0].size;
    expect(resolveDragDistance(state)).toBe(maxDrag);
  });

  test("resolveDragIndex moves right when past midpoint", () => {
    const state: PanelDragState = {
      draggedId: "a",
      initialIndex: 0,
      currentIndex: 0,
      startX: 0,
      currentX: 150, // past midpoint of b (200/2=100, so 150 > 100)
      moved: true,
      metrics: makeMetrics(["a", "b", "c"]),
    };
    expect(resolveDragIndex(state)).toBe(1);
  });

  test("resolveDragIndex moves left when past midpoint", () => {
    const state: PanelDragState = {
      draggedId: "c",
      initialIndex: 2,
      currentIndex: 2,
      startX: 400,
      currentX: 250, // past midpoint of b (200+100=300, so 250 < 300)
      moved: true,
      metrics: makeMetrics(["a", "b", "c"]),
    };
    expect(resolveDragIndex(state)).toBe(1);
  });

  test("resolveDragIndex returns initial when not moved", () => {
    const state: PanelDragState = {
      draggedId: "a",
      initialIndex: 0,
      currentIndex: 0,
      startX: 0,
      currentX: 0,
      moved: false,
      metrics: makeMetrics(["a", "b"]),
    };
    expect(resolveDragIndex(state)).toBe(0);
  });

  test("resolveDragOffset shifts intervening panels", () => {
    const state: PanelDragState = {
      draggedId: "a",
      initialIndex: 0,
      currentIndex: 2,
      startX: 0,
      currentX: 500,
      moved: true,
      metrics: makeMetrics(["a", "b", "c"]),
    };
    // Panel a is the dragged one → offset is the drag distance.
    expect(resolveDragOffset(state, "a", 0)).toBe(resolveDragDistance(state));
    // Panel b (index 1) is between initial (0) and current (2) → shifts left by a's width.
    expect(resolveDragOffset(state, "b", 1)).toBe(-200);
    // Panel c (index 2) is at currentIndex → also shifts left (in range initial+1..current).
    expect(resolveDragOffset(state, "c", 2)).toBe(-200);
  });

  test("getDragAffectedIds returns panels between initial and current index", () => {
    const state: PanelDragState = {
      draggedId: "a",
      initialIndex: 0,
      currentIndex: 2,
      startX: 0,
      currentX: 500,
      moved: true,
      metrics: makeMetrics(["a", "b", "c"]),
    };
    expect(getDragAffectedIds(state)).toEqual(["a", "b", "c"]);
  });
});

// ── Regression: stale activePanelId (panel-grid-state-reliability) ────────

test.describe("panel-grid stale-anchor regression", () => {
  /** Fixture matching the live failure: one valid live leaf plus an
   *  `activePanelId` that is absent from the tree. */
  function corruptFixture(): PanelGridState {
    const live = makePanel("panel-1783338273743", "chat");
    return {
      root: { kind: "leaf", panel: live },
      activePanelId: "panel-1783407506176", // not present in the tree
      closedPanels: [],
    };
  }

  test("1.1 fixture has a valid root leaf with a stale activePanelId", () => {
    const fx = corruptFixture();
    expect(findPanel(fx.root, "panel-1783338273743")).toBeTruthy();
    expect(findPanel(fx.root, fx.activePanelId!)).toBeNull();
  });

  test("1.2 splitPanelAt is a no-op when the target is absent from the tree", () => {
    const fx = corruptFixture();
    const before = fx.root;
    // The current math returns the original tree when the target is missing.
    const after = splitPanelAt(fx.root, fx.activePanelId!, makePanel("new"), "right");
    expect(after).toBe(before);
    expect(flattenPanels(after).map((p) => p.id)).toEqual(["panel-1783338273743"]);
  });

  test("1.2 checked insertion does not treat a stale anchor as success", () => {
    const fx = corruptFixture();
    const newPanel = makePanel("new", "chat");
    const result = insertPanel(fx, newPanel, { side: "right", anchorId: fx.activePanelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The stale anchor is repaired to the live leaf, the new panel is placed
    // exactly once, and the active id is repaired to the new panel.
    expect(flattenPanels(result.state.root).map((p) => p.id)).toContain("new");
    expect(result.state.activePanelId).toBe("new");
    expect(findPanel(result.state.root, "panel-1783338273743")).toBeTruthy();
  });

  test("1.2 checked insertion fails on a duplicate panel id instead of no-op", () => {
    const fx = corruptFixture();
    const dup = makePanel("panel-1783338273743", "chat");
    const result = insertPanel(fx, dup, { side: "right", anchorId: fx.activePanelId });
    expect(result.ok).toBe(false);
  });
});

// ── Normalization & repair (panel-grid-state-reliability) ──────────────────

test.describe("panel-grid normalization", () => {
  test("2.4 malformed JSON returns an empty grid with a diagnostic", () => {
    const result = parsePanelGridWithDiagnostics("not json");
    expect(result.state).toEqual(emptyGrid());
    expect(result.repaired).toBe(true);
    expect(result.diagnostics.some((d) => d.kind === "malformed-node")).toBe(true);
  });

  test("2.4 stale active id is repaired to the first live panel", () => {
    const live = makePanel("a");
    const raw = JSON.stringify({ root: { kind: "leaf", panel: live }, activePanelId: "missing", closedPanels: [] });
    const result = parsePanelGridWithDiagnostics(raw);
    expect(result.state.activePanelId).toBe("a");
    expect(result.diagnostics.some((d) => d.kind === "stale-active")).toBe(true);
    expect(result.repaired).toBe(true);
  });

  test("2.4 empty tree clears a stale active id", () => {
    const raw = JSON.stringify({ root: null, activePanelId: "ghost", closedPanels: [] });
    const result = parsePanelGridWithDiagnostics(raw);
    expect(result.state.root).toBeNull();
    expect(result.state.activePanelId).toBeNull();
    expect(result.diagnostics.some((d) => d.kind === "stale-active")).toBe(true);
  });

  test("2.4 nested splits with invalid sizes are rebalanced", () => {
    const root = {
      kind: "split" as const,
      direction: "row" as const,
      children: [
        { kind: "leaf" as const, panel: makePanel("a") },
        {
          kind: "split" as const,
          direction: "column" as const,
          children: [
            { kind: "leaf" as const, panel: makePanel("b") },
            { kind: "leaf" as const, panel: makePanel("c") },
          ],
          sizes: [0.9, 0.9], // invalid: sums to 1.8
        },
      ],
      sizes: [0.5, 0.5],
    };
    const raw = JSON.stringify({ root, activePanelId: "a", closedPanels: [] });
    const result = parsePanelGridWithDiagnostics(raw);
    expect(findPanel(result.state.root, "a")).toBeTruthy();
    expect(findPanel(result.state.root, "b")).toBeTruthy();
    expect(findPanel(result.state.root, "c")).toBeTruthy();
    expect(result.diagnostics.some((d) => d.kind === "invalid-size")).toBe(true);
  });

  test("2.4 duplicate live ids are quarantined to one occurrence", () => {
 const raw = JSON.stringify({
      root: {
        kind: "split",
        direction: "row",
        children: [
          { kind: "leaf", panel: makePanel("a") },
          { kind: "leaf", panel: makePanel("a") }, // duplicate
          { kind: "leaf", panel: makePanel("b") },
        ],
        sizes: [1 / 3, 1 / 3, 1 / 3],
      },
      activePanelId: "a",
      closedPanels: [],
    });
    const result = parsePanelGridWithDiagnostics(raw);
    const ids = flattenPanels(result.state.root).map((p) => p.id);
    expect(ids.filter((id) => id === "a")).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate-id")).toBe(true);
  });

  test("2.2 duplicate ids across live and history quarantine the history copy", () => {
    const raw = JSON.stringify({
      root: { kind: "leaf", panel: makePanel("a") },
      activePanelId: "a",
      closedPanels: [makePanel("a"), makePanel("b")], // "a" duplicates live
    });
    const result = parsePanelGridWithDiagnostics(raw);
    expect(findPanel(result.state.root, "a")).toBeTruthy();
    expect(result.state.closedPanels.map((p) => p.id)).toEqual(["b"]);
    expect(result.diagnostics.some((d) => d.kind === "duplicate-id" && d.panelId === "a")).toBe(true);
  });

  test("2.4 malformed leaf panel is dropped without deleting backing sessions", () => {
    const raw = JSON.stringify({
      root: {
        kind: "split",
        direction: "row",
        children: [
          { kind: "leaf", panel: makePanel("a") },
          { kind: "leaf", panel: { id: 123, type: "chat", title: "bad" } }, // bad id
        ],
        sizes: [0.5, 0.5],
      },
      activePanelId: "a",
      closedPanels: [],
    });
    const result = parsePanelGridWithDiagnostics(raw);
    expect(flattenPanels(result.state.root).map((p) => p.id)).toEqual(["a"]);
    expect(result.diagnostics.some((d) => d.kind === "malformed-node")).toBe(true);
  });

  test("2.4 parsePanelGrid round-trips a normalized state", () => {
    const g = singlePanelGrid(A);
    const root = splitPanelAt(g.root, "a", B, "right")!;
    const state: PanelGridState = { root, activePanelId: "a", closedPanels: [C] };
    const parsed = parsePanelGrid(serializePanelGrid(state));
    expect(parsed.activePanelId).toBe("a");
    expect(findPanel(parsed.root, "a")).toBeTruthy();
    expect(findPanel(parsed.root, "b")).toBeTruthy();
    expect(parsed.closedPanels.find((p) => p.id === "c")).toBeTruthy();
  });

  test("repairActivePanelId repairs a stale active pointer", () => {
    const state: PanelGridState = {
      root: { kind: "leaf", panel: A },
      activePanelId: "missing",
      closedPanels: [],
    };
    const repaired = repairActivePanelId(state);
    expect(repaired.activePanelId).toBe("a");
  });

  test("repairActivePanelId is a no-op when the active id is valid", () => {
    const state: PanelGridState = {
      root: { kind: "leaf", panel: A },
      activePanelId: "a",
      closedPanels: [],
    };
    expect(repairActivePanelId(state)).toBe(state);
  });
});

// ── Checked insertion & unique ids (panel-grid-state-reliability) ──────────

test.describe("panel-grid checked insertion", () => {
  test("3.1 empty grid accepts the first panel as the root", () => {
    const result = insertPanel(emptyGrid(), A, { side: "right" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.root).toEqual({ kind: "leaf", panel: A });
    expect(result.state.activePanelId).toBe("a");
  });

  test("3.1 stale anchor falls back to a deterministic live leaf", () => {
    const state: PanelGridState = {
      root: splitPanelAt(makeLeaf("a"), "a", B, "right"),
      activePanelId: "missing",
      closedPanels: [],
    };
    const result = insertPanel(state, C, { side: "right", anchorId: state.activePanelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flattenPanels(result.state.root).map((p) => p.id)).toContain("c");
    expect(result.state.activePanelId).toBe("c");
  });

  test("3.1 new panel appears exactly once after insertion", () => {
    const state = singlePanelGrid(A);
    const result = insertPanel(state, B, { side: "right" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flattenPanels(result.state.root).filter((p) => p.id === "b")).toHaveLength(1);
  });

  test("3.1 insertion fails when the panel id already exists", () => {
    const state = singlePanelGrid(A);
    const result = insertPanel(state, A, { side: "right" });
    expect(result.ok).toBe(false);
  });

  test("3.3 newPanelId is collision-resistant across rapid calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(newPanelId());
    expect(ids.size).toBe(500);
  });

  test("reopen preserves history when insertion fails", () => {
    // Force a failure by re-opening a panel whose id already lives in the tree.
    const state: PanelGridState = {
      root: { kind: "leaf", panel: A },
      activePanelId: "a",
      closedPanels: [A], // duplicate id → insertion must fail
    };
    const after = reopenPanel(state, "a");
    expect(after.closedPanels.find((p) => p.id === "a")).toBeTruthy();
    expect(after.root).toBe(state.root);
  });

  test("4.4 removePanelFromGrid rolls back a reservation without touching history", () => {
    const state: PanelGridState = {
      root: splitPanelAt(makeLeaf("a"), "a", B, "right"),
      activePanelId: "b",
      closedPanels: [C],
    };
    const after = removePanelFromGrid(state, "b");
    expect(findPanel(after.root, "b")).toBeNull();
    expect(after.activePanelId).toBe("a");
    expect(after.closedPanels).toEqual([C]);
  });

  test("4.4 removePanelFromGrid is a no-op for an absent panel", () => {
    const state = singlePanelGrid(A);
    expect(removePanelFromGrid(state, "missing")).toBe(state);
  });
});

test.describe("panel-grid orphan recovery", () => {
  test("6.1 detectOrphanedTabs flags a tab with no reachable panel", () => {
    const state = singlePanelGrid(A);
    const tabs = [
      { id: "a", kind: "chat", title: "Chat A", chatSessionId: "chat-a" }, // reachable
      { id: "orphan-1", kind: "chat", title: "Orphan", chatSessionId: "chat-x" }, // not reachable
    ];
    const orphans = detectOrphanedTabs(state, tabs);
    expect(orphans.map((o) => o.tabId)).toEqual(["orphan-1"]);
  });

  test("6.1 a tab reachable via history is not orphaned", () => {
    const state: PanelGridState = {
      root: null,
      activePanelId: null,
      closedPanels: [B],
    };
    const tabs = [
      { id: "b", kind: "chat", title: "Chat B", chatSessionId: "chat-b" },
    ];
    const orphans = detectOrphanedTabs(state, tabs);
    expect(orphans).toEqual([]);
  });

  test("6.2 detectOrphanedTabs never deletes — it only reports", () => {
    const state = singlePanelGrid(A);
    const tabs = [
      { id: "ghost", kind: "terminal", title: "Ghost", terminalId: 99 },
    ];
    const orphans = detectOrphanedTabs(state, tabs);
    expect(orphans).toHaveLength(1);
    // The state is untouched.
    expect(findPanel(state.root, "a")).toBeTruthy();
  });
});

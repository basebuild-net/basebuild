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
  movePanel,
  panelCount,
  parsePanelGrid,
  reopenPanel,
  removePanel,
  resizeSplitChild,
  resolveDragDistance,
  resolveDragIndex,
  resolveDragOffset,
  serializePanelGrid,
  singlePanelGrid,
  splitPanelAt,
  type Panel,
  type PanelDragState,
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

import { expect, test } from "@playwright/test";
import {
  closePanel,
  emptyGrid,
  flattenPanels,
  hiddenPanelsOf,
  hidePanel,
  insertPanel,
  linkHiddenPanel,
  restoreStashedGroup,
  showOnlyHiddenPanel,
  splitPanelAt,
  type Panel,
  type PanelGridState,
  type SplitNode,
} from "../../src/lib/panelGrid";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePanel(id: string, type: Panel["type"] = "chat"): Panel {
  return {
    id,
    type,
    title: `Panel ${id}`,
    chatSessionId: type === "chat" ? `chat-${id}` : null,
    terminalId: null,
    filePath: null,
  };
}

function makeLeaf(id: string): SplitNode {
  return { kind: "leaf", panel: makePanel(id) };
}

/** Build a 2-panel horizontal split: A | B */
function twoPanelGrid(): PanelGridState {
  const a = makePanel("a");
  const b = makePanel("b");
  const state: PanelGridState = {
    root: { kind: "leaf", panel: a },
    activePanelId: "a",
    closedPanels: [],
    hiddenPanels: [],
  };
  const result = insertPanel(state, b, { side: "right", anchorId: "a" });
  if (!result.ok) throw new Error("insertPanel failed");
  return result.state;
}

/** Build a 3-panel grid: A | (B / C) */
function threePanelGrid(): PanelGridState {
  const base = twoPanelGrid();
  const c = makePanel("c");
  const result = insertPanel(base, c, { side: "bottom", anchorId: "b" });
  if (!result.ok) throw new Error("insertPanel failed for c");
  return result.state;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("showOnlyHiddenPanel — stashed group math", () => {
  test("stashes a linked group and shows only the hidden panel", () => {
    // Start: A | B (linked group), C is hidden
    const base = twoPanelGrid();
    const c = makePanel("c");
    const state: PanelGridState = {
      ...base,
      hiddenPanels: [c],
    };

    const result = showOnlyHiddenPanel(state, "c");

    // C is now the sole visible root
    expect(result.root).toEqual({ kind: "leaf", panel: c });
    expect(result.activePanelId).toBe("c");

    // The A|B split tree is stashed intact
    expect(result.stashedRoot).not.toBeNull();
    expect(flattenPanels(result.stashedRoot!).map((p) => p.id)).toEqual(["a", "b"]);

    // C is no longer in hiddenPanels
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("c");
    // A and B are NOT in hiddenPanels — they're in the stashed tree, not duplicated
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("a");
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("b");
    // hiddenPanels should be empty (only C was there before, now removed)
    expect(hiddenPanelsOf(result)).toHaveLength(0);
  });

  test("preserves the stashed tree's split structure", () => {
    // Start: A | (B / C) — a 3-panel linked group, D is hidden
    const base = threePanelGrid();
    const d = makePanel("d");
    const state: PanelGridState = {
      ...base,
      hiddenPanels: [d],
    };

    const result = showOnlyHiddenPanel(state, "d");

    // D is the sole visible root
    expect(result.root).toEqual({ kind: "leaf", panel: d });

    // Stashed tree has all 3 panels
    const stashedIds = flattenPanels(result.stashedRoot!).map((p) => p.id);
    expect(stashedIds).toHaveLength(3);
    expect(stashedIds).toContain("a");
    expect(stashedIds).toContain("b");
    expect(stashedIds).toContain("c");

    // Stashed tree is a split (not a leaf)
    expect(result.stashedRoot!.kind).toBe("split");
    // A, B, C are NOT in hiddenPanels — they're in the stashed tree
    const hiddenIds = hiddenPanelsOf(result).map((p) => p.id);
    expect(hiddenIds).not.toContain("a");
    expect(hiddenIds).not.toContain("b");
    expect(hiddenIds).not.toContain("c");
    expect(hiddenIds).not.toContain("d");
    expect(hiddenPanelsOf(result)).toHaveLength(0);
  });

  test("moves single visible panel to hiddenPanels (does not vanish)", () => {
    // Start: A (single visible), B is hidden
    const state: PanelGridState = {
      root: makeLeaf("a"),
      activePanelId: "a",
      closedPanels: [],
      hiddenPanels: [makePanel("b")],
    };

    const result = showOnlyHiddenPanel(state, "b");

    // B is now the sole visible root
    expect(result.root).toEqual({ kind: "leaf", panel: makePanel("b") });
    expect(result.activePanelId).toBe("b");

    // A is now in hiddenPanels (it did not vanish!)
    expect(hiddenPanelsOf(result).map((p) => p.id)).toContain("a");

    // No stash (single panel was not a group)
    expect(result.stashedRoot).toBeNull();
  });

  test("does not stash when current root is a single panel", () => {
    const state: PanelGridState = {
      root: makeLeaf("a"),
      activePanelId: "a",
      closedPanels: [],
      hiddenPanels: [makePanel("b")],
    };

    const result = showOnlyHiddenPanel(state, "b");
    expect(result.stashedRoot).toBeNull();
  });

  test("returns same state when panel is not in hiddenPanels", () => {
    const state = twoPanelGrid();
    const result = showOnlyHiddenPanel(state, "nonexistent");
    expect(result).toBe(state);
  });

  test("preserves existing stash when switching between unlinked chats", () => {
    // Start: A | B (linked group, stashed), C is visible, D is hidden
    const base = twoPanelGrid();
    const c = makePanel("c");
    const d = makePanel("d");
    let state: PanelGridState = {
      ...base,
      hiddenPanels: [c, d],
    };

    // Click C — stashes A|B, shows C
    state = showOnlyHiddenPanel(state, "c");
    expect(state.root).toEqual({ kind: "leaf", panel: c });
    expect(state.stashedRoot).not.toBeNull();
    const stashRef = state.stashedRoot;

    // Click D — should NOT re-stash (C is single), should preserve existing stash
    state = showOnlyHiddenPanel(state, "d");
    expect(state.root).toEqual({ kind: "leaf", panel: d });
    expect(state.stashedRoot).toBe(stashRef);
    // C should be in hiddenPanels now
    expect(hiddenPanelsOf(state).map((p) => p.id)).toContain("c");
  });
});

test.describe("restoreStashedGroup — restore linked group math", () => {
  test("restores the stashed group and moves current panel to hidden", () => {
    // Start: A | B stashed, C is visible
    const base = twoPanelGrid();
    const c = makePanel("c");
    let state = showOnlyHiddenPanel({ ...base, hiddenPanels: [c] }, "c");

    // Click panel A (in the stashed group) to restore
    state = restoreStashedGroup(state, "a");

    // Root is the restored A|B split
    expect(flattenPanels(state.root).map((p) => p.id)).toEqual(["a", "b"]);
    expect(state.activePanelId).toBe("a");

    // C is back in hiddenPanels
    expect(hiddenPanelsOf(state).map((p) => p.id)).toContain("c");

    // Stash is cleared
    expect(state.stashedRoot).toBeNull();
  });

  test("returns same state when no stash exists", () => {
    const state: PanelGridState = {
      root: makeLeaf("a"),
      activePanelId: "a",
      closedPanels: [],
      hiddenPanels: [],
    };
    const result = restoreStashedGroup(state, "a");
    expect(result).toBe(state);
  });

  test("returns same state when panel is not in stashed tree", () => {
    const base = twoPanelGrid();
    const c = makePanel("c");
    const d = makePanel("d");
    let state = showOnlyHiddenPanel({ ...base, hiddenPanels: [c, d] }, "c");

    // Try to restore with a panel that's NOT in the stashed tree
    const result = restoreStashedGroup(state, "d");
    expect(result).toBe(state);
  });

  test("preserves split structure after restore", () => {
    // Start: A | (B / C) — 3-panel group, D is hidden
    const base = threePanelGrid();
    const d = makePanel("d");
    let state = showOnlyHiddenPanel({ ...base, hiddenPanels: [d] }, "d");

    // Restore by clicking B
    state = restoreStashedGroup(state, "b");

    // Root should have 3 panels with split structure
    expect(state.root!.kind).toBe("split");
    const ids = flattenPanels(state.root).map((p) => p.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(state.activePanelId).toBe("b");
  });

  test("full cycle: stash → restore → stash again", () => {
    const base = twoPanelGrid();
    const c = makePanel("c");

    // Stash A|B, show C
    let state = showOnlyHiddenPanel({ ...base, hiddenPanels: [c] }, "c");
    expect(state.stashedRoot).not.toBeNull();

    // Restore A|B
    state = restoreStashedGroup(state, "a");
    expect(state.stashedRoot).toBeNull();
    expect(flattenPanels(state.root).map((p) => p.id)).toEqual(["a", "b"]);
    expect(hiddenPanelsOf(state).map((p) => p.id)).toContain("c");

    // Stash again
    state = showOnlyHiddenPanel(state, "c");
    expect(state.stashedRoot).not.toBeNull();
    expect(flattenPanels(state.stashedRoot!).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

test.describe("showOnlyHiddenPanel — no panel lost", () => {
  test("every panel is accounted for after switching to unlinked", () => {
    // A | B | C all visible, D hidden
    const base = threePanelGrid();
    const d = makePanel("d");
    const state = { ...base, hiddenPanels: [d] };

    const allBefore = new Set([
      ...flattenPanels(state.root).map((p) => p.id),
      ...hiddenPanelsOf(state).map((p) => p.id),
    ]);

    const result = showOnlyHiddenPanel(state, "d");

    const allAfter = new Set([
      ...flattenPanels(result.root).map((p) => p.id),
      ...hiddenPanelsOf(result).map((p) => p.id),
      ...(result.stashedRoot ? flattenPanels(result.stashedRoot).map((p) => p.id) : []),
    ]);

    // No panel should vanish
    for (const id of allBefore) {
      expect(allAfter.has(id)).toBe(true);
    }
    // No duplicate panels
    expect(allAfter.size).toBe(allBefore.size);
  });

  test("every panel is accounted for after restoring stashed group", () => {
    const base = threePanelGrid();
    const d = makePanel("d");
    let state = showOnlyHiddenPanel({ ...base, hiddenPanels: [d] }, "d");

    const allBefore = new Set([
      ...flattenPanels(state.root).map((p) => p.id),
      ...hiddenPanelsOf(state).map((p) => p.id),
      ...(state.stashedRoot ? flattenPanels(state.stashedRoot).map((p) => p.id) : []),
    ]);

    state = restoreStashedGroup(state, "a");

    const allAfter = new Set([
      ...flattenPanels(state.root).map((p) => p.id),
      ...hiddenPanelsOf(state).map((p) => p.id),
      ...(state.stashedRoot ? flattenPanels(state.stashedRoot).map((p) => p.id) : []),
    ]);

    for (const id of allBefore) {
      expect(allAfter.has(id)).toBe(true);
    }
    expect(allAfter.size).toBe(allBefore.size);
  });

  test("switching between two unlinked chats loses nothing", () => {
    // A | B linked, C and D hidden
    const base = twoPanelGrid();
    const c = makePanel("c");
    const d = makePanel("d");
    let state: PanelGridState = { ...base, hiddenPanels: [c, d] };

    const allBefore = new Set([
      ...flattenPanels(state.root).map((p) => p.id),
      ...hiddenPanelsOf(state).map((p) => p.id),
    ]);

    // Click C
    state = showOnlyHiddenPanel(state, "c");
    // Click D
    state = showOnlyHiddenPanel(state, "d");
    // Restore A|B
    state = restoreStashedGroup(state, "a");

    const allAfter = new Set([
      ...flattenPanels(state.root).map((p) => p.id),
      ...hiddenPanelsOf(state).map((p) => p.id),
      ...(state.stashedRoot ? flattenPanels(state.stashedRoot).map((p) => p.id) : []),
    ]);

    expect(allAfter.size).toBe(allBefore.size);
    for (const id of allBefore) {
      expect(allAfter.has(id)).toBe(true);
    }
  });
});

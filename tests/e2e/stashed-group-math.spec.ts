import { expect, test } from "@playwright/test";
import {
  activatePanel,
  flattenPanels,
  hiddenPanelsOf,
  insertPanel,
  parsePanelGrid,
  serializePanelGrid,
  stashedGroupsOf,
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
    createdAt: 0,
  };
}

/** A 2-panel horizontal split group: `id1 | id2`. */
function makeGroup(id1: string, id2: string): SplitNode {
  return {
    kind: "split",
    direction: "row",
    children: [
      { kind: "leaf", panel: makePanel(id1) },
      { kind: "leaf", panel: makePanel(id2) },
    ],
    sizes: [0.5, 0.5],
  };
}

/** Build a 2-panel horizontal split: A | B (A active). */
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

const ids = (panels: Panel[]) => panels.map((p) => p.id).sort();

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("activatePanel — solo activation", () => {
  test("shows only a hidden solo and parks the visible group intact", () => {
    // A | B visible, C hidden solo.
    const base = twoPanelGrid();
    const c = makePanel("c");
    const state: PanelGridState = { ...base, hiddenPanels: [c] };

    const result = activatePanel(state, "c");

    // C is the sole visible root and focused.
    expect(result.root).toEqual({ kind: "leaf", panel: c });
    expect(result.activePanelId).toBe("c");
    // The A|B group is parked intact as one stashed group — not flattened.
    expect(stashedGroupsOf(result)).toHaveLength(1);
    expect(ids(flattenPanels(stashedGroupsOf(result)[0]))).toEqual(["a", "b"]);
    // C left the hidden registry; A/B did not enter it.
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("c");
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("a");
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("b");
  });

  test("solo → solo swap uses hiddenPanels, never a group", () => {
    const a = makePanel("a");
    const b = makePanel("b");
    const state: PanelGridState = {
      root: { kind: "leaf", panel: a },
      activePanelId: "a",
      closedPanels: [],
      hiddenPanels: [b],
    };

    const result = activatePanel(state, "b");

    expect(result.root).toEqual({ kind: "leaf", panel: b });
    expect(stashedGroupsOf(result)).toHaveLength(0);
    expect(hiddenPanelsOf(result).map((p) => p.id)).toEqual(["a"]);
  });

  test("focusing an already-visible panel does not park anything", () => {
    const base = twoPanelGrid(); // active "a"
    const result = activatePanel(base, "b");
    expect(result.activePanelId).toBe("b");
    expect(result.root).toBe(base.root); // tree untouched
    expect(stashedGroupsOf(result)).toHaveLength(0);
  });

  test("returns the same ref when the panel is unknown", () => {
    const base = twoPanelGrid();
    expect(activatePanel(base, "nonexistent")).toBe(base);
  });
});

test.describe("activatePanel — group restore", () => {
  test("clicking any group member restores the whole group and focuses it", () => {
    const base = twoPanelGrid();
    const state: PanelGridState = { ...base, hiddenPanels: [makePanel("c")] };
    const stashed = activatePanel(state, "c"); // A|B parked, C visible

    const restored = activatePanel(stashed, "b");

    expect(ids(flattenPanels(restored.root))).toEqual(["a", "b"]);
    expect(restored.activePanelId).toBe("b");
    expect(stashedGroupsOf(restored)).toHaveLength(0);
    // The displaced solo C returns to the hidden registry.
    expect(hiddenPanelsOf(restored).map((p) => p.id)).toContain("c");
  });
});

test.describe("activatePanel — multiple groups preserved (regression)", () => {
  // Regression: previously, switching chats flattened a second group into
  // individual unlinked chats ("clicked another chat, it unlinked 2 chats").
  function twoGroupsState(): PanelGridState {
    return {
      root: { kind: "leaf", panel: makePanel("x") },
      activePanelId: "x",
      closedPanels: [],
      hiddenPanels: [makePanel("y")],
      stashedGroups: [makeGroup("a", "b"), makeGroup("c", "d")],
    };
  }

  test("activating a solo preserves every stashed group", () => {
    const result = activatePanel(twoGroupsState(), "y");

    expect(result.root).toEqual({ kind: "leaf", panel: makePanel("y") });
    expect(result.activePanelId).toBe("y");
    // The previous solo X is parked; both groups untouched.
    expect(hiddenPanelsOf(result).map((p) => p.id)).toContain("x");
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("y");
    expect(stashedGroupsOf(result)).toHaveLength(2);
  });

  test("restoring one group leaves the other group intact", () => {
    const result = activatePanel(twoGroupsState(), "a");

    expect(ids(flattenPanels(result.root))).toEqual(["a", "b"]);
    expect(result.activePanelId).toBe("a");
    // The other group survives as a group — not exploded into hidden solos.
    expect(stashedGroupsOf(result)).toHaveLength(1);
    expect(ids(flattenPanels(stashedGroupsOf(result)[0]))).toEqual(["c", "d"]);
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("c");
    expect(hiddenPanelsOf(result).map((p) => p.id)).not.toContain("d");
    // The previously visible solo X is parked.
    expect(hiddenPanelsOf(result).map((p) => p.id)).toContain("x");
  });
});

test.describe("stashedGroups persistence", () => {
  test("round-trips stashed groups through serialize/parse", () => {
    const state: PanelGridState = {
      root: { kind: "leaf", panel: makePanel("x") },
      activePanelId: "x",
      closedPanels: [],
      hiddenPanels: [],
      stashedGroups: [makeGroup("a", "b")],
    };
    const parsed = parsePanelGrid(serializePanelGrid(state));
    expect(stashedGroupsOf(parsed)).toHaveLength(1);
    expect(ids(flattenPanels(stashedGroupsOf(parsed)[0]))).toEqual(["a", "b"]);
  });

  test("migrates a legacy single stashedRoot into stashedGroups", () => {
    const legacy = JSON.stringify({
      root: { kind: "leaf", panel: makePanel("x") },
      activePanelId: "x",
      closedPanels: [],
      stashedRoot: makeGroup("a", "b"),
    });
    const parsed = parsePanelGrid(legacy);
    expect(stashedGroupsOf(parsed)).toHaveLength(1);
    expect(ids(flattenPanels(stashedGroupsOf(parsed)[0]))).toEqual(["a", "b"]);
  });

  test("demotes a collapsed single-panel group to a hidden solo", () => {
    const legacy = JSON.stringify({
      root: { kind: "leaf", panel: makePanel("x") },
      activePanelId: "x",
      closedPanels: [],
      stashedGroups: [{ kind: "leaf", panel: makePanel("a") }],
    });
    const parsed = parsePanelGrid(legacy);
    expect(stashedGroupsOf(parsed)).toHaveLength(0);
    expect(hiddenPanelsOf(parsed).map((p) => p.id)).toContain("a");
  });
});

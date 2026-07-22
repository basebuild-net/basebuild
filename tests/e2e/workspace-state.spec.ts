import { describe, it, expect } from "vitest";
import {
  closeSurface,
  createSurface,
  deleteSurfaceFromHistory,
  emptyWorkspaceState,
  findLeafBySurfaceId,
  firstLeaf,
  flattenLeaves,
  isSurfaceVisible,
  mapLegacyKind,
  migrateFromLegacyBlob,
  migrateFromPanelGrid,
  newSurfaceId,
  normalizeWorkspaceState,
  parseWorkspaceState,
  reopenSurface,
  removeSurfaceFromLayout,
  repairFocus,
  replaceFocusedSurface,
  serializeWorkspaceState,
  splitFocusedSurface,
  visibleSurfaceIds,
  type ClosedSurfaceRecord,
  type SurfaceKind,
  type SurfaceRecord,
  type TreeNode,
  type WorkspaceState,
} from "../../src/lib/workspaceState";
import {
  singlePanelGrid,
  splitPanelAt,
  closePanel,
  type Panel,
  type PanelGridState,
} from "../../src/lib/panelGrid";

const PROJECT = "C:/projects/demo";

function makePanel(id: string, type: Panel["type"] = "chat"): Panel {
  return {
    id,
    type,
    title: `Panel ${id}`,
    chatSessionId: type === "chat" ? `chat-${id}` : null,
    terminalId: type === "terminal" ? Number(id.slice(-1)) || 1 : null,
    filePath: type === "file" ? "/foo" : null,
  };
}

function makeSurface(id: string, kind: SurfaceKind = "chat", resourceId?: string): SurfaceRecord {
  return {
    id,
    kind,
    resourceId: resourceId ?? (kind === "terminal" ? `pty-${id}` : `chat-${id}`),
    title: `Surface ${id}`,
    titleLocked: false,
    projectId: PROJECT,
    createdAt: 1000,
    lastFocusedAt: 1000,
  };
}

function makeLeaf(surfaceId: string): TreeNode {
  return { id: `leaf-${surfaceId}`, surfaceId };
}

function stateWith(
  surfaces: SurfaceRecord[],
  tree: TreeNode | null,
  focusedSurfaceId: string | null = null,
  history: ClosedSurfaceRecord[] = [],
): WorkspaceState {
  const activeSurfaces: Record<string, SurfaceRecord> = {};
  for (const s of surfaces) activeSurfaces[s.id] = s;
  return { version: 2, activeSurfaces, visibleTree: tree, focusedSurfaceId, history };
}

// ── 2.1 Type & constructor sanity ───────────────────────────────────────────

describe("workspace state types & constructors", () => {
  it("emptyWorkspaceState produces a valid v2 state", () => {
    const s = emptyWorkspaceState(PROJECT);
    expect(s.version).toBe(2);
    expect(s.activeSurfaces).toEqual({});
    expect(s.visibleTree).toBeNull();
    expect(s.focusedSurfaceId).toBeNull();
    expect(s.history).toEqual([]);
  });

  it("newSurfaceId is unique across calls", () => {
    const a = newSurfaceId();
    const b = newSurfaceId();
    expect(a).not.toBe(b);
    expect(a.startsWith("surface-")).toBe(true);
  });

  it("mapLegacyKind maps chat/omp/terminal and rejects others", () => {
    expect(mapLegacyKind("chat")).toBe("chat");
    expect(mapLegacyKind("omp")).toBe("omp-chat");
    expect(mapLegacyKind("terminal")).toBe("terminal");
    expect(mapLegacyKind("file")).toBeNull();
    expect(mapLegacyKind("schematic")).toBeNull();
  });
});

// ── 2.2 Normalization ──────────────────────────────────────────────────────

describe("workspace state normalization", () => {
  it("valid v2 state passes through unchanged", () => {
    const s = stateWith([makeSurface("a")], makeLeaf("a"), "a");
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.repaired).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.focusedSurfaceId).toBe("a");
  });

  it("unknown surface kind is dropped with a diagnostic", () => {
    const raw = {
      version: 2,
      activeSurfaces: { x: { id: "x", kind: "file", resourceId: "r", title: null, titleLocked: false, projectId: PROJECT, createdAt: 0, lastFocusedAt: 0 } },
      visibleTree: null,
      focusedSurfaceId: null,
      history: [],
    };
    const result = normalizeWorkspaceState(raw, PROJECT);
    expect(result.state.activeSurfaces.x).toBeUndefined();
    expect(result.diagnostics.some((d) => d.kind === "unknown-surface-kind")).toBe(true);
  });

  it("duplicate visible surface ids quarantine the second occurrence", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = {
      id: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: makeLeaf("a"),
      second: makeLeaf("a"), // duplicate
    };
    const s = stateWith([a, b], tree, "a");
    const result = normalizeWorkspaceState(s, PROJECT);
    const ids = flattenLeaves(result.state.visibleTree).map((l) => l.surfaceId);
    expect(ids.filter((id) => id === "a")).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate-surface-id")).toBe(true);
  });

  it("dangling leaf (surfaceId not in activeSurfaces) is dropped", () => {
    const a = makeSurface("a");
    const tree: TreeNode = {
      id: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: makeLeaf("a"),
      second: makeLeaf("ghost"), // not in activeSurfaces
    };
    const s = stateWith([a], tree, "a");
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(findLeafBySurfaceId(result.state.visibleTree, "ghost")).toBeNull();
    expect(findLeafBySurfaceId(result.state.visibleTree, "a")).toBeTruthy();
    expect(result.diagnostics.some((d) => d.kind === "dangling-leaf")).toBe(true);
  });

  it("invalid split direction is dropped", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree = {
      id: "split-1",
      direction: "diagonal", // invalid
      ratio: 0.5,
      first: makeLeaf("a"),
      second: makeLeaf("b"),
    };
    const s = stateWith([a, b], tree as unknown as TreeNode, "a");
    const result = normalizeWorkspaceState(s, PROJECT);
    // The split is dropped; children collapsed into a single leaf (first valid).
    expect(result.diagnostics.some((d) => d.kind === "invalid-split-direction")).toBe(true);
  });

  it("out-of-range ratio is clamped to [0.1, 0.9]", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = {
      id: "split-1",
      direction: "horizontal",
      ratio: 0.01, // too small
      first: makeLeaf("a"),
      second: makeLeaf("b"),
    };
    const s = stateWith([a, b], tree, "a");
    const result = normalizeWorkspaceState(s, PROJECT);
    const split = result.state.visibleTree as Extract<TreeNode, { direction: string }>;
    expect(split.ratio).toBeGreaterThanOrEqual(0.1);
    expect(result.diagnostics.some((d) => d.kind === "invalid-ratio")).toBe(true);
  });

  it("stale focus is repaired to the first visible leaf", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = {
      id: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: makeLeaf("a"),
      second: makeLeaf("b"),
    };
    const s = stateWith([a, b], tree, "missing");
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.state.focusedSurfaceId).toBe("a");
    expect(result.diagnostics.some((d) => d.kind === "stale-focus")).toBe(true);
  });

  it("null focus with a non-empty tree is repaired", () => {
    const a = makeSurface("a");
    const s = stateWith([a], makeLeaf("a"), null);
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.state.focusedSurfaceId).toBe("a");
    expect(result.diagnostics.some((d) => d.kind === "stale-focus")).toBe(true);
  });

  it("empty tree with a stale focus clears the focus", () => {
    const s = stateWith([], null, "ghost");
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.state.focusedSurfaceId).toBeNull();
    expect(result.diagnostics.some((d) => d.kind === "stale-focus")).toBe(true);
  });

  it("duplicate history entry is quarantined", () => {
    const a = makeSurface("a");
    const closed: ClosedSurfaceRecord = { ...a, closedAt: 2000 };
    const s = stateWith([], null, null, [closed, closed]);
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.state.history.filter((h) => h.id === "a")).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate-history")).toBe(true);
  });

  it("history entry duplicating an active surface is quarantined", () => {
    const a = makeSurface("a");
    const closed: ClosedSurfaceRecord = { ...a, closedAt: 2000 };
    const s = stateWith([a], makeLeaf("a"), "a", [closed]);
    const result = normalizeWorkspaceState(s, PROJECT);
    expect(result.state.history.find((h) => h.id === "a")).toBeUndefined();
    expect(result.diagnostics.some((d) => d.kind === "duplicate-history")).toBe(true);
  });

  it("stale-resource diagnostic is emitted but surface retained", () => {
    const a = makeSurface("a", "terminal", "pty-99");
    const s = stateWith([a], makeLeaf("a"), "a");
    const validResourceIds = new Set<string>(["pty-1"]); // pty-99 not live
    const result = normalizeWorkspaceState(s, PROJECT, validResourceIds);
    expect(result.state.activeSurfaces.a).toBeDefined(); // retained
    expect(result.diagnostics.some((d) => d.kind === "stale-resource")).toBe(true);
  });

  it("normalization never throws on garbage input", () => {
    expect(() => normalizeWorkspaceState("garbage", PROJECT)).not.toThrow();
    expect(() => normalizeWorkspaceState(123, PROJECT)).not.toThrow();
    expect(() => normalizeWorkspaceState(null, PROJECT)).not.toThrow();
    expect(normalizeWorkspaceState(null, PROJECT).state.version).toBe(2);
  });
});

// ── 2.3 Legacy migration ────────────────────────────────────────────────────

describe("legacy tab-group migration", () => {
  it("one tab -> single leaf", () => {
    const legacy: PanelGridState = singlePanelGrid(makePanel("a"));
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(result.state.version).toBe(2);
    expect(flattenLeaves(result.state.visibleTree)).toHaveLength(1);
    expect(firstLeaf(result.state.visibleTree)?.surfaceId).toBe("a");
    expect(result.state.activeSurfaces.a).toBeDefined();
    expect(result.state.activeSurfaces.a.kind).toBe("chat");
    expect(result.state.focusedSurfaceId).toBe("a");
  });

  it("many tabs -> first/active visible, rest hidden active", () => {
    // A multi-tab panel with 3 chat tabs.
    const panel: Panel = {
      ...makePanel("p1"),
      tabs: [
        { id: "t1", type: "chat", title: "T1", chatSessionId: "c1", terminalId: null, filePath: null },
        { id: "t2", type: "chat", title: "T2", chatSessionId: "c2", terminalId: null, filePath: null },
        { id: "t3", type: "chat", title: "T3", chatSessionId: "c3", terminalId: null, filePath: null },
      ],
      activeTabId: "t2",
    };
    const legacy: PanelGridState = singlePanelGrid(panel);
    const result = migrateFromPanelGrid(legacy, PROJECT);
    // The active tab (t2) becomes the visible leaf.
    expect(firstLeaf(result.state.visibleTree)?.surfaceId).toBe("t2");
    expect(result.state.focusedSurfaceId).toBe("t2");
    // All three tabs are in activeSurfaces.
    expect(Object.keys(result.state.activeSurfaces).sort()).toEqual(["t1", "t2", "t3"]);
    // Only one visible leaf.
    expect(flattenLeaves(result.state.visibleTree)).toHaveLength(1);
    // t1 and t3 are active but hidden.
    expect(isSurfaceVisible(result.state, "t1")).toBe(false);
    expect(isSurfaceVisible(result.state, "t3")).toBe(false);
  });

  it("nested 2D layouts migrate preserving structure", () => {
    const g = singlePanelGrid(makePanel("a"));
    const root = splitPanelAt(g.root, "a", makePanel("b"), "right")!;
    const legacy: PanelGridState = { root, activePanelId: "a", closedPanels: [] };
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(flattenLeaves(result.state.visibleTree)).toHaveLength(2);
    const ids = flattenLeaves(result.state.visibleTree).map((l) => l.surfaceId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    // The split should be horizontal (row -> horizontal).
    const split = result.state.visibleTree as Extract<TreeNode, { direction: string }>;
    expect(split.direction).toBe("horizontal");
  });

  it("deeply nested 2x2 layout migrates to binary splits", () => {
    // Build a 2x2: row [ a, column [ b, c ] ] plus d on the right column.
    const g = singlePanelGrid(makePanel("a"));
    let root = splitPanelAt(g.root, "a", makePanel("b"), "right")!;
    root = splitPanelAt(root, "b", makePanel("c"), "bottom")!;
    const legacy: PanelGridState = { root, activePanelId: "a", closedPanels: [] };
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(flattenLeaves(result.state.visibleTree)).toHaveLength(3);
    const ids = flattenLeaves(result.state.visibleTree).map((l) => l.surfaceId);
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("duplicate ids across leaves are quarantined", () => {
    // Two leaves with the same panel id (corrupt legacy).
    const legacy: PanelGridState = {
      root: {
        kind: "split",
        direction: "row",
        children: [
          { kind: "leaf", panel: makePanel("dup") },
          { kind: "leaf", panel: makePanel("dup") },
        ],
        sizes: [0.5, 0.5],
      },
      activePanelId: "dup",
      closedPanels: [],
    };
    const result = migrateFromPanelGrid(legacy, PROJECT);
    // Only one visible occurrence.
    const ids = flattenLeaves(result.state.visibleTree).map((l) => l.surfaceId);
    expect(ids.filter((id) => id === "dup")).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.kind === "duplicate-surface-id")).toBe(true);
  });

  it("file/schematic panels are dropped non-destructively", () => {
    const legacy: PanelGridState = singlePanelGrid(makePanel("f", "file"));
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(result.state.visibleTree).toBeNull();
    expect(Object.keys(result.state.activeSurfaces)).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.kind === "non-surface-kind")).toBe(true);
  });

  it("closed panels migrate to history", () => {
    const g = singlePanelGrid(makePanel("a"));
    const closed = closePanel(g, "a");
    const result = migrateFromPanelGrid(closed, PROJECT);
    expect(result.state.history.find((h) => h.id === "a")).toBeDefined();
    expect(result.state.history[0].closedAt).toBeGreaterThan(0);
  });

  it("omp panel migrates to omp-chat surface kind", () => {
    const legacy: PanelGridState = singlePanelGrid(makePanel("o", "omp"));
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(result.state.activeSurfaces.o.kind).toBe("omp-chat");
  });

  it("terminal panel migrates with stringified PTY id", () => {
    const legacy: PanelGridState = singlePanelGrid(makePanel("t", "terminal"));
    const result = migrateFromPanelGrid(legacy, PROJECT);
    expect(result.state.activeSurfaces.t.kind).toBe("terminal");
    expect(result.state.activeSurfaces.t.resourceId).toBe("1");
  });

  it("backing sessions are never deleted — stale terminals retained", () => {
    const legacy: PanelGridState = singlePanelGrid(makePanel("t", "terminal"));
    // No live PTY ids.
    const result = migrateFromPanelGrid(legacy, PROJECT, new Set<string>());
    expect(result.state.activeSurfaces.t).toBeDefined();
    expect(result.diagnostics.some((d) => d.kind === "stale-resource")).toBe(true);
  });
});

// ── 2.4 Persistence safety ──────────────────────────────────────────────────

describe("persistence safety", () => {
  it("corrupted JSON returns empty state with a diagnostic (old blob preserved)", () => {
    const result = migrateFromLegacyBlob("not json at all", PROJECT);
    expect(result.state.visibleTree).toBeNull();
    expect(result.state.activeSurfaces).toEqual({});
    expect(result.diagnostics.some((d) => d.kind === "quarantined")).toBe(true);
    // The caller does not save on parse failure — the old blob is preserved.
  });

  it("unrecognized shape returns empty state with a diagnostic", () => {
    const result = migrateFromLegacyBlob(JSON.stringify({ random: true }), PROJECT);
    expect(result.state.visibleTree).toBeNull();
    expect(result.diagnostics.some((d) => d.kind === "quarantined")).toBe(true);
  });

  it("v2 blob is normalized (not migrated)", () => {
    const s = stateWith([makeSurface("a")], makeLeaf("a"), "a");
    const result = migrateFromLegacyBlob(serializeWorkspaceState(s), PROJECT);
    expect(result.state.focusedSurfaceId).toBe("a");
    expect(result.repaired).toBe(false);
  });

  it("legacy PanelGridState blob is migrated", () => {
    const legacy = singlePanelGrid(makePanel("a"));
    const result = migrateFromLegacyBlob(JSON.stringify(legacy), PROJECT);
    expect(result.state.version).toBe(2);
    expect(firstLeaf(result.state.visibleTree)?.surfaceId).toBe("a");
  });

  it("null blob returns empty state with no diagnostics", () => {
    const result = migrateFromLegacyBlob(null, PROJECT);
    expect(result.state.visibleTree).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.repaired).toBe(false);
  });

  it("parseWorkspaceState round-trips a normalized state", () => {
    const s = stateWith([makeSurface("a"), makeSurface("b")], {
      id: "s1",
      direction: "vertical",
      ratio: 0.5,
      first: makeLeaf("a"),
      second: makeLeaf("b"),
    }, "a");
    const parsed = parseWorkspaceState(serializeWorkspaceState(s), PROJECT);
    expect(parsed.state.focusedSurfaceId).toBe("a");
    expect(findLeafBySurfaceId(parsed.state.visibleTree, "a")).toBeTruthy();
    expect(findLeafBySurfaceId(parsed.state.visibleTree, "b")).toBeTruthy();
  });
});

// ── 2.5 Creating panels / surface lifecycle ─────────────────────────────────

describe("surface lifecycle mutations", () => {
  it("createSurface adds to activeSurfaces without placing in tree", () => {
    const s = emptyWorkspaceState(PROJECT);
    const { state, surfaceId } = createSurface(s, {
      kind: "chat",
      resourceId: "chat-new",
      title: "New chat",
      projectId: PROJECT,
    });
    expect(state.activeSurfaces[surfaceId]).toBeDefined();
    expect(state.visibleTree).toBeNull(); // not placed
  });

  it("replaceFocusedSurface on empty tree makes the surface the sole leaf", () => {
    const s = emptyWorkspaceState(PROJECT);
    const { state: withSurface, surfaceId } = createSurface(s, {
      kind: "chat", resourceId: "c1", title: null, projectId: PROJECT,
    });
    const replaced = replaceFocusedSurface(withSurface, surfaceId);
    expect(firstLeaf(replaced.visibleTree)?.surfaceId).toBe(surfaceId);
    expect(replaced.focusedSurfaceId).toBe(surfaceId);
  });

  it("splitFocusedSurface creates a binary split", () => {
    const s = emptyWorkspaceState(PROJECT);
    const { state: s1, surfaceId: a } = createSurface(s, { kind: "chat", resourceId: "c1", title: null, projectId: PROJECT });
    const placed = replaceFocusedSurface(s1, a);
    const { state: s2, surfaceId: b } = createSurface(placed, { kind: "chat", resourceId: "c2", title: null, projectId: PROJECT });
    const split = splitFocusedSurface(s2, b, "horizontal");
    expect(flattenLeaves(split.visibleTree)).toHaveLength(2);
    const node = split.visibleTree as Extract<TreeNode, { direction: string }>;
    expect(node.direction).toBe("horizontal");
    expect(node.ratio).toBe(0.5);
    expect(split.focusedSurfaceId).toBe(b);
  });

  it("removeSurfaceFromLayout hides but keeps active", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = { id: "s1", direction: "horizontal", ratio: 0.5, first: makeLeaf("a"), second: makeLeaf("b") };
    const s = stateWith([a, b], tree, "a");
    const hidden = removeSurfaceFromLayout(s, "b");
    expect(isSurfaceVisible(hidden, "b")).toBe(false);
    expect(hidden.activeSurfaces.b).toBeDefined(); // still active
    expect(flattenLeaves(hidden.visibleTree)).toHaveLength(1);
  });

  it("closeSurface moves to history and repairs focus", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = { id: "s1", direction: "horizontal", ratio: 0.5, first: makeLeaf("a"), second: makeLeaf("b") };
    const s = stateWith([a, b], tree, "a");
    const closed = closeSurface(s, "a");
    expect(closed.activeSurfaces.a).toBeUndefined();
    expect(closed.history.find((h) => h.id === "a")).toBeDefined();
    expect(closed.focusedSurfaceId).toBe("b");
  });

  it("reopenSurface returns active hidden without mutating the tree", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = makeLeaf("b");
    const closedA: ClosedSurfaceRecord = { ...a, closedAt: 2000 };
    const s = stateWith([b], tree, "b", [closedA]);
    const reopened = reopenSurface(s, "a");
    expect(reopened.activeSurfaces.a).toBeDefined();
    expect(isSurfaceVisible(reopened, "a")).toBe(false); // hidden
    expect(reopened.history.find((h) => h.id === "a")).toBeUndefined();
    // Tree unchanged.
    expect(flattenLeaves(reopened.visibleTree)).toHaveLength(1);
  });

  it("deleteSurfaceFromHistory removes the entry", () => {
    const a = makeSurface("a");
    const closedA: ClosedSurfaceRecord = { ...a, closedAt: 2000 };
    const s = stateWith([], null, null, [closedA]);
    const deleted = deleteSurfaceFromHistory(s, "a");
    expect(deleted.history).toEqual([]);
  });

  it("closed history collisions: reopening an already-active surface is a no-op", () => {
    const a = makeSurface("a");
    const closedA: ClosedSurfaceRecord = { ...a, closedAt: 2000 };
    const s = stateWith([a], makeLeaf("a"), "a", [closedA]);
    const reopened = reopenSurface(s, "a");
    // Already active — no change.
    expect(reopened).toBe(s);
  });
});

// ── 2.5 repairFocus ─────────────────────────────────────────────────────────

describe("repairFocus", () => {
  it("valid focus is a no-op", () => {
    const a = makeSurface("a");
    const s = stateWith([a], makeLeaf("a"), "a");
    const result = repairFocus({ state: s, diagnostics: [], repaired: false });
    expect(result.state.focusedSurfaceId).toBe("a");
    expect(result.repaired).toBe(false);
  });

  it("stale focus repairs to first leaf", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    const tree: TreeNode = { id: "s1", direction: "horizontal", ratio: 0.5, first: makeLeaf("a"), second: makeLeaf("b") };
    const s = stateWith([a, b], tree, "ghost");
    const result = repairFocus({ state: s, diagnostics: [], repaired: false });
    expect(result.state.focusedSurfaceId).toBe("a");
    expect(result.repaired).toBe(true);
  });
});

// ── visibleSurfaceIds helper ────────────────────────────────────────────────

describe("visibleSurfaceIds", () => {
  it("returns the set of visible surface ids", () => {
    const tree: TreeNode = {
      id: "s1",
      direction: "vertical",
      ratio: 0.5,
      first: makeLeaf("a"),
      second: { id: "s2", direction: "horizontal", ratio: 0.5, first: makeLeaf("b"), second: makeLeaf("c") },
    };
    expect(visibleSurfaceIds(tree)).toEqual(new Set(["a", "b", "c"]));
  });

  it("empty tree returns an empty set", () => {
    expect(visibleSurfaceIds(null).size).toBe(0);
  });
});

/**
 * Pure split-tree math for the unified panel grid (`panel-grid`).
 *
 * Layout model: a recursive split tree. A leaf node holds one panel. A split
 * node has a direction (row = side-by-side, column = stacked) and children
 * with fractional sizes (0–1, sum to 1.0).
 *
 * The drag-reorder distance/index resolution is ported from an MIT-licensed
 * reference IDE's chat-stack component, extended to support both row and
 * column directions (the reference only supports 1×N rows). The split-tree
 * model supports arbitrary `{x}:{y}` layouts with nested splits.
 *
 * The math is intentionally pure and side-effect-free so it can be
 * unit-tested in isolation.
 */

/** Panel type — mirrors SessionTab.kind, with "empty" → "schematic". */
export type PanelType = "chat" | "terminal" | "file" | "schematic" | "omp";

/** A panel is a leaf in the split tree. A panel can hold one or more tabs;
 *  a single-tab panel (the common case) renders as before. A multi-tab
 *  panel shows a tab strip in its header. */
export type Panel = {
  id: string;
  type: PanelType;
  title: string;
  chatSessionId: string | null;
  terminalId: number | null;
  filePath: string | null;
  /** Creation timestamp (ms epoch). Set once when the panel is created and
   *  never changed — used for stable sidebar ordering and "(N)" title
   *  disambiguation. Falls back to Date.now() when absent in legacy data. */
  createdAt: number;
  /** Last time this panel was focused/activated (ms epoch). Drives
   *  recently-used ordering in the sidebar. Absent on legacy data — callers
   *  fall back to `createdAt`. */
  lastUsedAt?: number;
  /** Tabs hosted in this panel. If absent or length ≤ 1, the panel renders
   *  as a single panel (no tab strip). When ≥ 2, the header shows a tab
   *  strip and `activeTabId` selects the visible tab. */
  tabs?: PanelTab[];
  /** The currently visible tab id (only meaningful when `tabs` has ≥ 2). */
  activeTabId?: string | null;
  /** True while a backing tab/process is being acquired for this panel.
   *  Panel-mutating actions are disabled and the renderer shows a pending
   *  state. Cleared once the resource binds or the reservation is rolled back. */
  creating?: boolean;
};

/** A tab within a multi-tab panel. Same shape as a single panel's identity
 *  fields — each tab has its own type, title, chatSessionId, etc. */
export type PanelTab = {
  id: string;
  type: PanelType;
  title: string;
  chatSessionId: string | null;
  terminalId: number | null;
  filePath: string | null;
  /** Creation timestamp (ms epoch). Set once when the tab is created. */
  createdAt: number;
};
export type SplitDirection = "row" | "column";

/** A node in the split tree: either a leaf (one panel) or a split. */
export type SplitNode =
  | { kind: "leaf"; panel: Panel }
  | { kind: "split"; direction: SplitDirection; children: SplitNode[]; sizes: number[] };
/** A split (non-leaf) node. Used as a return type where only splits are valid. */
export type SplitBranch = Extract<SplitNode, { kind: "split" }>;

/** The whole grid state: visible split tree, active hidden panels, and history. */
export type PanelGridState = {
  root: SplitNode | null;
  activePanelId: string | null;
  closedPanels: Panel[];
  /** Panels removed from the visible layout without closing their resources. */
  hiddenPanels?: Panel[];
  /** Inactive linked groups (each a ≥2-panel split tree) swapped out when the
   *  user activated a different chat. Clicking any panel in a group restores
   *  that whole group as the visible tree; every other group is preserved. */
  stashedGroups?: SplitNode[];
};

/** Minimum fractional size for a split child (prevents collapse). */
export const MIN_SPLIT_SIZE = 0.1;
/** Convert a Panel's identity fields into a PanelTab. */
function panelToTab(panel: Panel): PanelTab {
  return {
    id: panel.id,
    type: panel.type,
    title: panel.title,
    chatSessionId: panel.chatSessionId,
    terminalId: panel.terminalId,
    filePath: panel.filePath,
    createdAt: panel.createdAt,
  };
}

/** Add a new panel as a tab inside an existing target panel. The target
 *  panel's own identity becomes its first tab (if not already multi-tab),
 *  and the new panel becomes the second tab. The new tab is made active. */
function addTabToPanelLeaf(target: Panel, newPanel: Panel): Panel {
  const existingTabs = target.tabs ?? [panelToTab(target)];
  const newTab = panelToTab(newPanel);
  return {
    ...target,
    tabs: [...existingTabs, newTab],
    activeTabId: newTab.id,
  };
}

/** Tear off the active tab from a panel into a new standalone panel.
 *  Returns the new tree and the new panel's id, or null if the panel
 *  has only one tab (or no tabs) and can't be torn. */
export function tearOffTab(
  root: SplitNode | null,
  panelId: string,
  side: DropSide,
): { root: SplitNode | null; newPanelId: string } | null {
  const panel = findPanel(root, panelId);
  if (!panel?.tabs || panel.tabs.length < 2) return null;
  const activeId = panel.activeTabId ?? panel.tabs[0].id;
  const tabIndex = panel.tabs.findIndex((t) => t.id === activeId);
  if (tabIndex === -1) return null;
  const tornTab = panel.tabs[tabIndex];
  const remainingTabs = panel.tabs.filter((t) => t.id !== activeId);

  // The new standalone panel gets the torn tab's content.
  const newPanel: Panel = {
    id: `${panelId}-tear-${Date.now()}`,
    type: tornTab.type,
    title: tornTab.title,
    chatSessionId: tornTab.chatSessionId,
    terminalId: tornTab.terminalId,
    filePath: tornTab.filePath,
    createdAt: tornTab.createdAt,
  };

  // Update the original panel: remove the torn tab.
  const newRoot = updatePanelInTree(root, panelId, {
    tabs: remainingTabs.length === 1 ? undefined : remainingTabs,
    activeTabId: remainingTabs.length === 1 ? undefined : remainingTabs[0].id,
    // If only one tab left, adopt its identity.
    ...(remainingTabs.length === 1 ? {
      type: remainingTabs[0].type,
      title: remainingTabs[0].title,
      chatSessionId: remainingTabs[0].chatSessionId,
      terminalId: remainingTabs[0].terminalId,
      filePath: remainingTabs[0].filePath,
    } : {}),
  });

  // Insert the new panel beside the original.
  const finalRoot = splitPanelAt(newRoot, panelId, newPanel, side);
  return { root: finalRoot, newPanelId: newPanel.id };
}

// ── Grid constructors ──────────────────────────────────────────────────────

/** Active hidden panels. Older persisted states omit this field. */
export function hiddenPanelsOf(state: PanelGridState): Panel[] {
  return state.hiddenPanels ?? [];
}

/** Inactive linked groups. Older persisted states omit this field. */
export function stashedGroupsOf(state: PanelGridState): SplitNode[] {
  return state.stashedGroups ?? [];
}

/** An empty grid: no panels, no active panel, empty history. */
export function emptyGrid(): PanelGridState {
  return { root: null, activePanelId: null, closedPanels: [], hiddenPanels: [] };
}

/** A grid seeded from a single panel (the 1×1 default). */
export function singlePanelGrid(panel: Panel): PanelGridState {
  return {
    root: { kind: "leaf", panel },
    activePanelId: panel.id,
    closedPanels: [],
    hiddenPanels: [],
  };
}

// ── Tree traversal ─────────────────────────────────────────────────────────

/** Count the number of leaf panels in the tree. */
export function panelCount(root: SplitNode | null): number {
  if (!root) return 0;
  if (root.kind === "leaf") return 1;
  return root.children.reduce((sum, child) => sum + panelCount(child), 0);
}

/** Flatten the tree into an ordered list of panels (row-major: left-to-right,
 *  top-to-bottom). */
export function flattenPanels(root: SplitNode | null): Panel[] {
  if (!root) return [];
  if (root.kind === "leaf") return [root.panel];
  return root.children.flatMap((child) => flattenPanels(child));
}

/** Find a panel by id. Returns null if not found. */
export function findPanel(root: SplitNode | null, panelId: string): Panel | null {
  if (!root) return null;
  if (root.kind === "leaf") return root.panel.id === panelId ? root.panel : null;
  for (const child of root.children) {
    const found = findPanel(child, panelId);
    if (found) return found;
  }
  return null;
}

/** Find the split node that directly contains the leaf with `panelId`.
 *  Returns null if the panel is at the root level or not found. */
export function findParentSplit(root: SplitNode | null, panelId: string): SplitBranch | null {
  if (!root || root.kind === "leaf") return null;
  // Direct child check.
  for (const child of root.children) {
    if (child.kind === "leaf" && child.panel.id === panelId) return root;
  }
  // Recurse.
  for (const child of root.children) {
    const found = findParentSplit(child, panelId);
    if (found) return found;
  }
  return null;
}

// ── Split operations ──────────────────────────────────────────────────────

/** Direction for a drop: left/right are along a row, top/bottom along a
 *  column, center = add as a tab inside the target panel. */
export type DropSide = "left" | "right" | "top" | "bottom" | "center";

/** Create a split node from two children with equal sizes. */
function makeSplit(direction: SplitDirection, children: SplitNode[]): SplitNode {
  const n = children.length;
  const sizes = Array.from({ length: n }, () => 1 / n);
  return { kind: "split", direction, children, sizes };
}

/** Insert a panel beside a target panel in a given direction.
 *
 *  - Left/right of a panel in a row split → insert in that row.
 *  - Top/bottom of a panel in a column split → insert in that column.
 *  - Left/right of a panel in a column split (or standalone leaf) → wrap in a row split.
 *  - Top/bottom of a panel in a row split (or standalone leaf) → wrap in a column split.
 *
 *  Returns a new tree (immutable). */
export function splitPanelAt(
  root: SplitNode | null,
  targetPanelId: string,
  newPanel: Panel,
  side: DropSide,
): SplitNode {
  // If tree is empty, the new panel becomes the root leaf.
  if (!root) {
    return { kind: "leaf", panel: newPanel };
  }
  // If root is a leaf and it's the target, wrap it (or add as tab for center).
  if (root.kind === "leaf") {
    if (root.panel.id !== targetPanelId) return root; // target not found
    if (side === "center") {
      return { kind: "leaf", panel: addTabToPanelLeaf(root.panel, newPanel) };
    }
    const targetLeaf = root;
    const newLeaf: SplitNode = { kind: "leaf", panel: newPanel };
    if (side === "left" || side === "right") {
      const children = side === "left" ? [newLeaf, targetLeaf] : [targetLeaf, newLeaf];
      return makeSplit("row", children);
    }
    const children = side === "top" ? [newLeaf, targetLeaf] : [targetLeaf, newLeaf];
    return makeSplit("column", children);
  }

  // Root is a split. Recurse to find the target leaf.
  const parentSplit = findParentSplit(root, targetPanelId);
  if (!parentSplit) return root; // target not found

  // Determine the effective direction for this side.
  const wantDirection: SplitDirection = side === "left" || side === "right" ? "row" : "column";

  // Find the index of the target child within the parent.
  const targetChildIndex = parentSplit.children.findIndex(
    (child) => child.kind === "leaf" && child.panel.id === targetPanelId,
  );

  if (targetChildIndex === -1) return root; // shouldn't happen (parentSplit found it)

  // For "center" drop: add the new panel as a tab in the target leaf.
  if (side === "center") {
    const targetLeaf = parentSplit.children[targetChildIndex];
    if (targetLeaf.kind !== "leaf") return root;
    const updatedLeaf: SplitNode = { kind: "leaf", panel: addTabToPanelLeaf(targetLeaf.panel, newPanel) };
    const newChildren = [...parentSplit.children];
    newChildren[targetChildIndex] = updatedLeaf;
    return replaceSplit(root, parentSplit, { ...parentSplit, children: newChildren });
  }

  const newLeaf: SplitNode = { kind: "leaf", panel: newPanel };

  if (parentSplit.direction === wantDirection) {
    // Same direction: insert into the existing split at the right position.
    const insertIndex =
      (side === "right" || side === "bottom") ? targetChildIndex + 1 : targetChildIndex;
    const newChildren = [...parentSplit.children];
    newChildren.splice(insertIndex, 0, newLeaf);
    const n = newChildren.length;
    const newSizes = Array.from({ length: n }, () => 1 / n);
    // Deep-clone the tree with the updated split.
    return replaceSplit(root, parentSplit, {
      ...parentSplit,
      children: newChildren,
      sizes: newSizes,
    });
  }

  // Different direction: wrap the target leaf in a new split of the wanted direction.
  const targetLeaf = parentSplit.children[targetChildIndex];
  const wrappedChildren =
    side === "left" || side === "top"
      ? [newLeaf, targetLeaf]
      : [targetLeaf, newLeaf];
  const wrappedSplit = makeSplit(wantDirection, wrappedChildren);
  const newChildren = [...parentSplit.children];
  newChildren[targetChildIndex] = wrappedSplit;
  return replaceSplit(root, parentSplit, {
    ...parentSplit,
    children: newChildren,
  });
}

/** Replace a split node (by reference) in the tree. Returns a new tree. */
function replaceSplit(root: SplitNode, target: SplitNode, replacement: SplitNode): SplitNode {
  if (root === target) return replacement;
  if (root.kind === "leaf") return root;
  return {
    ...root,
    children: root.children.map((child) => replaceSplit(child, target, replacement)),
  };
}

// ── Remove / move ─────────────────────────────────────────────────────────

/** Remove a panel from the tree. Collapses splits that end up with one child.
 *  Returns the new tree (or null if it becomes empty). */
export function removePanel(root: SplitNode | null, panelId: string): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    return root.panel.id === panelId ? null : root;
  }

  // Recurse into children.
  const newChildren = root.children
    .map((child) => removePanel(child, panelId))
    .filter((child): child is SplitNode => child !== null);

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]; // collapse single-child split

  // Rebalance sizes.
  const n = newChildren.length;
  const newSizes = Array.from({ length: n }, () => 1 / n);
  return { ...root, children: newChildren, sizes: newSizes };
}

/** Move a panel from one position to another within the tree.
 *  This is a remove + re-insert: remove the panel, then insert it beside the
 *  target panel in the given side. */
export function movePanel(
  root: SplitNode | null,
  draggedId: string,
  targetPanelId: string,
  side: DropSide,
): SplitNode | null {
  if (draggedId === targetPanelId || !findPanel(root, targetPanelId)) return root;
  const panel = findPanel(root, draggedId);
  if (!panel) return root;
  const afterRemove = removePanel(root, draggedId);
  if (!findPanel(afterRemove, targetPanelId)) return root;
  return splitPanelAt(afterRemove, targetPanelId, panel, side);
}

// ── Resize ─────────────────────────────────────────────────────────────────

/** Resize a child within a split by adjusting the fractional size of the child
 *  at `childIndex` by `deltaFraction` (taken from/given to the adjacent child).
 *  Both children are clamped to MIN_SPLIT_SIZE.
 *
 *  For a split with >2 children, the delta is applied between `childIndex` and
 *  `childIndex + 1` (or `childIndex - 1` if delta is negative). */
export function resizeSplitChild(
  root: SplitNode,
  splitNode: SplitNode,
  childIndex: number,
  deltaFraction: number,
): SplitNode {
  if (root.kind === "leaf") return root;
  if (root !== splitNode) {
    return {
      ...root,
      children: root.children.map((child) =>
        resizeSplitChild(child, splitNode, childIndex, deltaFraction),
      ),
    };
  }
  // This is the target split.
  if (childIndex < 0 || childIndex >= root.children.length) return root;
  const sizes = [...root.sizes];
  const nextIndex = childIndex + 1;
  if (nextIndex >= sizes.length) return root; // can't resize last child's right

  let left = sizes[childIndex] + deltaFraction;
  let right = sizes[nextIndex] - deltaFraction;
  if (left < MIN_SPLIT_SIZE) {
    right -= MIN_SPLIT_SIZE - left;
    left = MIN_SPLIT_SIZE;
  }
  if (right < MIN_SPLIT_SIZE) {
    left -= MIN_SPLIT_SIZE - right;
    right = MIN_SPLIT_SIZE;
  }
  sizes[childIndex] = left;
  sizes[nextIndex] = right;
  return { ...root, sizes };
}

/** Equalize all sizes in a split (double-click reset). */
export function equalizeSplit(root: SplitNode, splitNode: SplitNode): SplitNode {
  if (root.kind === "leaf") return root;
  if (root !== splitNode) {
    return {
      ...root,
      children: root.children.map((child) => equalizeSplit(child, splitNode)),
    };
  }
  const n = root.children.length;
  const sizes = Array.from({ length: n }, () => 1 / n);
  return { ...root, sizes };
}

// ── History (close/reopen) ────────────────────────────────────────────────

/** Close a panel: remove from the tree, add to closedPanels.
 *  Returns the new grid state. Does NOT delete the session. */
export function closePanel(state: PanelGridState, panelId: string): PanelGridState {
  const panel = findPanel(state.root, panelId);
  if (!panel) return closeHiddenPanel(state, panelId);
  const newRoot = removePanel(state.root, panelId);
  const isDuplicate = state.closedPanels.some((p) => p.id === panelId);
  const newClosed = isDuplicate
    ? state.closedPanels
    : [{ ...panel }, ...state.closedPanels];
  const remaining = flattenPanels(newRoot);
  const newActive = remaining.length > 0 ? remaining[0].id : null;
  return { ...state, root: newRoot, activePanelId: newActive, closedPanels: newClosed };
}

/** Remove a panel from the live tree without retaining it. Used only to roll
 * back a failed resource reservation. */
export function removePanelFromGrid(state: PanelGridState, panelId: string): PanelGridState {
  if (!findPanel(state.root, panelId)) return state;
  const newRoot = removePanel(state.root, panelId);
  const remaining = flattenPanels(newRoot);
  return {
    ...state,
    root: newRoot,
    activePanelId: remaining.length > 0 ? remaining[0].id : null,
  };
}

/** Hide a visible panel while retaining its backing resource as active. */
export function hidePanel(state: PanelGridState, panelId: string): PanelGridState {
  const panel = findPanel(state.root, panelId);
  if (!panel) return state;
  const newRoot = removePanel(state.root, panelId);
  const remaining = flattenPanels(newRoot);
  return {
    ...state,
    root: newRoot,
    activePanelId: remaining[0]?.id ?? null,
    hiddenPanels: [panel, ...hiddenPanelsOf(state).filter((item) => item.id !== panel.id)],
  };
}

/** Replace the focused visible panel with an active hidden panel. The
 * displaced panel stays active hidden. */
export function replaceFocusedWithHidden(state: PanelGridState, panelId: string): PanelGridState {
  const hidden = hiddenPanelsOf(state);
  const incoming = hidden.find((panel) => panel.id === panelId);
  if (!incoming) return state;
  const focusedId = state.activePanelId ?? flattenPanels(state.root)[0]?.id ?? null;
  if (!focusedId) {
    return {
      ...state,
      root: { kind: "leaf", panel: incoming },
      activePanelId: incoming.id,
      hiddenPanels: hidden.filter((panel) => panel.id !== panelId),
    };
  }
  const displaced = findPanel(state.root, focusedId);
  if (!displaced) return state;
  const root = replacePanelLeaf(state.root, focusedId, incoming);
  return {
    ...state,
    root,
    activePanelId: incoming.id,
    hiddenPanels: [
      displaced,
      ...hidden.filter((panel) => panel.id !== panelId && panel.id !== displaced.id),
    ],
  };
}

/** Park the currently visible root when switching away: a multi-panel tree
 *  becomes an inactive linked group; a single panel becomes a hidden solo.
 *  Returns the updated group list and hidden-panel list. */
function parkCurrentRoot(
  state: PanelGridState,
): { stashedGroups: SplitNode[]; hiddenPanels: Panel[] } {
  const groups = stashedGroupsOf(state);
  const hidden = hiddenPanelsOf(state);
  if (!state.root) return { stashedGroups: groups, hiddenPanels: hidden };
  const panels = flattenPanels(state.root);
  if (panels.length > 1) {
    return { stashedGroups: [state.root, ...groups], hiddenPanels: hidden };
  }
  const solo = panels[0];
  return {
    stashedGroups: groups,
    hiddenPanels: [solo, ...hidden.filter((p) => p.id !== solo.id)],
  };
}

/** Activate a panel from anywhere — the visible tree, an inactive linked
 *  group, or the hidden-solo registry. If it is already visible, just focus
 *  it. If it belongs to an inactive group, restore that whole group and focus
 *  the clicked panel. If it is a hidden solo, show only it. The previously
 *  visible tree is parked intact (a group stays a group, a solo stays a solo),
 *  so no group is ever silently broken apart. Returns the same ref when
 *  nothing changes. */
export function activatePanel(state: PanelGridState, panelId: string): PanelGridState {
  if (findPanel(state.root, panelId)) {
    return state.activePanelId === panelId ? state : { ...state, activePanelId: panelId };
  }
  const groups = stashedGroupsOf(state);
  const targetGroup = groups.find((g) => flattenPanels(g).some((p) => p.id === panelId));
  if (targetGroup) {
    const parked = parkCurrentRoot(state);
    return {
      ...state,
      root: targetGroup,
      activePanelId: panelId,
      stashedGroups: parked.stashedGroups.filter((g) => g !== targetGroup),
      hiddenPanels: parked.hiddenPanels,
    };
  }
  const solo = hiddenPanelsOf(state).find((p) => p.id === panelId);
  if (solo) {
    const parked = parkCurrentRoot(state);
    return {
      ...state,
      root: { kind: "leaf", panel: solo },
      activePanelId: panelId,
      stashedGroups: parked.stashedGroups,
      hiddenPanels: parked.hiddenPanels.filter((p) => p.id !== solo.id),
    };
  }
  return state;
}

/** Link an active hidden panel to a specific visible panel. */
export function linkHiddenPanel(
  state: PanelGridState,
  panelId: string,
  targetPanelId: string,
  side: Exclude<DropSide, "center">,
): PanelGridState {
  const hidden = hiddenPanelsOf(state);
  const panel = hidden.find((item) => item.id === panelId);
  if (!panel || !state.root || !findPanel(state.root, targetPanelId)) return state;
  return {
    ...state,
    root: splitPanelAt(state.root, targetPanelId, panel, side),
    activePanelId: panel.id,
    hiddenPanels: hidden.filter((item) => item.id !== panelId),
  };
}

/** Split an active hidden panel beside or below the focused panel. */
export function splitHiddenPanel(
  state: PanelGridState,
  panelId: string,
  direction: "horizontal" | "vertical",
): PanelGridState {
  const hidden = hiddenPanelsOf(state);
  const panel = hidden.find((item) => item.id === panelId);
  if (!panel) return state;
  const anchorId = state.activePanelId ?? flattenPanels(state.root)[0]?.id ?? null;
  if (!anchorId || !state.root) return replaceFocusedWithHidden(state, panelId);
  const side: DropSide = direction === "horizontal" ? "right" : "bottom";
  const root = splitPanelAt(state.root, anchorId, panel, side);
  return {
    ...state,
    root,
    activePanelId: panel.id,
    hiddenPanels: hidden.filter((item) => item.id !== panelId),
  };
}

/** Move an active hidden panel to history. */
export function closeHiddenPanel(state: PanelGridState, panelId: string): PanelGridState {
  const hidden = hiddenPanelsOf(state);
  const panel = hidden.find((item) => item.id === panelId);
  if (!panel) return state;
  return {
    ...state,
    hiddenPanels: hidden.filter((item) => item.id !== panelId),
    closedPanels: state.closedPanels.some((item) => item.id === panelId)
      ? state.closedPanels
      : [panel, ...state.closedPanels],
  };
}

/** Reopen a history panel as active hidden without disturbing the layout. */
export function reopenPanelHidden(state: PanelGridState, panelId: string): PanelGridState {
  const panel = state.closedPanels.find((item) => item.id === panelId);
  if (!panel) return state;
  return {
    ...state,
    hiddenPanels: [panel, ...hiddenPanelsOf(state).filter((item) => item.id !== panelId)],
    closedPanels: state.closedPanels.filter((item) => item.id !== panelId),
  };
}

function replacePanelLeaf(root: SplitNode | null, panelId: string, replacement: Panel): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    return root.panel.id === panelId ? { kind: "leaf", panel: replacement } : root;
  }
  return {
    ...root,
    children: root.children.map((child) => replacePanelLeaf(child, panelId, replacement) ?? child),
  };
}

/** Reopen a panel from history through the checked insertion contract. The
 *  panel is removed from history only after insertion succeeds; a stale
 *  `activePanelId` is repaired to a deterministic live fallback and cannot
 *  cause a silent no-op or loss of the history entry. Returns the original
 *  state unchanged when the panel is absent or insertion fails. */
export function reopenPanel(state: PanelGridState, panelId: string): PanelGridState {
  const result = reopenPanelChecked(state, panelId);
  return result.ok ? result.state : state;
}

/** Checked variant of `reopenPanel` that reports why a re-open could not
 *  complete. The history entry is preserved on failure. */
export function reopenPanelChecked(state: PanelGridState, panelId: string): InsertPanelResult {
  const panel = state.closedPanels.find((p) => p.id === panelId);
  if (!panel) {
    return { ok: false, reason: `Panel ${panelId} is not in history.` };
  }
  // Remove from history first so `insertPanel`'s duplicate-id check does not
  // reject the panel we are re-opening.
  const withoutHistory: PanelGridState = {
    ...state,
    closedPanels: state.closedPanels.filter((p) => p.id !== panelId),
  };
  const result = insertPanel(withoutHistory, panel, { side: "right", anchorId: state.activePanelId });
  if (!result.ok) {
    // Insertion failed — preserve the history entry by returning the original state.
    return result;
  }
  return { ok: true, state: result.state };
}

/** Delete a panel permanently: remove from closedPanels. The caller handles
 *  deleting the session/terminal. */
export function deletePanelFromHistory(state: PanelGridState, panelId: string): PanelGridState {
  return {
    ...state,
    closedPanels: state.closedPanels.filter((p) => p.id !== panelId),
  };
}

// ── Serialization ──────────────────────────────────────────────────────────

/** Serialize PanelGridState to a JSON string for persistence. */
export function serializePanelGrid(state: PanelGridState): string {
  return JSON.stringify(state);
}

/** Parse a PanelGridState JSON string. Returns a normalized empty grid on
 *  null/invalid. Tree shape, panel ids, sizes, and `activePanelId` are
 *  recursively validated and repaired; see `normalizePanelGridState`. */
export function parsePanelGrid(raw: string | null | undefined): PanelGridState {
  return parsePanelGridWithDiagnostics(raw).state;
}

/** Parse and normalize a PanelGridState JSON string, returning repair
 *  diagnostics alongside the normalized state. Callers that need to surface
 *  corruption (e.g. project restore) should use this instead of
 *  `parsePanelGrid`. */
export function parsePanelGridWithDiagnostics(raw: string | null | undefined): NormalizeResult {
  if (!raw) return { state: emptyGrid(), diagnostics: [], repaired: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: emptyGrid(),
      diagnostics: [{ kind: "malformed-node", message: "Workspace grid JSON was malformed and could not be parsed." }],
      repaired: true,
    };
  }
  return normalizePanelGridState(parsed);
}

// ── Normalization & checked insertion ──────────────────────────────────────

/** A repair diagnostic emitted while normalizing a restored grid. */
export type PanelGridDiagnostic = {
  kind: "stale-active" | "duplicate-id" | "malformed-node" | "invalid-size" | "quarantined";
  message: string;
  /** The panel id the diagnostic is about, when applicable. */
  panelId?: string;
};

/** Result of normalizing a restored grid blob. `repaired` is true when any
 *  diagnostic was emitted or the state was changed from the input. */
export type NormalizeResult = {
  state: PanelGridState;
  diagnostics: PanelGridDiagnostic[];
  repaired: boolean;
};

const VALID_PANEL_TYPES: readonly PanelType[] = ["chat", "terminal", "file", "schematic", "omp"];
const SIZE_EPSILON = 0.02;

/** True when a value is a finite number at or above `MIN_SPLIT_SIZE`. */
function isValidSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_SPLIT_SIZE;
}

/** Validate a panel object. Returns a normalized `Panel` or null if the panel
 *  is structurally unusable. */
function validatePanel(raw: unknown): Panel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id.length === 0) return null;
  if (typeof p.type !== "string" || !VALID_PANEL_TYPES.includes(p.type as PanelType)) return null;
  if (typeof p.title !== "string") return null;
  const panel: Panel = {
    id: p.id,
    type: p.type as PanelType,
    title: p.title,
    chatSessionId: typeof p.chatSessionId === "string" ? p.chatSessionId : null,
    terminalId: typeof p.terminalId === "number" ? p.terminalId : null,
    filePath: typeof p.filePath === "string" ? p.filePath : null,
    createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
  };
  if (typeof p.lastUsedAt === "number") panel.lastUsedAt = p.lastUsedAt;
  if (Array.isArray(p.tabs) && p.tabs.length > 1) {
    const tabs = p.tabs.map(validateTab).filter((t): t is PanelTab => t !== null);
    if (tabs.length > 1) {
      panel.tabs = tabs;
      panel.activeTabId = typeof p.activeTabId === "string" ? p.activeTabId : tabs[0].id;
    }
  }
  return panel;
}

/** Validate a `PanelTab`. Returns null if unusable. */
function validateTab(raw: unknown): PanelTab | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || t.id.length === 0) return null;
  if (typeof t.type !== "string" || !VALID_PANEL_TYPES.includes(t.type as PanelType)) return null;
  if (typeof t.title !== "string") return null;
  return {
    id: t.id,
    type: t.type as PanelType,
    title: t.title,
    chatSessionId: typeof t.chatSessionId === "string" ? t.chatSessionId : null,
    terminalId: typeof t.terminalId === "number" ? t.terminalId : null,
    filePath: typeof t.filePath === "string" ? t.filePath : null,
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
  };
}

/** Recursively validate a split node. Drops unusable leaves, collapses
 *  single-child splits, and rebalances invalid size vectors. Records
 *  diagnostics for malformed nodes and invalid sizes. */
function validateNode(
  raw: unknown,
  seenIds: Set<string>,
  diagnostics: PanelGridDiagnostic[],
): SplitNode | null {
  if (typeof raw !== "object" || raw === null) {
    diagnostics.push({ kind: "malformed-node", message: "A grid node was not an object and was dropped." });
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (node.kind === "leaf") {
    const panel = validatePanel(node.panel);
    if (!panel) {
      diagnostics.push({ kind: "malformed-node", message: "A leaf node had an unusable panel and was dropped." });
      return null;
    }
    if (seenIds.has(panel.id)) {
      diagnostics.push({ kind: "duplicate-id", message: `Duplicate panel id ${panel.id} was quarantined; the first occurrence is kept.`, panelId: panel.id });
      return null;
    }
    seenIds.add(panel.id);
    return { kind: "leaf", panel };
  }
  if (node.kind === "split") {
    const direction = node.direction === "row" || node.direction === "column" ? node.direction : null;
    if (!direction) {
      diagnostics.push({ kind: "malformed-node", message: "A split node had an invalid direction and was dropped." });
      return null;
    }
    if (!Array.isArray(node.children)) {
      diagnostics.push({ kind: "malformed-node", message: "A split node had no children array and was dropped." });
      return null;
    }
    const children = node.children
      .map((child) => validateNode(child, seenIds, diagnostics))
      .filter((c): c is SplitNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]; // collapse single-child split
    // Validate sizes: must be a number array matching children length, each
    // ≥ MIN_SPLIT_SIZE, summing to ~1. Otherwise rebalance to equal shares.
    let sizes: number[] | null = null;
    if (Array.isArray(node.sizes) && node.sizes.length === children.length) {
      const candidate = node.sizes as unknown[];
      if (candidate.every(isValidSize)) {
        const sum = candidate.reduce((acc, v) => acc + (v as number), 0);
        if (Math.abs(sum - 1) <= SIZE_EPSILON) {
          sizes = candidate as number[];
        }
      }
    }
    if (!sizes) {
      if (Array.isArray(node.sizes) || node.sizes !== undefined) {
        diagnostics.push({ kind: "invalid-size", message: `A ${direction} split had an invalid size vector and was rebalanced.` });
      }
      sizes = Array.from({ length: children.length }, () => 1 / children.length);
    }
    return { kind: "split", direction, children, sizes };
  }
  diagnostics.push({ kind: "malformed-node", message: "A grid node had an unknown kind and was dropped." });
  return null;
}

/** Normalize a parsed grid blob (unknown shape) into a valid, repaired
 *  `PanelGridState` plus diagnostics. Backing sessions are never deleted —
 *  duplicate or unusable panels are simply dropped from the visible tree. */
export function normalizePanelGridState(input: unknown): NormalizeResult {
  const diagnostics: PanelGridDiagnostic[] = [];
  if (typeof input !== "object" || input === null) {
    return { state: emptyGrid(), diagnostics, repaired: false };
  }
  const raw = input as Record<string, unknown>;
  const seenIds = new Set<string>();
  const root = validateNode(raw.root, seenIds, diagnostics);

  // Validate active hidden panels before history. Hidden ids must be unique
  // across the visible tree, hidden registry, and closed history.
  const hiddenPanels: Panel[] = [];
  if (Array.isArray(raw.hiddenPanels)) {
    for (const entry of raw.hiddenPanels) {
      const panel = validatePanel(entry);
      if (!panel) {
        diagnostics.push({ kind: "quarantined", message: "An active hidden panel was unusable and dropped." });
        continue;
      }
      if (seenIds.has(panel.id)) {
        diagnostics.push({ kind: "duplicate-id", message: `Hidden panel ${panel.id} duplicates another active panel and was quarantined.`, panelId: panel.id });
        continue;
      }
      seenIds.add(panel.id);
      hiddenPanels.push(panel);
    }
  }

  // Validate inactive linked groups. Accept the new `stashedGroups` array and
  // migrate a legacy single `stashedRoot`. Ids must be unique across every
  // panel already seen; a group that collapses to one panel is demoted to a
  // hidden solo, and empty groups are dropped.
  const stashedGroups: SplitNode[] = [];
  const rawStashedGroups: unknown[] = Array.isArray(raw.stashedGroups)
    ? raw.stashedGroups
    : raw.stashedRoot != null
      ? [raw.stashedRoot]
      : [];
  for (const rawGroup of rawStashedGroups) {
    const tree = validateNode(rawGroup, seenIds, diagnostics);
    if (!tree) continue;
    const groupPanels = flattenPanels(tree);
    if (groupPanels.length >= 2) {
      stashedGroups.push(tree);
    } else if (groupPanels.length === 1) {
      hiddenPanels.push(groupPanels[0]);
    }
  }

  // Validate closedPanels (history). Drop unusable entries and duplicates
  // against live ids or within history — but never delete backing sessions.
  const closedPanels: Panel[] = [];
  if (Array.isArray(raw.closedPanels)) {
    for (const entry of raw.closedPanels) {
      const panel = validatePanel(entry);
      if (!panel) {
        diagnostics.push({ kind: "quarantined", message: "A closed-panel history entry was unusable and dropped from history." });
        continue;
      }
      if (seenIds.has(panel.id)) {
        diagnostics.push({ kind: "duplicate-id", message: `Closed panel ${panel.id} duplicates a live panel and was quarantined.`, panelId: panel.id });
        continue;
      }
      if (closedPanels.some((p) => p.id === panel.id)) {
        diagnostics.push({ kind: "duplicate-id", message: `Closed panel ${panel.id} appears twice in history; one copy was quarantined.`, panelId: panel.id });
        continue;
      }
      seenIds.add(panel.id);
      closedPanels.push(panel);
    }
  }

  // Repair activePanelId: must identify a live leaf, or null for an empty tree.
  const livePanels = flattenPanels(root);
  let activePanelId: string | null = null;
  const rawActive = raw.activePanelId;
  if (livePanels.length > 0) {
    const firstLive = livePanels[0].id;
    if (typeof rawActive === "string" && findPanel(root, rawActive)) {
      activePanelId = rawActive;
    } else {
      if (typeof rawActive === "string" && rawActive.length > 0) {
        diagnostics.push({ kind: "stale-active", message: `activePanelId ${rawActive} is not a live panel; repaired to ${firstLive}.`, panelId: rawActive });
      }
      activePanelId = firstLive;
    }
  } else if (typeof rawActive === "string" && rawActive.length > 0) {
    diagnostics.push({ kind: "stale-active", message: `activePanelId ${rawActive} referenced no panel in an empty tree; cleared.`, panelId: rawActive });
  }

  const state: PanelGridState = { root, activePanelId, closedPanels, hiddenPanels };
  if (stashedGroups.length > 0) state.stashedGroups = stashedGroups;
  return { state, diagnostics, repaired: diagnostics.length > 0 };
}

/** Repair `activePanelId` on an already-valid state. Used after operations
 *  that may leave a stale active pointer. Returns the same state ref if no
 *  repair was needed. */
export function repairActivePanelId(state: PanelGridState): PanelGridState {
  const live = flattenPanels(state.root);
  if (live.length === 0) {
    return state.activePanelId === null ? state : { ...state, activePanelId: null };
  }
  const firstLive = live[0].id;
  if (state.activePanelId && findPanel(state.root, state.activePanelId)) {
    return state;
  }
  return { ...state, activePanelId: firstLive };
}

/** Generate a collision-resistant panel id. Uses `crypto.randomUUID` when
 *  available; falls back to a timestamp + random suffix. Concurrent creation
 *  in the same clock tick cannot collide. */
export function newPanelId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `panel-${cryptoApi.randomUUID()}`;
  }
  return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Where to place a new panel relative to a resolved anchor. */
export type PanelPlacement = {
  side: DropSide;
  /** Optional explicit anchor panel id. If absent or not a live leaf, the
   *  helper falls back to a deterministic live leaf (first in tree order). */
  anchorId?: string | null;
};

/** Result of a checked panel insertion. A stale or missing anchor never
 *  produces a silent no-op: the helper resolves a valid fallback or reports
 *  a reason. */
export type InsertPanelResult =
  | { ok: true; state: PanelGridState }
  | { ok: false; reason: string };

/** Resolve a valid live anchor id from the current tree. Returns null only
 *  when the tree is empty. */
function resolveAnchor(root: SplitNode | null, requestedId: string | null | undefined): string | null {
  if (!root) return null;
  if (requestedId && findPanel(root, requestedId)) return requestedId;
  return flattenPanels(root)[0]?.id ?? null;
}

/** Insert a panel through one checked contract. Resolves a valid live anchor
 *  (or accepts the panel as the sole root for an empty grid), verifies the
 *  new panel appears exactly once, and returns either the new state with the
 *  panel focused or a actionable failure reason. A stale `activePanelId` /
 *  anchor cannot turn this into a silent no-op. */
export function insertPanel(state: PanelGridState, panel: Panel, placement: PanelPlacement): InsertPanelResult {
  // Reject a panel id that already exists in the visible tree, active hidden
  // registry, or history.
  if (
    findPanel(state.root, panel.id)
    || hiddenPanelsOf(state).some((item) => item.id === panel.id)
    || state.closedPanels.some((item) => item.id === panel.id)
  ) {
    return { ok: false, reason: `Panel id ${panel.id} already exists.` };
  }
  if (!state.root) {
    return {
      ok: true,
      state: {
        ...state,
        root: { kind: "leaf", panel },
        activePanelId: panel.id,
      },
    };
  }
  const anchorId = resolveAnchor(state.root, placement.anchorId);
  if (!anchorId) {
    return { ok: false, reason: "No live anchor panel is available to split beside." };
  }
  const newRoot = splitPanelAt(state.root, anchorId, panel, placement.side);
  const occurrences = flattenPanels(newRoot).filter((item) => item.id === panel.id).length;
  if (occurrences !== 1) {
    return { ok: false, reason: `Insertion did not place panel ${panel.id} exactly once (found ${occurrences}).` };
  }
  return { ok: true, state: { ...state, root: newRoot, activePanelId: panel.id } };
}

/** A backing session tab that has no reachable visible or history panel after
 *  normalization. Surfaced for non-destructive recovery; never auto-deleted. */
export type OrphanedTab = {
  /** The session tab id from the backend. */
  tabId: string;
  /** The panel id the tab was originally bound to, when known. */
  panelId?: string;
  /** The chat session id, when the tab is a chat. */
  chatSessionId?: string;
  /** The terminal id, when the tab is a terminal/omp. */
  terminalId?: number;
  kind: PanelType;
  title: string;
};

/** Detect backing session tabs that are not reachable from the normalized
 *  visible grid or history. A tab is orphaned when its panel id (or
 *  chatSessionId / terminalId binding) does not match any live or closed
 *  panel. This is non-destructive: callers must confirm before deleting. */
export function detectOrphanedTabs(state: PanelGridState, tabs: ReadonlyArray<{
  id: string;
  kind: PanelType | string;
  title: string;
  chatSessionId?: string | null;
  terminalId?: number | null;
  panelId?: string | null;
}>): OrphanedTab[] {
  const hiddenPanels = hiddenPanelsOf(state);
  const activePanels = [...flattenPanels(state.root), ...hiddenPanels];
  const liveIds = new Set(activePanels.map((p) => p.id));
  const liveChat = new Set(activePanels.map((p) => p.chatSessionId).filter((id): id is string => !!id));
  const liveTerm = new Set(activePanels.map((p) => p.terminalId).filter((id): id is number => id != null));
  const closedIds = new Set(state.closedPanels.map((p) => p.id));
  const closedChat = new Set(state.closedPanels.map((p) => p.chatSessionId).filter((id): id is string => !!id));
  const closedTerm = new Set(state.closedPanels.map((p) => p.terminalId).filter((id): id is number => id != null));
  // A `creating` panel is in the process of binding a backing tab.
  const creatingKinds = new Set(activePanels.filter((p) => p.creating).map((p) => p.type));
  const orphans: OrphanedTab[] = [];
  for (const tab of tabs) {
    const chat = tab.chatSessionId ?? null;
    const term = tab.terminalId ?? null;
    const reachable =
      (chat && (liveChat.has(chat) || closedChat.has(chat))) ||
      (term != null && (liveTerm.has(term) || closedTerm.has(term)));
    // Skip tabs whose kind matches a creating panel — binding is in flight.
    const isBinding = creatingKinds.has(tab.kind as PanelType);
    if (!reachable && !isBinding) {
      orphans.push({
        tabId: tab.id,
        panelId: tab.panelId ?? undefined,
        chatSessionId: tab.chatSessionId ?? undefined,
        terminalId: tab.terminalId ?? undefined,
        kind: tab.kind as PanelType,
        title: tab.title,
      });
    }
  }
  return orphans;
}

// ── Drag-reorder math (ported from reference IDE) ──────────────────────────

/** Clamp a value to [min, max]. */
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** A panel's measured position within a split. */
export type PanelMetric = {
  id: string;
  /** Start position (x for row, y for column). */
  start: number;
  /** Size (width for row, height for column). */
  size: number;
};

/** Drag state for a panel header drag within a split. */
export type PanelDragState = {
  draggedId: string;
  initialIndex: number;
  currentIndex: number;
  startX: number;
  currentX: number;
  moved: boolean;
  metrics: PanelMetric[];
};

/** Resolve how far a panel has been dragged, clamped to the split bounds.
 *  Ported from the reference IDE's `resolveChatDragDistance`. */
export function resolveDragDistance(state: PanelDragState): number {
  const initialMetric = state.metrics[state.initialIndex];
  const firstMetric = state.metrics[0];
  const lastMetric = state.metrics.at(-1);
  if (!initialMetric || !firstMetric || !lastMetric) return 0;
  return clamp(
    state.currentX - state.startX,
    firstMetric.start - initialMetric.start,
    lastMetric.start + lastMetric.size - initialMetric.start - initialMetric.size,
  );
}

/** Resolve the target index for a drag-reorder within a split.
 *  Ported from the reference IDE's `resolveChatDragIndex`. */
export function resolveDragIndex(state: PanelDragState): number {
  const initialMetric = state.metrics[state.initialIndex];
  if (!initialMetric) return state.initialIndex;
  const dragDistance = resolveDragDistance(state);

  if (dragDistance > 0) {
    const draggedEnd = initialMetric.start + initialMetric.size + dragDistance;
    let nextIndex = state.initialIndex;
    for (let i = state.initialIndex + 1; i < state.metrics.length; i++) {
      const m = state.metrics[i];
      if (!m || draggedEnd < m.start + m.size / 2) break;
      nextIndex = i;
    }
    return nextIndex;
  }

  if (dragDistance < 0) {
    const draggedStart = initialMetric.start + dragDistance;
    let nextIndex = state.initialIndex;
    for (let i = state.initialIndex - 1; i >= 0; i--) {
      const m = state.metrics[i];
      if (!m || draggedStart > m.start + m.size / 2) break;
      nextIndex = i;
    }
    return nextIndex;
  }

  return state.initialIndex;
}

/** Resolve the visual offset for a panel during a drag.
 *  Ported from the reference IDE's `resolveChatOffset`. */
export function resolveDragOffset(
  state: PanelDragState,
  panelId: string,
  panelIndex: number,
): number {
  if (!state.moved) return 0;
  if (panelId === state.draggedId) return resolveDragDistance(state);

  const draggedMetric = state.metrics[state.initialIndex];
  const draggedSize = draggedMetric?.size ?? 0;

  if (
    state.initialIndex < state.currentIndex &&
    panelIndex > state.initialIndex &&
    panelIndex <= state.currentIndex
  ) {
    return -draggedSize;
  }
  if (
    state.initialIndex > state.currentIndex &&
    panelIndex >= state.currentIndex &&
    panelIndex < state.initialIndex
  ) {
    return draggedSize;
  }
  return 0;
}

/** Get the IDs of panels affected by a drag (between initial and current index).
 *  Used for the "settling" animation after a reorder commits. */
export function getDragAffectedIds(state: PanelDragState): string[] {
  const start = Math.min(state.initialIndex, state.currentIndex);
  const end = Math.max(state.initialIndex, state.currentIndex);
  return state.metrics.slice(start, end + 1).map((m) => m.id);
}
/** Update a panel's fields in the tree (immutably). Returns the same root
 *  reference if no change was made. Used to set `chatSessionId` after a
 *  ChatPanel creates its session. */
export function updatePanelInTree(
  root: SplitNode | null,
  panelId: string,
  patch: Partial<Panel>,
): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    return root.panel.id === panelId
      ? { kind: "leaf", panel: { ...root.panel, ...patch } }
      : root;
  }
  const newChildren = root.children.map((c) => updatePanelInTree(c, panelId, patch)!);
  // Return same ref if nothing changed (children are referentially equal).
  const changed = newChildren.some((c, i) => c !== root.children[i]);
  return changed ? { ...root, children: newChildren } : root;
}
/** The effective type/title/session of a panel — from the active tab if
 *  multi-tab, or from the panel itself if single-tab. */
export function activeTab(panel: Panel): PanelTab {
  if (panel.tabs && panel.tabs.length > 0) {
    const tabId = panel.activeTabId;
    const tab = panel.tabs.find((t) => t.id === tabId) ?? panel.tabs[0];
    return tab;
  }
  return {
    id: panel.id,
    type: panel.type,
    title: panel.title,
    chatSessionId: panel.chatSessionId,
    terminalId: panel.terminalId,
    filePath: panel.filePath,
    createdAt: panel.createdAt,
  };
}

/** Add a tab to a panel in the tree. Returns the same root ref if no change. */
export function addTabToPanel(
  root: SplitNode | null,
  panelId: string,
  tab: PanelTab,
): SplitNode | null {
  const existing = findPanel(root, panelId);
  return updatePanelInTree(root, panelId, {
    tabs: [...(existing?.tabs ?? []), tab],
    activeTabId: tab.id,
  });
}

/** Remove a tab from a panel. If the panel has only one tab left, it
 *  becomes a single-tab panel again. If zero tabs, the panel is removed. */
export function removeTabFromPanel(
  state: PanelGridState,
  panelId: string,
  tabId: string,
): PanelGridState {
  const panel = findPanel(state.root, panelId);
  if (!panel?.tabs) return closePanel(state, panelId);
  const newTabs = panel.tabs.filter((t) => t.id !== tabId);
  if (newTabs.length === 0) {
    return closePanel(state, panelId);
  }
  if (newTabs.length === 1) {
    // Collapse back to single-tab.
    const tab = newTabs[0];
    const newRoot = updatePanelInTree(state.root, panelId, {
      ...tab,
      tabs: undefined,
      activeTabId: undefined,
    });
    return { ...state, root: newRoot };
  }
  const newActive = panel.activeTabId === tabId
    ? newTabs[0].id
    : panel.activeTabId;
  const newRoot = updatePanelInTree(state.root, panelId, {
    tabs: newTabs,
    activeTabId: newActive,
  });
  return { ...state, root: newRoot };
}

/** Reorder tabs within a panel. Moves the tab at `fromIndex` to `toIndex`. */
export function reorderTabs(
  root: SplitNode | null,
  panelId: string,
  fromIndex: number,
  toIndex: number,
): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    if (root.panel.id !== panelId) return root;
    const tabs = root.panel.tabs;
    if (!tabs || fromIndex === toIndex) return root;
    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    if (!moved) return root;
    newTabs.splice(toIndex, 0, moved);
    return { kind: "leaf", panel: { ...root.panel, tabs: newTabs } };
  }
  const newChildren = root.children.map((c) => reorderTabs(c, panelId, fromIndex, toIndex)!);
  const changed = newChildren.some((c, i) => c !== root.children[i]);
  return changed ? { ...root, children: newChildren } : root;
}

/** Set the active tab of a panel. No-op if the tab doesn't exist. */
export function setActiveTab(
  root: SplitNode | null,
  panelId: string,
  tabId: string,
): SplitNode | null {
  return updatePanelInTree(root, panelId, { activeTabId: tabId });
}

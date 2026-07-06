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
  /** Tabs hosted in this panel. If absent or length ≤ 1, the panel renders
   *  as a single panel (no tab strip). When ≥ 2, the header shows a tab
   *  strip and `activeTabId` selects the visible tab. */
  tabs?: PanelTab[];
  /** The currently visible tab id (only meaningful when `tabs` has ≥ 2). */
  activeTabId?: string | null;
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
};

/** Split direction: row = side-by-side, column = stacked vertically. */
export type SplitDirection = "row" | "column";

/** A node in the split tree: either a leaf (one panel) or a split. */
export type SplitNode =
  | { kind: "leaf"; panel: Panel }
  | { kind: "split"; direction: SplitDirection; children: SplitNode[]; sizes: number[] };
/** A split (non-leaf) node. Used as a return type where only splits are valid. */
export type SplitBranch = Extract<SplitNode, { kind: "split" }>;

/** The whole grid state: the active split tree + closed panels (history). */
export type PanelGridState = {
  root: SplitNode | null;
  activePanelId: string | null;
  closedPanels: Panel[];
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

// ── Grid constructors ──────────────────────────────────────────────────────

/** An empty grid: no panels, no active panel, empty history. */
export function emptyGrid(): PanelGridState {
  return { root: null, activePanelId: null, closedPanels: [] };
}

/** A grid seeded from a single panel (the 1×1 default). */
export function singlePanelGrid(panel: Panel): PanelGridState {
  return {
    root: { kind: "leaf", panel },
    activePanelId: panel.id,
    closedPanels: [],
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
  const panel = findPanel(root, draggedId);
  if (!panel) return root;
  const afterRemove = removePanel(root, draggedId);
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
  if (!panel) return state;
  const newRoot = removePanel(state.root, panelId);
  // Don't add to history if it's already there.
  const isDuplicate = state.closedPanels.some((p) => p.id === panelId);
  const newClosed = isDuplicate
    ? state.closedPanels
    : [{ ...panel }, ...state.closedPanels];
  // Pick a new active panel: first remaining, or null.
  const remaining = flattenPanels(newRoot);
  const newActive = remaining.length > 0 ? remaining[0].id : null;
  return { root: newRoot, activePanelId: newActive, closedPanels: newClosed };
}

/** Reopen a panel from history: remove from closedPanels, add to the grid
 *  (split-right of the active panel, or as sole panel if empty). */
export function reopenPanel(state: PanelGridState, panelId: string): PanelGridState {
  const panel = state.closedPanels.find((p) => p.id === panelId);
  if (!panel) return state;
  const newClosed = state.closedPanels.filter((p) => p.id !== panelId);
  let newRoot: SplitNode;
  if (!state.root) {
    newRoot = { kind: "leaf", panel };
  } else {
    // Split-right of the active panel (or the last panel).
    const anchorId = state.activePanelId ?? flattenPanels(state.root).at(-1)?.id;
    if (anchorId) {
      newRoot = splitPanelAt(state.root, anchorId, panel, "right");
    } else {
      newRoot = { kind: "leaf", panel };
    }
  }
  return { root: newRoot, activePanelId: panelId, closedPanels: newClosed };
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

/** Parse a PanelGridState JSON string. Returns empty grid on null/invalid. */
export function parsePanelGrid(raw: string | null | undefined): PanelGridState {
  if (!raw) return emptyGrid();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyGrid();
    // Minimal validation: root is null or a valid SplitNode.
    if (parsed.root !== null && typeof parsed.root === "object" && parsed.root.kind) {
      return parsed as PanelGridState;
    }
    return emptyGrid();
  } catch {
    return emptyGrid();
  }
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
  if (!panel?.tabs) return state;
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

/** Set the active tab of a panel. No-op if the tab doesn't exist. */
export function setActiveTab(
  root: SplitNode | null,
  panelId: string,
  tabId: string,
): SplitNode | null {
  return updatePanelInTree(root, panelId, { activeTabId: tabId });
}

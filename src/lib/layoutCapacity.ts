/**
 * Layout capacity and LRU hiding for the single-surface grid.
 *
 * Pure functions that compute whether a split/resize operation would violate
 * type-specific minimum dimensions, and deterministically hide excess leaves
 * by least-recently-focused order when the window shrinks.
 *
 * Used by split creation, restore, window resize, and splitter movement.
 * No React, no Tauri — fully unit-testable.
 */

import {
  clampRatio,
  flattenLeaves,
  isLeaf,
  MIN_RATIO,
  MAX_RATIO,
  removeSurfaceFromLayout,
  type SplitDirection,
  type SurfaceKind,
  type TreeNode,
  type WorkspaceState,
} from "./workspaceState";

// ── Capacity tokens ─────────────────────────────────────────────────────────

/** Minimum width for Chat and OMP Chat surfaces (px). */
export const MIN_WIDTH_CHAT = 440;
/** Minimum width for Terminal surfaces (px). */
export const MIN_WIDTH_TERMINAL = 320;
/** Practical minimum height for any surface (px) — header + composer + content. */
export const MIN_HEIGHT_SURFACE = 200;

/** Type-specific minimum width in pixels for a surface kind. */
export function surfaceMinWidth(kind: SurfaceKind): number {
  switch (kind) {
    case "chat":
      return MIN_WIDTH_CHAT;
    case "omp-chat":
      return MIN_WIDTH_CHAT;
    case "terminal":
      return MIN_WIDTH_TERMINAL;
  }
}

/** Type-specific minimum height in pixels for a surface kind. */
export function surfaceMinHeight(_kind: SurfaceKind): number {
  return MIN_HEIGHT_SURFACE;
}

// ── Leaf size computation ───────────────────────────────────────────────────

/** Computed pixel dimensions of a leaf surface. */
export type LeafSize = { width: number; height: number };

/** Compute the pixel width and height of every leaf in the visible tree,
 *  given the container dimensions. Ratios are applied recursively. */
export function computeLeafSizes(
  tree: TreeNode | null,
  containerWidth: number,
  containerHeight: number,
): Map<string, LeafSize> {
  const sizes = new Map<string, LeafSize>();
  if (!tree) return sizes;

  function walk(node: TreeNode, w: number, h: number): void {
    if (isLeaf(node)) {
      sizes.set(node.surfaceId, { width: w, height: h });
      return;
    }
    const firstW = node.direction === "horizontal" ? w * node.ratio : w;
    const firstH = node.direction === "vertical" ? h * node.ratio : h;
    const secondW = node.direction === "horizontal" ? w * (1 - node.ratio) : w;
    const secondH = node.direction === "vertical" ? h * (1 - node.ratio) : h;
    walk(node.first, firstW, firstH);
    walk(node.second, secondW, secondH);
  }

  walk(tree, containerWidth, containerHeight);
  return sizes;
}

// ── Split capacity check ────────────────────────────────────────────────────

/** Result of a capacity check. */
export type CapacityResult = {
  ok: boolean;
  /** Human-readable reason when ok is false. */
  reason?: string;
};

/** Check whether splitting the focused leaf in the given direction would keep
 *  both children above their type-specific minimums. The new surface's kind
 *  must be known (the caller determines it from the creation transaction). */
export function canSplit(
  state: WorkspaceState,
  direction: SplitDirection,
  newSurfaceKind: SurfaceKind,
  containerWidth: number,
  containerHeight: number,
): CapacityResult {
  // Empty tree: any single surface fits.
  if (!state.visibleTree) return { ok: true };

  const focusedId = state.focusedSurfaceId;
  if (!focusedId) return { ok: true };

  const focusedRecord = state.activeSurfaces[focusedId];
  if (!focusedRecord) return { ok: false, reason: "Focused surface not found in active registry." };

  const leafSizes = computeLeafSizes(state.visibleTree, containerWidth, containerHeight);
  const focusedSize = leafSizes.get(focusedId);
  if (!focusedSize) return { ok: false, reason: "Focused surface not in visible tree." };

  const existingMin = direction === "horizontal"
    ? surfaceMinWidth(focusedRecord.kind)
    : surfaceMinHeight(focusedRecord.kind);
  const newMin = direction === "horizontal"
    ? surfaceMinWidth(newSurfaceKind)
    : surfaceMinHeight(newSurfaceKind);

  const available = direction === "horizontal" ? focusedSize.width : focusedSize.height;
  const halfAvailable = available / 2;

  if (halfAvailable < existingMin || halfAvailable < newMin) {
    const required = Math.max(existingMin, newMin) * 2;
    const axis = direction === "horizontal" ? "width" : "height";
    return {
      ok: false,
      reason: `Not enough ${axis} to split: need ${required}px, have ${Math.round(available)}px. Use Replace focused instead.`,
    };
  }

  return { ok: true };
}

// ── LRU hiding on insufficient capacity ─────────────────────────────────────

/** Result of applying capacity-driven hiding. */
export type CapacityHidingResult = {
  state: WorkspaceState;
  /** Surface ids that were hidden, in the order they were hidden. */
  hidden: string[];
};

/** Check whether every visible leaf meets its minimum dimensions. */
export function allLeavesFit(
  state: WorkspaceState,
  containerWidth: number,
  containerHeight: number,
): boolean {
  if (!state.visibleTree) return true;
  const sizes = computeLeafSizes(state.visibleTree, containerWidth, containerHeight);
  for (const leaf of flattenLeaves(state.visibleTree)) {
    const record = state.activeSurfaces[leaf.surfaceId];
    if (!record) continue;
    const size = sizes.get(leaf.surfaceId);
    if (!size) continue;
    if (size.width < surfaceMinWidth(record.kind) - 1) return false;
    if (size.height < surfaceMinHeight(record.kind) - 1) return false;
  }
  return true;
}

/** Deterministically hide least-recently-focused nonfocused leaves until all
 *  remaining visible leaves fit within their type-specific minimums. Hidden
 *  surfaces remain active (in `activeSurfaces`) but are removed from the
 *  visible tree. The focused leaf is never hidden. */
export function applyCapacityHiding(
  state: WorkspaceState,
  containerWidth: number,
  containerHeight: number,
): CapacityHidingResult {
  let current = state;
  const hidden: string[] = [];

  while (current.visibleTree) {
    if (allLeavesFit(current, containerWidth, containerHeight)) break;

    const leaves = flattenLeaves(current.visibleTree);
    if (leaves.length <= 1) break; // never hide the last leaf

    const focusedId = current.focusedSurfaceId;
    // Candidates: nonfocused visible leaves, sorted by lastFocusedAt ascending
    // (least recently focused first).
    const candidates = leaves
      .filter((l) => l.surfaceId !== focusedId)
      .map((l) => ({ leaf: l, record: current.activeSurfaces[l.surfaceId] }))
      .filter((x) => x.record)
      .sort((a, b) => a.record.lastFocusedAt - b.record.lastFocusedAt);

    if (candidates.length === 0) break; // only the focused leaf remains

    const toHide = candidates[0].leaf.surfaceId;
    hidden.push(toHide);
    current = removeSurfaceFromLayout(current, toHide);
  }

  return { state: current, hidden };
}

// ── Splitter ratio clamping ─────────────────────────────────────────────────

/** Clamp a split ratio so that both children meet their pixel minimums.
 *  `totalPx` is the total size of the split along the split axis.
 *  `firstMinPx` and `secondMinPx` are the minimum pixel sizes of the first
 *  and second children respectively. */
export function clampRatioToPixelMinimum(
  ratio: number,
  firstMinPx: number,
  secondMinPx: number,
  totalPx: number,
): number {
  if (totalPx <= 0) return clampRatio(ratio);
  const minRatio = Math.max(MIN_RATIO, firstMinPx / totalPx);
  const maxRatio = Math.min(MAX_RATIO, 1 - secondMinPx / totalPx);
  if (minRatio > maxRatio) {
    // Both minimums can't be satisfied — clamp to the band midpoint.
    return clampRatio((minRatio + maxRatio) / 2);
  }
  return Math.min(Math.max(ratio, minRatio), maxRatio);
}

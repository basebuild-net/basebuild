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

/** Minimum width for Chat and OMP Chat surfaces (px). Kept very small so
 *  users can create arbitrary grid densities (3:2, 4:4, 1:1000, etc.). */
export const MIN_WIDTH_CHAT = 24;
/** Minimum width for Terminal surfaces (px). */
export const MIN_WIDTH_TERMINAL = 24;
/** Practical minimum height for any surface (px). */
export const MIN_HEIGHT_SURFACE = 24;

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
 *  must be known (the caller determines it from the creation transaction).
 *
 *  Arbitrary grids are allowed — the check always passes so users can create
 *  any density (3:2, 4:4, 1:1000, etc.). The splitter ratio clamping still
 *  prevents panels from reaching zero. */
export function canSplit(
  _state: WorkspaceState,
  _direction: SplitDirection,
  _newSurfaceKind: SurfaceKind,
  _containerWidth: number,
  _containerHeight: number,
): CapacityResult {
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
 *  visible tree. The focused leaf is never hidden.
 *
 *  Arbitrary grids are allowed — this function never hides surfaces. Users
 *  can create any density and panels simply shrink to fit. */
export function applyCapacityHiding(
  state: WorkspaceState,
  _containerWidth: number,
  _containerHeight: number,
): CapacityHidingResult {
  return { state, hidden: [] };
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

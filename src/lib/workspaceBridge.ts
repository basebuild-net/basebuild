/**
 * Stable bridge between the legacy `PanelGridState` (tab-based) and the new
 * `WorkspaceState` (single-surface-leaf) model.
 *
 * During the Phase 4 transition, AppShell still owns `PanelGridState` for
 * persistence and resource management. This module converts it to
 * `WorkspaceState` for the refactored `PanelGrid` renderer using **panel ids
 * as surface ids**, so the mapping is stable across re-renders (unlike
 * `migrateFromPanelGrid`, which generates fresh UUIDs).
 *
 * Non-active tabs in multi-tab panels become hidden active surfaces (tab id
 * = surface id), matching the migration semantics. File/schematic panels are
 * not workspace surfaces and are dropped from the visible tree.
 */

import { activeTab, flattenPanels, hiddenPanelsOf, type Panel, type PanelGridState, type SplitNode as LegacySplitNode } from "./panelGrid";
import {
  type LeafNode,
  type SplitDirection,
  type SurfaceKind,
  type SurfaceRecord,
  type TreeNode,
  type WorkspaceState,
} from "./workspaceState";

const WORKSPACE_VERSION = 2 as const;

/** Map a legacy PanelType to a SurfaceKind, or null when it is not a
 *  workspace surface (file/schematic). */
function panelTypeToSurfaceKind(type: Panel["type"]): SurfaceKind | null {
  switch (type) {
    case "chat":
      return "chat";
    case "omp":
      return "omp-chat";
    case "terminal":
      return "terminal";
    default:
      return null;
  }
}

/** Derive a stable surface id from a panel: the panel id for single-tab
 *  panels, or the active tab id for multi-tab panels. */
function panelSurfaceId(panel: Panel): string {
  const tab = activeTab(panel);
  return tab.id;
}

/** Build a SurfaceRecord from a panel (using its active tab). Returns null
 *  when the panel is not a workspace surface. */
function panelToSurface(panel: Panel, projectId: string, now: number): SurfaceRecord | null {
  const tab = activeTab(panel);
  const kind = panelTypeToSurfaceKind(tab.type);
  if (!kind) return null;
  const resourceId = tab.chatSessionId ?? (tab.terminalId != null ? String(tab.terminalId) : panel.id);
  return {
    id: tab.id,
    kind,
    resourceId,
    title: tab.title,
    titleLocked: false,
    projectId,
    createdAt: now,
    lastFocusedAt: now,
  };
}

/** Fold an N-ary legacy split into a binary tree. The legacy model supports
 *  2+ children; the new model is strictly binary (first/second/ratio). */
function convertLegacyNode(
  node: LegacySplitNode,
  activeSurfaces: Record<string, SurfaceRecord>,
  projectId: string,
  now: number,
  focusedPanelId: string | null,
): { tree: TreeNode | null; focusedSurfaceId: string | null } {
  if (node.kind === "leaf") {
    const surface = panelToSurface(node.panel, projectId, now);
    if (!surface) return { tree: null, focusedSurfaceId: null };
    // For multi-tab panels, register non-active tabs as hidden surfaces.
    if (node.panel.tabs && node.panel.tabs.length > 1) {
      for (const tab of node.panel.tabs) {
        if (tab.id === surface.id) continue;
        const tabKind = panelTypeToSurfaceKind(tab.type);
        if (!tabKind) continue;
        const tabResourceId = tab.chatSessionId ?? (tab.terminalId != null ? String(tab.terminalId) : tab.id);
        if (!activeSurfaces[tab.id]) {
          activeSurfaces[tab.id] = {
            id: tab.id,
            kind: tabKind,
            resourceId: tabResourceId,
            title: tab.title,
            titleLocked: false,
            projectId,
            createdAt: now,
            lastFocusedAt: now,
          };
        }
      }
    }
    if (activeSurfaces[surface.id]) {
      // Duplicate — skip (first occurrence wins).
      return { tree: null, focusedSurfaceId: null };
    }
    activeSurfaces[surface.id] = surface;
    const leaf: LeafNode = { id: `leaf-${node.panel.id}`, surfaceId: surface.id };
    const focused = focusedPanelId === node.panel.id ? surface.id : null;
    return { tree: leaf, focusedSurfaceId: focused };
  }

  // Split node: convert children, fold into binary.
  const converted = node.children
    .map((child) => convertLegacyNode(child, activeSurfaces, projectId, now, focusedPanelId))
    .filter((c): c is { tree: TreeNode; focusedSurfaceId: string | null } => c.tree !== null);

  if (converted.length === 0) return { tree: null, focusedSurfaceId: null };
  if (converted.length === 1) return { tree: converted[0].tree, focusedSurfaceId: converted[0].focusedSurfaceId };

  const direction: SplitDirection = node.direction === "row" ? "horizontal" : "vertical";
  const sizes = node.sizes.length === converted.length
    ? node.sizes
    : Array.from({ length: converted.length }, () => 1 / converted.length);

  let focusedAcc: string | null = null;

  function fold(start: number, end: number): TreeNode {
    if (end - start === 1) {
      if (converted[start].focusedSurfaceId) focusedAcc = converted[start].focusedSurfaceId;
      return converted[start].tree;
    }
    const mid = start + 1;
    const firstTree = fold(start, mid);
    const secondTree = fold(mid, end);
    const sum = sizes.slice(start, end).reduce((a, b) => a + b, 0);
    const ratio = sum > 0 ? Math.min(Math.max(sizes[start] / sum, 0.1), 0.9) : 0.5;
    return { id: `split-${start}-${end}-${Math.round(ratio * 100)}`, direction, ratio, first: firstTree, second: secondTree };
  }

  const tree = fold(0, converted.length);
  for (const child of converted) {
    if (child.focusedSurfaceId) focusedAcc = child.focusedSurfaceId;
  }
  return { tree, focusedSurfaceId: focusedAcc };
}

/** Convert a legacy `PanelGridState` to a `WorkspaceState` using stable
 *  panel/tab ids as surface ids. Closed panels become history entries. */
export function panelGridToWorkspaceState(
  legacy: PanelGridState,
  projectId: string,
): WorkspaceState {
  const now = Date.now();
  const activeSurfaces: Record<string, SurfaceRecord> = {};

  const { tree, focusedSurfaceId } = legacy.root
    ? convertLegacyNode(legacy.root, activeSurfaces, projectId, now, legacy.activePanelId)
    : { tree: null as TreeNode | null, focusedSurfaceId: null as string | null };

  // Active hidden panels remain addressable from the sidebar but do not gain
  // leaves in the visible tree.
  for (const panel of hiddenPanelsOf(legacy)) {
    const surface = panelToSurface(panel, projectId, now);
    if (surface && !activeSurfaces[surface.id]) activeSurfaces[surface.id] = surface;
  }

  // Stashed tree: a linked group that was swapped out. Its panels are active
  // surfaces (so they show in the sidebar) and the tree is passed separately
  // so the sidebar can render them as a restorable "Linked group".
  let stashedTree: TreeNode | null = null;
  if (legacy.stashedRoot) {
    const stashedResult = convertLegacyNode(legacy.stashedRoot, activeSurfaces, projectId, now, legacy.stashedActivePanelId ?? null);
    stashedTree = stashedResult.tree;
  }

  // Convert closed panels to history.
  const history = legacy.closedPanels.flatMap((panel) => {
    const surface = panelToSurface(panel, projectId, now);
    if (!surface) return [];
    return [{ ...surface, closedAt: now }];
  });

  return {
    version: WORKSPACE_VERSION,
    activeSurfaces,
    visibleTree: tree,
    focusedSurfaceId,
    stashedTree,
    history,
  };
}

/** Find the legacy panel id for a surface id across visible, hidden, stashed,
 *  and closed panels. */
export function surfaceIdToPanelId(
  legacy: PanelGridState,
  surfaceId: string,
): string | null {
  const allPanels = [
    ...flattenPanels(legacy.root),
    ...hiddenPanelsOf(legacy),
    ...(legacy.stashedRoot ? flattenPanels(legacy.stashedRoot) : []),
    ...legacy.closedPanels,
  ];
  for (const panel of allPanels) {
    if (panelSurfaceId(panel) === surfaceId) return panel.id;
  }
  return null;
}

/**
 * Sidebar surface ordering.
 *
 * The activity sidebar lists a project's surfaces grouped by their linked
 * group and ordered by recency. `buildSidebarUnits` turns a `WorkspaceState`
 * into ordered "units" — one per linked group and one per solo chat — so the
 * same view renders identically for the active project and every inactive
 * project.
 *
 * Rules:
 * - A unit's members stay contiguous (grouped chats never scatter).
 * - Units are ordered by most-recently-used first.
 * - Within a group, members keep their split-tree (on-screen) order.
 * - Each group gets a stable colour index (by earliest member creation), so a
 *   group keeps its colour regardless of where recency places it.
 *
 * The function is pure so it can be unit-tested in isolation.
 */

import { flattenLeaves, type SurfaceRecord, type TreeNode, type WorkspaceState } from "./workspaceState";

export type SidebarUnit = {
  kind: "group" | "solo";
  /** Stable colour index for group units (0, 1, 2…); -1 for solos. */
  colorIndex: number;
  /** Members, most-recently-used first. */
  surfaces: SurfaceRecord[];
  /** Max `lastFocusedAt` across members — the unit's recency. */
  recency: number;
  /** True for the unit backed by the on-screen visible tree. */
  isVisible: boolean;
};

/** Resolve a tree's leaves to their surface records (dropping any dangling). */
function leafSurfaces(tree: TreeNode | null, active: Record<string, SurfaceRecord>): SurfaceRecord[] {
  return flattenLeaves(tree)
    .map((leaf) => active[leaf.surfaceId])
    .filter((surface): surface is SurfaceRecord => Boolean(surface));
}


function earliestCreatedAt(surfaces: SurfaceRecord[]): number {
  return surfaces.reduce((min, s) => Math.min(min, s.createdAt), Number.POSITIVE_INFINITY);
}

type RawUnit = { kind: "group" | "solo"; surfaces: SurfaceRecord[]; isVisible: boolean };

export function buildSidebarUnits(state: WorkspaceState): SidebarUnit[] {
  const active = state.activeSurfaces;
  const claimed = new Set<string>();
  const raw: RawUnit[] = [];

  // The visible tree is one unit — a group when it holds 2+ leaves, else the
  // sole visible solo. It is the only unit flagged `isVisible`.
  const visible = leafSurfaces(state.visibleTree, active);
  for (const surface of visible) claimed.add(surface.id);
  if (visible.length > 0) {
    raw.push({ kind: visible.length > 1 ? "group" : "solo", surfaces: visible, isVisible: true });
  }

  // Each stashed (inactive) group is its own unit. A group that has decayed to
  // a single live surface renders as a solo.
  for (const group of state.stashedGroups ?? []) {
    const members = leafSurfaces(group, active).filter((s) => !claimed.has(s.id));
    for (const surface of members) claimed.add(surface.id);
    if (members.length >= 2) {
      raw.push({ kind: "group", surfaces: members, isVisible: false });
    } else {
      for (const surface of members) raw.push({ kind: "solo", surfaces: [surface], isVisible: false });
    }
  }

  // Every remaining active surface is a hidden solo chat.
  for (const surface of Object.values(active)) {
    if (claimed.has(surface.id)) continue;
    claimed.add(surface.id);
    raw.push({ kind: "solo", surfaces: [surface], isVisible: false });
  }

  // Assign colour indices to group units by earliest member creation so a
  // group's colour is stable even as recency reorders the display.
  const colorIndexOf = new Map<RawUnit, number>();
  raw
    .filter((u) => u.kind === "group")
    .sort((a, b) => earliestCreatedAt(a.surfaces) - earliestCreatedAt(b.surfaces))
    .forEach((u, index) => colorIndexOf.set(u, index));

  const units: SidebarUnit[] = raw.map((u) => {
    const surfaces = u.surfaces;
    return {
      kind: u.kind,
      colorIndex: u.kind === "group" ? (colorIndexOf.get(u) ?? 0) : -1,
      surfaces,
      recency: surfaces.reduce((max, s) => Math.max(max, s.lastFocusedAt), 0),
      isVisible: u.isVisible,
    };
  });

  // Most-recently-used unit first; ties broken by oldest-created for stability.
  units.sort(
    (a, b) => b.recency - a.recency || earliestCreatedAt(a.surfaces) - earliestCreatedAt(b.surfaces),
  );
  return units;
}

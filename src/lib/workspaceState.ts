/**
 * Versioned workspace state model for the production chat workspace.
 *
 * The legacy model (`PanelGridState` in `panelGrid.ts`) keeps tab arrays
 * inside each split-tree leaf. This module defines the replacement: an
 * active-surface registry decoupled from a binary visible split tree whose
 * leaves reference exactly one `surfaceId`. History is a third retained
 * collection. The whole shape is versioned (`version: 2`) so legacy blobs can
 * be migrated with rollback safety.
 *
 * The math is intentionally pure and side-effect-free so it can be unit-tested
 * in isolation. No Tauri, no React.
 */

import type { PanelGridState, Panel, PanelTab, SplitNode as LegacySplitNode } from "./panelGrid";

// ── Types ───────────────────────────────────────────────────────────────────

/** The three first-party workspace surface kinds. File/schematic panels are
 *  not workspace surfaces and are dropped (non-destructively) on migration. */
export type SurfaceKind = "chat" | "omp-chat" | "terminal";

/** A backing surface record. Identity, title, and focus/LRU metadata live
 *  here — never in the visible tree. A surface's draft/session does not
 *  depend on where it is displayed. */
export type SurfaceRecord = {
  id: string;
  kind: SurfaceKind;
  /** Backing session/PTY id. For chat this is the chat session id; for
   *  terminal/omp-chat this is the PTY id (stringified). */
  resourceId: string;
  title: string | null;
  /** True when the user manually renamed the surface; auto-title updates are
   *  suppressed while locked. */
  titleLocked: boolean;
  projectId: string;
  createdAt: number;
  lastFocusedAt: number;
};

/** A surface that was closed and retained in History. Reopen returns it
 *  active hidden without mutating the current visible tree. */
export type ClosedSurfaceRecord = SurfaceRecord & {
  closedAt: number;
};

/** Split direction for the binary visible tree. `horizontal` = side-by-side,
 *  `vertical` = stacked. (Renamed from the legacy `row`/`column` vocabulary.) */
export type SplitDirection = "horizontal" | "vertical";

/** A binary split node. The first child's fractional share is `ratio`
 *  (0..1); the second child receives `1 - ratio`. */
export type SplitNode = {
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: TreeNode;
  second: TreeNode;
};

/** A leaf node references exactly one active surface by id. */
export type LeafNode = {
  id: string;
  surfaceId: string;
};

export type TreeNode = SplitNode | LeafNode;

/** The whole workspace state. `version` is always `2` for the new model;
 *  legacy blobs (no version field) are migrated by `migrateFromPanelGrid`. */
export type WorkspaceState = {
  version: 2;
  /** Every active surface keyed by id, whether visible or hidden. */
  activeSurfaces: Record<string, SurfaceRecord>;
  /** The binary split tree of visible leaves. `null` when no surface is
   *  visible. Hidden active surfaces are absent from this tree. */
  visibleTree: TreeNode | null;
  /** The currently focused visible surface, or null when the tree is empty. */
  focusedSurfaceId: string | null;
  /** Inactive linked groups swapped out when the user activated a different
   *  chat. Clicking any surface in a group restores that whole group as the
   *  visible tree; every other group is preserved. Empty when none are stashed. */
  stashedGroups?: TreeNode[];
  /** Retained closed surfaces, newest-first. */
  history: ClosedSurfaceRecord[];
};

// ── Diagnostics ─────────────────────────────────────────────────────────────

/** A non-destructive repair diagnostic. Normalization never throws; it
 *  quarantines unusable entries and reports them here. */
export type WorkspaceDiagnostic = {
  kind:
    | "unknown-surface-kind"
    | "duplicate-surface-id"
    | "invalid-split-direction"
    | "invalid-ratio"
    | "dangling-leaf"
    | "stale-focus"
    | "quarantined"
    | "malformed-node"
    | "duplicate-history"
    | "non-surface-kind"
    | "stale-resource";
  message: string;
  surfaceId?: string;
  nodeId?: string;
};

/** Result of normalizing a workspace blob. `repaired` is true when any
 *  diagnostic was emitted or the state changed from the input. */
export type NormalizeWorkspaceResult = {
  state: WorkspaceState;
  diagnostics: WorkspaceDiagnostic[];
  repaired: boolean;
};

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_SURFACE_KINDS: readonly SurfaceKind[] = ["chat", "omp-chat", "terminal"];
export const MIN_RATIO = 0.01;
export const MAX_RATIO = 0.99;
const RATIO_EPSILON = 0.001;
const WORKSPACE_STATE_VERSION = 2 as const;

// ── Constructors ────────────────────────────────────────────────────────────

/** An empty workspace state for a project. */
export function emptyWorkspaceState(projectId: string): WorkspaceState {
  return {
    version: WORKSPACE_STATE_VERSION,
    activeSurfaces: {},
    visibleTree: null,
    focusedSurfaceId: null,
    history: [],
  };
}

/** Generate a collision-resistant surface id. */
export function newSurfaceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `surface-${cryptoApi.randomUUID()}`;
  }
  return `surface-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Generate a collision-resistant tree node id. */
export function newNodeId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `node-${cryptoApi.randomUUID()}`;
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Tree helpers ────────────────────────────────────────────────────────────

export function isLeaf(node: TreeNode): node is LeafNode {
  return !("direction" in node);
}

export function isSplit(node: TreeNode): node is SplitNode {
  return "direction" in node;
}

/** Flatten the visible tree into leaf nodes in deterministic depth-first
 *  order (first child before second). */
export function flattenLeaves(tree: TreeNode | null): LeafNode[] {
  if (!tree) return [];
  if (isLeaf(tree)) return [tree];
  return [...flattenLeaves(tree.first), ...flattenLeaves(tree.second)];
}

/** The first leaf in depth-first order, or null for an empty tree. */
export function firstLeaf(tree: TreeNode | null): LeafNode | null {
  const leaves = flattenLeaves(tree);
  return leaves.length > 0 ? leaves[0] : null;
}

/** Find the leaf referencing a surface id, or null. */
export function findLeafBySurfaceId(tree: TreeNode | null, surfaceId: string): LeafNode | null {
  return flattenLeaves(tree).find((l) => l.surfaceId === surfaceId) ?? null;
}

/** The set of surface ids that appear in the visible tree. */
export function visibleSurfaceIds(tree: TreeNode | null): Set<string> {
  return new Set(flattenLeaves(tree).map((l) => l.surfaceId));
}

/** True when a surface id is currently visible. */
export function isSurfaceVisible(state: WorkspaceState, surfaceId: string): boolean {
  return findLeafBySurfaceId(state.visibleTree, surfaceId) !== null;
}

/** Clamp a ratio into the valid [MIN_RATIO, MAX_RATIO] band. */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO);
}

// ── Validation primitives ───────────────────────────────────────────────────

/** Validate a SurfaceRecord object. Returns the normalized record or null. */
function validateSurfaceRecord(
  raw: unknown,
  key: string,
  projectId: string,
  diagnostics: WorkspaceDiagnostic[],
  validResourceIds?: ReadonlySet<string>,
): SurfaceRecord | null {
  if (typeof raw !== "object" || raw === null) {
    diagnostics.push({ kind: "quarantined", message: `Surface ${key} was not an object and was dropped.`, surfaceId: key });
    return null;
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.length > 0 ? r.id : key;
  const kind = r.kind;
  if (typeof kind !== "string" || !VALID_SURFACE_KINDS.includes(kind as SurfaceKind)) {
    diagnostics.push({ kind: "unknown-surface-kind", message: `Surface ${id} had unknown kind ${String(kind)} and was dropped.`, surfaceId: id });
    return null;
  }
  const resourceId = typeof r.resourceId === "string" && r.resourceId.length > 0 ? r.resourceId : null;
  if (resourceId === null) {
    diagnostics.push({ kind: "quarantined", message: `Surface ${id} had no resourceId and was dropped.`, surfaceId: id });
    return null;
  }
  if (validResourceIds && !validResourceIds.has(resourceId)) {
    diagnostics.push({ kind: "stale-resource", message: `Surface ${id} references resourceId ${resourceId} that is no longer live; retained non-destructively.`, surfaceId: id });
    // Non-destructive: keep the surface. The caller decides whether to hide it.
  }
  const title = typeof r.title === "string" ? r.title : null;
  const titleLocked = typeof r.titleLocked === "boolean" ? r.titleLocked : false;
  const createdAt = typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : 0;
  const lastFocusedAt = typeof r.lastFocusedAt === "number" && Number.isFinite(r.lastFocusedAt) ? r.lastFocusedAt : 0;
  return { id, kind: kind as SurfaceKind, resourceId, title, titleLocked, projectId, createdAt, lastFocusedAt };
}

/** Recursively validate a visible-tree node. Drops dangling/duplicate leaves,
 *  repairs invalid directions/ratios, and collapses single-child splits. */
function validateTreeNode(
  raw: unknown,
  activeSurfaces: ReadonlyMap<string, SurfaceRecord>,
  seenSurfaceIds: Set<string>,
  diagnostics: WorkspaceDiagnostic[],
): TreeNode | null {
  if (typeof raw !== "object" || raw === null) {
    diagnostics.push({ kind: "malformed-node", message: "A visible-tree node was not an object and was dropped." });
    return null;
  }
  const node = raw as Record<string, unknown>;
  const id = typeof node.id === "string" && node.id.length > 0 ? node.id : newNodeId();

  if (node.kind === "leaf" || (!("direction" in node) && typeof node.surfaceId === "string")) {
    const surfaceId = node.surfaceId;
    if (typeof surfaceId !== "string" || surfaceId.length === 0) {
      diagnostics.push({ kind: "malformed-node", message: `Leaf ${id} had no surfaceId and was dropped.`, nodeId: id });
      return null;
    }
    if (!activeSurfaces.has(surfaceId)) {
      diagnostics.push({ kind: "dangling-leaf", message: `Leaf ${id} references surface ${surfaceId} not in activeSurfaces and was dropped.`, surfaceId, nodeId: id });
      return null;
    }
    if (seenSurfaceIds.has(surfaceId)) {
      diagnostics.push({ kind: "duplicate-surface-id", message: `Duplicate visible surface ${surfaceId} was quarantined; the first occurrence is kept.`, surfaceId });
      return null;
    }
    seenSurfaceIds.add(surfaceId);
    return { id, surfaceId };
  }

  if (node.kind === "split" || "direction" in node) {
    const direction = node.direction === "horizontal" || node.direction === "vertical"
      ? node.direction
      : null;
    if (!direction) {
      diagnostics.push({ kind: "invalid-split-direction", message: `Split ${id} had an invalid direction and was dropped.`, nodeId: id });
      return null;
    }
    const first = validateTreeNode(node.first, activeSurfaces, seenSurfaceIds, diagnostics);
    const second = validateTreeNode(node.second, activeSurfaces, seenSurfaceIds, diagnostics);
    if (!first && !second) return null;
    if (!first) return second;
    if (!second) return first; // collapse single-child split
    let ratio = typeof node.ratio === "number" && Number.isFinite(node.ratio) ? node.ratio : 0.5;
    const clamped = clampRatio(ratio);
    if (Math.abs(clamped - ratio) > RATIO_EPSILON) {
      diagnostics.push({ kind: "invalid-ratio", message: `Split ${id} had ratio ${ratio} out of [${MIN_RATIO}, ${MAX_RATIO}] and was clamped to ${clamped}.`, nodeId: id });
      ratio = clamped;
    }
    return { id, direction, ratio, first, second };
  }

  diagnostics.push({ kind: "malformed-node", message: `Tree node ${id} had an unknown shape and was dropped.`, nodeId: id });
  return null;
}

// ── Normalization ───────────────────────────────────────────────────────────

/** Normalize a parsed workspace blob (unknown shape) into a valid, repaired
 *  `WorkspaceState` plus diagnostics. Backing sessions/PTY records are never
 *  deleted — unusable entries are quarantined (dropped from the in-memory
 *  state) and reported, not destroyed.
 *
 *  When `validResourceIds` is provided, surfaces whose `resourceId` is not in
 *  the set are flagged with a `stale-resource` diagnostic but retained. */
export function normalizeWorkspaceState(
  input: unknown,
  projectId: string,
  validResourceIds?: ReadonlySet<string>,
): NormalizeWorkspaceResult {
  const diagnostics: WorkspaceDiagnostic[] = [];
  if (typeof input !== "object" || input === null) {
    return { state: emptyWorkspaceState(projectId), diagnostics, repaired: false };
  }
  const raw = input as Record<string, unknown>;

  // Version guard: only v2 blobs are normalized here. Legacy blobs (no
  // version / version 1) are migrated by `migrateFromPanelGrid`.
  if (raw.version !== WORKSPACE_STATE_VERSION) {
    return { state: emptyWorkspaceState(projectId), diagnostics, repaired: false };
  }

  // Validate activeSurfaces.
  const activeSurfaces: Record<string, SurfaceRecord> = {};
  const activeMap = new Map<string, SurfaceRecord>();
  if (typeof raw.activeSurfaces === "object" && raw.activeSurfaces !== null) {
    for (const [key, value] of Object.entries(raw.activeSurfaces as Record<string, unknown>)) {
      const record = validateSurfaceRecord(value, key, projectId, diagnostics, validResourceIds);
      if (record) {
        activeSurfaces[record.id] = record;
        activeMap.set(record.id, record);
      }
    }
  }

  // Validate visibleTree.
  const seenSurfaceIds = new Set<string>();
  const visibleTree = validateTreeNode(raw.visibleTree, activeMap, seenSurfaceIds, diagnostics);

  // Validate history (closed surfaces).
  const history: ClosedSurfaceRecord[] = [];
  const historyIds = new Set<string>();
  if (Array.isArray(raw.history)) {
    for (const entry of raw.history) {
      if (typeof entry !== "object" || entry === null) {
        diagnostics.push({ kind: "quarantined", message: "A history entry was not an object and was dropped." });
        continue;
      }
      const e = entry as Record<string, unknown>;
      const record = validateSurfaceRecord(entry, typeof e.id === "string" ? e.id : "", projectId, diagnostics, validResourceIds);
      if (!record) continue;
      if (activeMap.has(record.id)) {
        diagnostics.push({ kind: "duplicate-history", message: `History entry ${record.id} duplicates an active surface and was quarantined.`, surfaceId: record.id });
        continue;
      }
      if (historyIds.has(record.id)) {
        diagnostics.push({ kind: "duplicate-history", message: `History entry ${record.id} appears twice; one copy was quarantined.`, surfaceId: record.id });
        continue;
      }
      const closedAt = typeof e.closedAt === "number" && Number.isFinite(e.closedAt) ? e.closedAt : 0;
      historyIds.add(record.id);
      history.push({ ...record, closedAt });
    }
  }

  const rawFocus = typeof raw.focusedSurfaceId === "string" ? raw.focusedSurfaceId : null;
  const state: WorkspaceState = {
    version: WORKSPACE_STATE_VERSION,
    activeSurfaces,
    visibleTree,
    focusedSurfaceId: rawFocus,
    history,
  };

  const repaired0: NormalizeWorkspaceResult = { state, diagnostics, repaired: diagnostics.length > 0 };
  return repairFocus(repaired0);
}

// ── Focus repair ────────────────────────────────────────────────────────────

/** Repair `focusedSurfaceId`: must identify a visible leaf, or null when the
 *  tree is empty. Returns a result with a `stale-focus` diagnostic when
 *  repair was needed. */
export function repairFocus(input: NormalizeWorkspaceResult): NormalizeWorkspaceResult {
  const { state, diagnostics } = input;
  const leaves = flattenLeaves(state.visibleTree);
  if (leaves.length === 0) {
    if (state.focusedSurfaceId !== null) {
      const repaired = [...diagnostics, {
        kind: "stale-focus" as const,
        message: `focusedSurfaceId ${state.focusedSurfaceId} referenced no visible leaf in an empty tree; cleared.`,
        surfaceId: state.focusedSurfaceId,
      }];
      return { state: { ...state, focusedSurfaceId: null }, diagnostics: repaired, repaired: true };
    }
    return input;
  }
  const focused = state.focusedSurfaceId;
  if (focused && findLeafBySurfaceId(state.visibleTree, focused)) {
    return input;
  }
  const first = leaves[0].surfaceId;
  const repaired = [...diagnostics, {
    kind: "stale-focus" as const,
    message: `focusedSurfaceId ${focused ?? "null"} is not visible; repaired to ${first}.`,
    surfaceId: focused ?? undefined,
  }];
  return { state: { ...state, focusedSurfaceId: first }, diagnostics: repaired, repaired: true };
}

// ── Serialization ───────────────────────────────────────────────────────────

/** Serialize WorkspaceState to a JSON string for persistence. */
export function serializeWorkspaceState(state: WorkspaceState): string {
  return JSON.stringify(state);
}

/** Parse and normalize a v2 WorkspaceState JSON string. Returns an empty
 *  state (no diagnostics) on null/undefined. On invalid JSON, returns an
 *  empty state with a `quarantined` diagnostic — the caller must NOT
 *  overwrite the persisted blob in that case (preserves the old blob). */
export function parseWorkspaceState(
  raw: string | null | undefined,
  projectId: string,
  validResourceIds?: ReadonlySet<string>,
): NormalizeWorkspaceResult {
  if (!raw) return { state: emptyWorkspaceState(projectId), diagnostics: [], repaired: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: emptyWorkspaceState(projectId),
      diagnostics: [{ kind: "quarantined", message: "Workspace state JSON was unparseable; the persisted blob is preserved." }],
      repaired: true,
    };
  }
  return normalizeWorkspaceState(parsed, projectId, validResourceIds);
}

// ── Legacy migration ────────────────────────────────────────────────────────

/** Map a legacy PanelType/TabKind to a SurfaceKind, or null when the legacy
 *  type is not a workspace surface (file/schematic/empty). */
export function mapLegacyKind(legacyType: string): SurfaceKind | null {
  switch (legacyType) {
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

/** Derive a resourceId from a legacy panel/tab identity. */
function legacyResourceId(tab: { chatSessionId: string | null; terminalId: number | null; id: string }): string {
  if (tab.chatSessionId) return tab.chatSessionId;
  if (tab.terminalId != null) return String(tab.terminalId);
  return tab.id;
}

/** Normalize a legacy PanelTab-like object into a PanelTab, or null. */
function normalizeLegacyTab(raw: unknown): PanelTab | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || t.id.length === 0) return null;
  if (typeof t.type !== "string") return null;
  if (typeof t.title !== "string") return null;
  return {
    id: t.id,
    type: t.type as Panel["type"],
    title: t.title,
    chatSessionId: typeof t.chatSessionId === "string" ? t.chatSessionId : null,
    terminalId: typeof t.terminalId === "number" ? t.terminalId : null,
    filePath: typeof t.filePath === "string" ? t.filePath : null,
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
  };
}

/** Collect the tabs for a legacy panel: the explicit `tabs` array when
 *  present (length ≥ 2), otherwise a single synthetic tab from the panel's
 *  own identity. Returns only tabs whose kind maps to a workspace surface. */
function legacyPanelTabs(panel: Panel, diagnostics: WorkspaceDiagnostic[]): { surfaceTabs: { tab: PanelTab; kind: SurfaceKind }[]; activeTabId: string | null } {
  let rawTabs: PanelTab[] | null = null;
  if (Array.isArray(panel.tabs) && panel.tabs.length > 1) {
    const normalized = panel.tabs.map(normalizeLegacyTab).filter((t): t is PanelTab => t !== null);
    if (normalized.length > 1) rawTabs = normalized;
  }
  let activeTabId = panel.activeTabId ?? null;
  if (!rawTabs) {
    rawTabs = [{
      id: panel.id,
      type: panel.type,
      title: panel.title,
      chatSessionId: panel.chatSessionId,
      terminalId: panel.terminalId,
      filePath: panel.filePath,
      createdAt: panel.createdAt,
    }];
    activeTabId = panel.id;
  }
  if (activeTabId && !rawTabs.some((t) => t.id === activeTabId)) activeTabId = rawTabs[0].id;
  const surfaceTabs: { tab: PanelTab; kind: SurfaceKind }[] = [];
  for (const tab of rawTabs) {
    const kind = mapLegacyKind(tab.type);
    if (!kind) {
      diagnostics.push({ kind: "non-surface-kind", message: `Legacy tab ${tab.id} of type ${tab.type} is not a workspace surface and was dropped (backing resource not deleted).`, surfaceId: tab.id });
      continue;
    }
    surfaceTabs.push({ tab, kind });
  }
  return { surfaceTabs, activeTabId };
}


/** Build a SurfaceRecord from a legacy tab entry. */
function makeRecord(
  entry: { tab: PanelTab; kind: SurfaceKind },
  projectId: string,
  baseMs: number,
  counter: { value: number },
): SurfaceRecord {
  const stamp = baseMs + counter.value;
  counter.value += 1;
  return {
    id: entry.tab.id,
    kind: entry.kind,
    resourceId: legacyResourceId(entry.tab),
    title: entry.tab.title || null,
    titleLocked: false,
    projectId,
    createdAt: stamp,
    lastFocusedAt: stamp,
  };
}

/** Migrate a legacy `PanelGridState` into a v2 `WorkspaceState`.
 *
 *  For each legacy leaf: the active tab becomes the leaf's single visible
 *  surfaceId; remaining valid tabs become `activeSurfaces` entries (hidden).
 *  Duplicate surface ids are quarantined (reported, not in state). File and
 *  schematic panels/tabs are not workspace surfaces and are dropped
 *  non-destructively. Backing sessions/PTY records are NEVER deleted — they
 *  remain in the backend and can be recovered separately. */
export function migrateFromPanelGrid(
  legacy: PanelGridState,
  projectId: string,
  validResourceIds?: ReadonlySet<string>,
): NormalizeWorkspaceResult {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const activeSurfaces: Record<string, SurfaceRecord> = {};
  const baseMs = Date.now();
  const counter = { value: 0 };

  // Migrate the visible tree.
  const { tree, focusedSurfaceId } = migrateLegacyTreeWithActive(
    legacy.root,
    legacy.activePanelId,
    projectId,
    baseMs,
    counter,
    activeSurfaces,
    diagnostics,
  );

  // Migrate closed panels into history. The active tab of a closed panel
  // becomes a history entry; its remaining tabs become active hidden surfaces
  // (non-destructive — backing sessions preserved).
  const history: ClosedSurfaceRecord[] = [];
  const historyIds = new Set<string>();
  for (const closed of legacy.closedPanels) {
    const { surfaceTabs, activeTabId } = legacyPanelTabs(closed, diagnostics);
    if (surfaceTabs.length === 0) continue;
    const activeEntry = activeTabId ? surfaceTabs.find((s) => s.tab.id === activeTabId) ?? surfaceTabs[0] : surfaceTabs[0];
    const closedAt = baseMs + counter.value;
    const activeRecord = makeRecord(activeEntry, projectId, baseMs, counter);
    if (activeSurfaces[activeRecord.id]) {
      diagnostics.push({ kind: "duplicate-history", message: `Closed panel surface ${activeRecord.id} duplicates an active surface and was quarantined.`, surfaceId: activeRecord.id });
    } else if (historyIds.has(activeRecord.id)) {
      diagnostics.push({ kind: "duplicate-history", message: `Closed panel surface ${activeRecord.id} appears twice in history; one copy was quarantined.`, surfaceId: activeRecord.id });
    } else {
      historyIds.add(activeRecord.id);
      history.push({ ...activeRecord, closedAt });
    }
    for (const entry of surfaceTabs) {
      if (entry.tab.id === activeEntry.tab.id) continue;
      const record = makeRecord(entry, projectId, baseMs, counter);
      if (!activeSurfaces[record.id] && !historyIds.has(record.id)) {
        activeSurfaces[record.id] = record;
      }
    }
  }

  // Stale-resource diagnostics (non-destructive).
  if (validResourceIds) {
    for (const record of Object.values(activeSurfaces)) {
      if (!validResourceIds.has(record.resourceId)) {
        diagnostics.push({ kind: "stale-resource", message: `Surface ${record.id} references resourceId ${record.resourceId} that is no longer live; retained non-destructively.`, surfaceId: record.id });
      }
    }
  }

  const state: WorkspaceState = {
    version: WORKSPACE_STATE_VERSION,
    activeSurfaces,
    visibleTree: tree,
    focusedSurfaceId,
    history,
  };

  // Repair focus against the migrated tree.
  const focusResult = repairFocus({ state, diagnostics, repaired: diagnostics.length > 0 });
  return { ...focusResult, repaired: focusResult.diagnostics.length > 0 };
}

/** Variant of migrateLegacyTree that receives the activePanelId directly. */
function migrateLegacyTreeWithActive(
  root: LegacySplitNode | null,
  activePanelId: string | null,
  projectId: string,
  baseMs: number,
  counter: { value: number },
  activeSurfaces: Record<string, SurfaceRecord>,
  diagnostics: WorkspaceDiagnostic[],
): { tree: TreeNode | null; focusedSurfaceId: string | null } {
  if (!root) return { tree: null, focusedSurfaceId: null };

  function convertNode(node: LegacySplitNode): { tree: TreeNode | null; focusedSurfaceId: string | null } {
    if (node.kind === "leaf") {
      const { surfaceTabs, activeTabId } = legacyPanelTabs(node.panel, diagnostics);
      if (surfaceTabs.length === 0) return { tree: null, focusedSurfaceId: null };
      const activeEntry = activeTabId ? surfaceTabs.find((s) => s.tab.id === activeTabId) ?? surfaceTabs[0] : surfaceTabs[0];
      const activeRecord = makeRecord(activeEntry, projectId, baseMs, counter);
      if (activeSurfaces[activeRecord.id]) {
        diagnostics.push({ kind: "duplicate-surface-id", message: `Duplicate surface id ${activeRecord.id} quarantined during migration; first occurrence kept.`, surfaceId: activeRecord.id });
        return { tree: null, focusedSurfaceId: null };
      }
      activeSurfaces[activeRecord.id] = activeRecord;
      for (const entry of surfaceTabs) {
        if (entry.tab.id === activeEntry.tab.id) continue;
        const record = makeRecord(entry, projectId, baseMs, counter);
        if (!activeSurfaces[record.id]) {
          activeSurfaces[record.id] = record;
        } else {
          diagnostics.push({ kind: "duplicate-surface-id", message: `Duplicate surface id ${record.id} quarantined during migration.`, surfaceId: record.id });
        }
      }
      const leaf: LeafNode = { id: newNodeId(), surfaceId: activeRecord.id };
      const focused = activePanelId === node.panel.id ? activeRecord.id : null;
      return { tree: leaf, focusedSurfaceId: focused };
    }
    const children = node.children
      .map((child) => convertNode(child))
      .filter((c): c is { tree: TreeNode; focusedSurfaceId: string | null } => c.tree !== null);
    if (children.length === 0) return { tree: null, focusedSurfaceId: null };
    if (children.length === 1) return { tree: children[0].tree, focusedSurfaceId: children[0].focusedSurfaceId };
    const sizes = node.sizes.length === children.length
      ? node.sizes
      : Array.from({ length: children.length }, () => 1 / children.length);
    const direction: SplitDirection = node.direction === "row" ? "horizontal" : "vertical";
    let focusedAcc: string | null = null;
    function fold(start: number, end: number): TreeNode {
      if (end - start === 1) {
        if (children[start].focusedSurfaceId) focusedAcc = children[start].focusedSurfaceId;
        return children[start].tree as TreeNode;
      }
      const firstTree = children[start].tree as TreeNode;
      if (children[start].focusedSurfaceId) focusedAcc = children[start].focusedSurfaceId;
      const secondTree = fold(start + 1, end);
      const sum = sizes.slice(start, end).reduce((a, b) => a + b, 0);
      const ratio = sum > 0 ? clampRatio(sizes[start] / sum) : 0.5;
      return { id: newNodeId(), direction, ratio, first: firstTree, second: secondTree };
    }
    const tree = fold(0, children.length);
    for (const child of children) {
      if (child.focusedSurfaceId) focusedAcc = child.focusedSurfaceId;
    }
    return { tree, focusedSurfaceId: focusedAcc };
  }

  return convertNode(root);
}

/** Load and normalize a workspace blob, migrating legacy `PanelGridState`
 *  blobs when the v2 `version` field is absent. This is the single entry
 *  point for restoring persisted workspace state.
 *
 *  On parse failure, returns an empty state with a `quarantined` diagnostic.
 *  The caller must NOT overwrite the persisted blob in that case — the old
 *  blob is preserved until a successful save. */
export function migrateFromLegacyBlob(
  raw: string | null | undefined,
  projectId: string,
  validResourceIds?: ReadonlySet<string>,
): NormalizeWorkspaceResult {
  if (!raw) return { state: emptyWorkspaceState(projectId), diagnostics: [], repaired: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: emptyWorkspaceState(projectId),
      diagnostics: [{ kind: "quarantined", message: "Workspace blob JSON was unparseable; the persisted blob is preserved." }],
      repaired: true,
    };
  }
  if (typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).version === WORKSPACE_STATE_VERSION) {
    return normalizeWorkspaceState(parsed, projectId, validResourceIds);
  }
  // Legacy PanelGridState blob — migrate.
  if (typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).root !== undefined) {
    const legacy = parsed as PanelGridState;
    return migrateFromPanelGrid(legacy, projectId, validResourceIds);
  }
  return {
    state: emptyWorkspaceState(projectId),
    diagnostics: [{ kind: "quarantined", message: "Workspace blob was an unrecognized shape; treated as empty." }],
    repaired: true,
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Input for creating a new surface. */
export type CreateSurfaceInput = {
  kind: SurfaceKind;
  resourceId: string;
  title: string | null;
  projectId: string;
};

/** Create a new surface record (added to `activeSurfaces`, not yet placed in
 *  the visible tree). Returns the new state and the surface id. The surface
 *  is hidden until placed via `replaceFocusedSurface` / `splitFocusedSurface`. */
export function createSurface(
  state: WorkspaceState,
  input: CreateSurfaceInput,
): { state: WorkspaceState; surfaceId: string } {
  const id = newSurfaceId();
  const now = Date.now();
  const record: SurfaceRecord = {
    id,
    kind: input.kind,
    resourceId: input.resourceId,
    title: input.title,
    titleLocked: false,
    projectId: input.projectId,
    createdAt: now,
    lastFocusedAt: now,
  };
  return {
    state: { ...state, activeSurfaces: { ...state.activeSurfaces, [id]: record } },
    surfaceId: id,
  };
}

/** Focus a visible surface. No-op (returns same ref) when the surface is not
 *  visible. Updates `lastFocusedAt` for LRU ordering. */
export function focusSurface(state: WorkspaceState, surfaceId: string): WorkspaceState {
  if (!findLeafBySurfaceId(state.visibleTree, surfaceId)) return state;
  const record = state.activeSurfaces[surfaceId];
  if (!record) return state;
  const now = Date.now();
  return {
    ...state,
    focusedSurfaceId: surfaceId,
    activeSurfaces: {
      ...state.activeSurfaces,
      [surfaceId]: { ...record, lastFocusedAt: now },
    },
  };
}

/** Replace the focused leaf's surface with `surfaceId`. The displaced surface
 *  remains active hidden. When the tree is empty, the surface becomes the
 *  sole root. Returns the same ref when `surfaceId` is already the focused
 *  surface. */
export function replaceFocusedSurface(state: WorkspaceState, surfaceId: string): WorkspaceState {
  if (!state.activeSurfaces[surfaceId]) return state;
  if (!state.visibleTree) {
    const leaf: LeafNode = { id: newNodeId(), surfaceId };
    return focusSurface({ ...state, visibleTree: leaf }, surfaceId);
  }
  if (state.focusedSurfaceId && findLeafBySurfaceId(state.visibleTree, state.focusedSurfaceId)) {
    const updated = updateLeafSurface(state.visibleTree, state.focusedSurfaceId, surfaceId);
    if (!updated) return state;
    return focusSurface({ ...state, visibleTree: updated }, surfaceId);
  }
  // Stale focus — replace the first leaf.
  const first = firstLeaf(state.visibleTree);
  if (!first) return state;
  const updated = updateLeafSurface(state.visibleTree, first.surfaceId, surfaceId);
  if (!updated) return state;
  return focusSurface({ ...state, visibleTree: updated }, surfaceId);
}

/** Split the focused leaf, placing `surfaceId` as the new second child. When
 *  the tree is empty, the surface becomes the sole root. */
export function splitFocusedSurface(
  state: WorkspaceState,
  surfaceId: string,
  direction: SplitDirection,
): WorkspaceState {
  if (!state.activeSurfaces[surfaceId]) return state;
  if (!state.visibleTree) {
    const leaf: LeafNode = { id: newNodeId(), surfaceId };
    return focusSurface({ ...state, visibleTree: leaf }, surfaceId);
  }
  const anchorSurfaceId = state.focusedSurfaceId && findLeafBySurfaceId(state.visibleTree, state.focusedSurfaceId)
    ? state.focusedSurfaceId
    : firstLeaf(state.visibleTree)?.surfaceId ?? null;
  if (!anchorSurfaceId) return state;
  const newLeaf: LeafNode = { id: newNodeId(), surfaceId };
  const updated = replaceLeafWithSplit(state.visibleTree, anchorSurfaceId, direction, newLeaf);
  if (!updated) return state;
  return focusSurface({ ...state, visibleTree: updated }, surfaceId);
}

/** Remove a surface from the visible tree (hide). The surface remains active
 *  hidden. Repairs focus to the first remaining visible leaf. */
export function removeSurfaceFromLayout(state: WorkspaceState, surfaceId: string): WorkspaceState {
  if (!findLeafBySurfaceId(state.visibleTree, surfaceId)) return state;
  const tree = removeFromTree(state.visibleTree, surfaceId);
  let next: WorkspaceState = { ...state, visibleTree: tree };
  const leaves = flattenLeaves(tree);
  if (leaves.length === 0 || !findLeafBySurfaceId(tree, state.focusedSurfaceId ?? "")) {
    next = { ...next, focusedSurfaceId: leaves.length > 0 ? leaves[0].surfaceId : null };
  }
  return next;
}

/** Close a surface: remove from the visible tree + activeSurfaces and append
 *  to history. The backing session/PTY is NOT deleted (caller handles that
 *  separately). Repairs focus. */
export function closeSurface(state: WorkspaceState, surfaceId: string): WorkspaceState {
  const record = state.activeSurfaces[surfaceId];
  if (!record) return state;
  const tree = removeFromTree(state.visibleTree, surfaceId);
  const remaining = { ...state.activeSurfaces };
  delete remaining[surfaceId];
  const closedAt = Date.now();
  const historyEntry: ClosedSurfaceRecord = { ...record, closedAt };
  // Avoid duplicate history entries.
  const history = state.history.some((h) => h.id === surfaceId)
    ? state.history
    : [historyEntry, ...state.history];
  let next: WorkspaceState = { ...state, visibleTree: tree, activeSurfaces: remaining, history };
  const leaves = flattenLeaves(tree);
  next = { ...next, focusedSurfaceId: leaves.length > 0 ? leaves[0].surfaceId : null };
  return next;
}

/** Reopen a surface from history as active hidden (not placed in the visible
 *  tree — the current layout is preserved). Returns the same ref when the
 *  surface is not in history or is already active. */
export function reopenSurface(state: WorkspaceState, surfaceId: string): WorkspaceState {
  const entry = state.history.find((h) => h.id === surfaceId);
  if (!entry) return state;
  if (state.activeSurfaces[surfaceId]) return state;
  const { closedAt: _closedAt, ...record } = entry;
  void _closedAt;
  const history = state.history.filter((h) => h.id !== surfaceId);
  return {
    ...state,
    activeSurfaces: { ...state.activeSurfaces, [surfaceId]: record },
    history,
  };
}

/** Permanently delete a surface from history. The caller handles deleting the
 *  backing session/PTY. */
export function deleteSurfaceFromHistory(state: WorkspaceState, surfaceId: string): WorkspaceState {
  if (!state.history.some((h) => h.id === surfaceId)) return state;
  return { ...state, history: state.history.filter((h) => h.id !== surfaceId) };
}
// ── Tree mutation helpers ───────────────────────────────────────────────────

/** Immutably replace the surfaceId of the leaf referencing `oldSurfaceId`.
 *  Returns null when the leaf is not found. */
function updateLeafSurface(tree: TreeNode | null, oldSurfaceId: string, newSurfaceId: string): TreeNode | null {
  if (!tree) return null;
  if (isLeaf(tree)) {
    return tree.surfaceId === oldSurfaceId ? { ...tree, surfaceId: newSurfaceId } : tree;
  }
  const first = updateLeafSurface(tree.first, oldSurfaceId, newSurfaceId);
  const second = updateLeafSurface(tree.second, oldSurfaceId, newSurfaceId);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first: first as TreeNode, second: second as TreeNode };
}

/** Immutably replace the leaf referencing `surfaceId` with a split containing
 *  the old leaf (first) and `newLeaf` (second). Returns null when not found. */
function replaceLeafWithSplit(
  tree: TreeNode | null,
  surfaceId: string,
  direction: SplitDirection,
  newLeaf: LeafNode,
): TreeNode | null {
  if (!tree) return null;
  if (isLeaf(tree)) {
    if (tree.surfaceId !== surfaceId) return tree;
    return { id: newNodeId(), direction, ratio: 0.5, first: tree, second: newLeaf };
  }
  const first = replaceLeafWithSplit(tree.first, surfaceId, direction, newLeaf);
  const second = replaceLeafWithSplit(tree.second, surfaceId, direction, newLeaf);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first: first as TreeNode, second: second as TreeNode };
}

/** Immutably remove the leaf referencing `surfaceId`. Collapses splits that
 *  end up with one child. Returns null when the tree becomes empty. */
function removeFromTree(tree: TreeNode | null, surfaceId: string): TreeNode | null {
  if (!tree) return null;
  if (isLeaf(tree)) {
    return tree.surfaceId === surfaceId ? null : tree;
  }
  const first = removeFromTree(tree.first, surfaceId);
  const second = removeFromTree(tree.second, surfaceId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}
/** Immutably adjust the ratio of the split whose first child's subtree
 *  contains `firstChildSurfaceId`. `deltaPx` is a signed pixel delta
 *  relative to `viewportSize`; positive grows the first child. The ratio
 *  is clamped to [MIN_RATIO, MAX_RATIO]. Returns the same ref when the
 *  surface is not found or the delta is zero. */
export function resizeSplitByPixels(
  state: WorkspaceState,
  firstChildSurfaceId: string,
  deltaPx: number,
  viewportSize: number,
): WorkspaceState {
  if (!state.visibleTree || viewportSize <= 0 || deltaPx === 0) return state;
  const updated = resizeSplitNode(state.visibleTree, firstChildSurfaceId, deltaPx, viewportSize);
  if (!updated || updated === state.visibleTree) return state;
  return { ...state, visibleTree: updated };
}

/** Immutably set the ratio of the split whose first child's subtree
 *  contains `firstChildSurfaceId` to 0.5 (equal). Returns the same ref
 *  when the surface is not found. */
export function equalizeSplit(state: WorkspaceState, firstChildSurfaceId: string): WorkspaceState {
  if (!state.visibleTree) return state;
  const updated = equalizeSplitNode(state.visibleTree, firstChildSurfaceId);
  if (!updated || updated === state.visibleTree) return state;
  return { ...state, visibleTree: updated };
}

/** True when `surfaceId` appears anywhere in the subtree. */
function subtreeContains(node: TreeNode, surfaceId: string): boolean {
  return flattenLeaves(node).some((l) => l.surfaceId === surfaceId);
}

/** Find the split whose first child contains `firstChildSurfaceId` and adjust
 *  its ratio by a pixel delta. Returns null when not found; the same ref when
 *  the clamped ratio is unchanged. */
function resizeSplitNode(
  tree: TreeNode,
  firstChildSurfaceId: string,
  deltaPx: number,
  viewportSize: number,
): TreeNode | null {
  if (isLeaf(tree)) return null;
  if (subtreeContains(tree.first, firstChildSurfaceId)) {
    const deltaRatio = deltaPx / viewportSize;
    const ratio = clampRatio(tree.ratio + deltaRatio);
    if (Math.abs(ratio - tree.ratio) < 0.001) return tree;
    return { ...tree, ratio };
  }
  const first = resizeSplitNode(tree.first, firstChildSurfaceId, deltaPx, viewportSize);
  if (first && first !== tree.first) return { ...tree, first };
  const second = resizeSplitNode(tree.second, firstChildSurfaceId, deltaPx, viewportSize);
  if (second && second !== tree.second) return { ...tree, second };
  return null;
}

/** Find the split whose first child contains `firstChildSurfaceId` and reset
 *  its ratio to 0.5. Returns null when not found; the same ref when already
 *  0.5. */
function equalizeSplitNode(
  tree: TreeNode,
  firstChildSurfaceId: string,
): TreeNode | null {
  if (isLeaf(tree)) return null;
  if (subtreeContains(tree.first, firstChildSurfaceId)) {
    if (Math.abs(tree.ratio - 0.5) < 0.001) return tree;
    return { ...tree, ratio: 0.5 };
  }
  const first = equalizeSplitNode(tree.first, firstChildSurfaceId);
  if (first && first !== tree.first) return { ...tree, first };
  const second = equalizeSplitNode(tree.second, firstChildSurfaceId);
  if (second && second !== tree.second) return { ...tree, second };
  return null;
}

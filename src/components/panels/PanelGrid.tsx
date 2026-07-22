import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { MessageSquare } from "lucide-react";
import {
  flattenLeaves,
  isLeaf,
  isSplit,
  type SplitDirection,
  type SplitNode,
  type SurfaceKind,
  type SurfaceRecord,
  type TreeNode,
  type WorkspaceState,
} from "../../lib/workspaceState";
import {
  allLeavesFit,
  applyCapacityHiding,
  canSplit,
  clampRatioToPixelMinimum,
  computeLeafSizes,
  surfaceMinWidth,
  surfaceMinHeight,
  type LeafSize,
} from "../../lib/layoutCapacity";
import { PanelSplitter } from "./PanelSplitter";
import { PanelHeader } from "./PanelHeader";

export type PanelGridProps = {
  /** The workspace state (active registry + visible split tree). */
  state: WorkspaceState;
  /** Render a surface's content by surface record. */
  renderSurface: (surface: SurfaceRecord, isActive: boolean) => React.ReactNode;
  /** Focus a visible surface. */
  onFocusSurface: (surfaceId: string) => void;
  /** Close a surface (moves to history). */
  onCloseSurface: (surfaceId: string) => void;
  /** Split the focused surface in the given direction. The parent creates
   *  the backing resource and updates the state. */
  onSplitFocused: (direction: SplitDirection) => void;
  /** Duplicate a surface. */
  onDuplicate: (surfaceId: string) => void;
  /** Resize a split: the first child's surface id + pixel delta. Positive
   *  delta grows the first child. */
  onResize: (firstChildSurfaceId: string, deltaPx: number) => void;
  /** Equalize a split containing the given first child surface id. */
  onEqualize: (firstChildSurfaceId: string) => void;
  /** Viewport width for capacity calculations. */
  viewportWidth: number;
  viewportHeight: number;
  /** Chat session IDs hosting background agents (for minimize button). */
  backgroundChatSessionIds?: Set<string>;
  /** The kind of surface that a split would create (for capacity checks).
   *  Defaults to "chat" (the most restrictive minimum). */
  newSurfaceKind?: SurfaceKind;
};

export function PanelGrid(props: PanelGridProps) {
  const {
    state,
    renderSurface,
    onFocusSurface,
    onCloseSurface,
    onSplitFocused,
    onDuplicate,
    onResize,
    onEqualize,
    viewportWidth,
    viewportHeight,
    backgroundChatSessionIds,
    newSurfaceKind = "chat",
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);

  // ── LRU hiding on insufficient capacity ──
  // Apply capacity hiding deterministically. Hidden surfaces remain active
  // but are removed from the visible tree. This is computed each render from
  // the incoming state + viewport — it does not mutate the parent's state.
  const capacityResult = useMemo(() => {
    return applyCapacityHiding(state, viewportWidth, viewportHeight);
  }, [state, viewportWidth, viewportHeight]);

  // Log hidden surfaces for debugging.
  const hiddenLogRef = useRef<string[]>([]);
  useEffect(() => {
    if (capacityResult.hidden.length > 0) {
      const prev = hiddenLogRef.current;
      const newlyHidden = capacityResult.hidden.filter((id) => !prev.includes(id));
      if (newlyHidden.length > 0) {
        console.debug("[PanelGrid] LRU hidden surfaces (insufficient capacity):", newlyHidden);
      }
    }
    hiddenLogRef.current = capacityResult.hidden;
  }, [capacityResult.hidden]);

  const effectiveState = capacityResult.state;

  // ── Capacity check for split operations ──
  const splitCapacity = useMemo(() => {
    return canSplit(effectiveState, "horizontal", newSurfaceKind, viewportWidth, viewportHeight);
  }, [effectiveState, newSurfaceKind, viewportWidth, viewportHeight]);

  const splitCapacityV = useMemo(() => {
    return canSplit(effectiveState, "vertical", newSurfaceKind, viewportWidth, viewportHeight);
  }, [effectiveState, newSurfaceKind, viewportWidth, viewportHeight]);

  const splitDisabled = !splitCapacity.ok && !splitCapacityV.ok;
  const splitDisabledReason = splitCapacity.reason ?? splitCapacityV.reason;

  // ── Handlers ──
  const handleFocus = useCallback((surfaceId: string) => {
    onFocusSurface(surfaceId);
  }, [onFocusSurface]);

  const handleClose = useCallback((surfaceId: string) => {
    onCloseSurface(surfaceId);
  }, [onCloseSurface]);

  const handleSplitRight = useCallback(() => {
    if (!canSplit(effectiveState, "horizontal", newSurfaceKind, viewportWidth, viewportHeight).ok) {
      console.debug("[PanelGrid] Split right rejected — insufficient capacity");
      return;
    }
    onSplitFocused("horizontal");
  }, [effectiveState, newSurfaceKind, viewportWidth, viewportHeight, onSplitFocused]);

  const handleSplitDown = useCallback(() => {
    if (!canSplit(effectiveState, "vertical", newSurfaceKind, viewportWidth, viewportHeight).ok) {
      console.debug("[PanelGrid] Split down rejected — insufficient capacity");
      return;
    }
    onSplitFocused("vertical");
  }, [effectiveState, newSurfaceKind, viewportWidth, viewportHeight, onSplitFocused]);

  const handleDuplicate = useCallback((surfaceId: string) => {
    onDuplicate(surfaceId);
  }, [onDuplicate]);

  // ── Splitter resize ──
  // Find the split node containing a leaf with the given surface id, and
  // return the split node + whether the surface is the first child.
  const findSplitForSurface = useCallback(
    (tree: TreeNode | null, surfaceId: string): { split: SplitNode; isFirst: boolean } | null => {
      function walk(node: TreeNode | null): { split: SplitNode; isFirst: boolean } | null {
        if (!node || isLeaf(node)) return null;
        if (isLeaf(node.first) && node.first.surfaceId === surfaceId) {
          return { split: node, isFirst: true };
        }
        if (isLeaf(node.second) && node.second.surfaceId === surfaceId) {
          return { split: node, isFirst: false };
        }
        return walk(node.first) ?? walk(node.second);
      }
      return walk(tree);
    },
    [],
  );

  const handleSplitterDelta = useCallback(
    (firstChildSurfaceId: string, deltaPx: number) => {
      onResize(firstChildSurfaceId, deltaPx);
    },
    [onResize],
  );

  // ── Empty state ──
  if (!effectiveState.visibleTree) {
    return (
      <div className="panel-grid">
        <div className="panel-grid-empty">
          <MessageSquare size={32} className="text-muted" />
          <h3>No surfaces open</h3>
          <p>Start a chat or open a terminal to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-grid" ref={containerRef}>
      {renderNode(effectiveState.visibleTree, effectiveState, 0)}
    </div>
  );

  /** Recursively render a split tree node. */
  function renderNode(node: TreeNode, ws: WorkspaceState, depth: number): React.ReactNode {
    if (isLeaf(node)) {
      const surface = ws.activeSurfaces[node.surfaceId];
      const isActive = ws.focusedSurfaceId === node.surfaceId;
      if (!surface) {
        console.debug("[PanelGrid] Leaf references missing surface:", node.surfaceId);
        return null;
      }

      const isBackgroundAgent = surface.kind === "chat"
        && backgroundChatSessionIds?.has(surface.resourceId);

      return (
        <div
          key={node.id}
          className={`panel-grid-leaf${isActive ? " is-active" : ""}`}
          data-surface-id={node.surfaceId}
        >
          <PanelHeader
            surface={surface}
            isActive={isActive}
            onFocus={() => handleFocus(node.surfaceId)}
            onClose={() => handleClose(node.surfaceId)}
            onSplitRight={handleSplitRight}
            onSplitDown={handleSplitDown}
            onDuplicate={() => handleDuplicate(node.surfaceId)}
            minimizable={isBackgroundAgent}
            splitDisabled={splitDisabled}
            splitDisabledReason={splitDisabledReason}
          />
          <div className="panel-grid-content">
            {renderSurface(surface, isActive)}
          </div>
        </div>
      );
    }

    // Split node.
    const isHorizontal = node.direction === "horizontal";
    const firstLeaf = firstLeafSurfaceId(node.first);
    const firstSize = computeLeafSizes(node, viewportWidth, viewportHeight);
    const firstLeafSize = firstLeaf ? firstSize.get(firstLeaf) : undefined;

    // Compute aria value for splitter.
    const ratio = node.ratio;
    const splitMin = 0.1;
    const splitMax = 0.9;

    return (
      <div
        key={node.id}
        className={`panel-grid-split is-${node.direction}`}
        style={{ "--bb-split-ratio": `${ratio * 100}%` } as CSSProperties}
      >
        <div className="panel-grid-split-child is-first">
          {renderNode(node.first, ws, depth + 1)}
        </div>
        <PanelSplitter
          orientation={isHorizontal ? "vertical" : "horizontal"}
          onDelta={(deltaPx) => handleSplitterDelta(firstLeaf ?? "", deltaPx)}
          onEqualize={() => {
            if (firstLeaf) onEqualize(firstLeaf);
          }}
          value={ratio}
          min={splitMin}
          max={splitMax}
        />
        <div className="panel-grid-split-child is-second">
          {renderNode(node.second, ws, depth + 1)}
        </div>
      </div>
    );
  }
}

/** Find the first leaf surface id in a subtree (depth-first). */
function firstLeafSurfaceId(node: TreeNode): string | null {
  if (isLeaf(node)) return node.surfaceId;
  return firstLeafSurfaceId(node.first) ?? firstLeafSurfaceId(node.second);
}

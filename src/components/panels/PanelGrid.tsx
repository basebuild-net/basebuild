import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  /** Move a visible surface beside another visible surface. */
  onMoveSurface: (surfaceId: string, targetSurfaceId: string, side: DropSide) => void;
  /** Detach a visible surface from the linked layout without closing it. */
  onUnlinkSurface: (surfaceId: string) => void;
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
  /** Explicit empty-state action. */
  onAddChat?: () => void;
};

export function PanelGrid(props: PanelGridProps) {
  const {
    state,
    renderSurface,
    onFocusSurface,
    onCloseSurface,
    onSplitFocused,
    onMoveSurface,
    onUnlinkSurface,
    onResize,
    onEqualize,
    viewportWidth,
    viewportHeight,
    backgroundChatSessionIds,
    newSurfaceKind = "chat",
    onAddChat,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<{ surfaceId: string; side: DropSide } | null>(null);
  const dropTargetRef = useRef<{ surfaceId: string; side: DropSide } | null>(null);
  const pointerDragRef = useRef<{
    sourceId: string;
    startX: number;
    startY: number;
    pointerId: number;
    active: boolean;
  } | null>(null);

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


  const updateDropTarget = useCallback((target: { surfaceId: string; side: DropSide } | null) => {
    dropTargetRef.current = target;
    setDropTarget(target);
  }, []);

  const targetAtPoint = useCallback((clientX: number, clientY: number, sourceId: string) => {
    const element = document.elementFromPoint(clientX, clientY);
    const leaf = element?.closest<HTMLElement>(".panel-grid-leaf");
    const surfaceId = leaf?.dataset.surfaceId;
    if (!leaf || !surfaceId || surfaceId === sourceId) {
      updateDropTarget(null);
      return;
    }
    const rect = leaf.getBoundingClientRect();
    const distances: Array<[DropSide, number]> = [
      ["left", clientX - rect.left],
      ["right", rect.right - clientX],
      ["top", clientY - rect.top],
      ["bottom", rect.bottom - clientY],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    updateDropTarget({ surfaceId, side: distances[0]?.[0] ?? "right" });
  }, [updateDropTarget]);

  const finishPointerDrag = useCallback((clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    pointerDragRef.current = null;
    delete document.body.dataset.surfaceDragging;
    if (!drag?.active) {
      updateDropTarget(null);
      return;
    }
    const element = document.elementFromPoint(clientX, clientY);
    if (element?.closest("[data-surface-unlink-dropzone]")) {
      onUnlinkSurface(drag.sourceId);
      updateDropTarget(null);
      return;
    }
    const sidebarTarget = element?.closest<HTMLElement>(".surface-row.is-visible")?.dataset.surfaceId
      ?? element?.closest<HTMLElement>(".surface-row.is-hidden")?.dataset.surfaceId;
    if (sidebarTarget && sidebarTarget !== drag.sourceId) {
      onMoveSurface(drag.sourceId, sidebarTarget, "right");
      updateDropTarget(null);
      return;
    }
    const target = dropTargetRef.current;
    if (target && target.surfaceId !== drag.sourceId) {
      onMoveSurface(drag.sourceId, target.surfaceId, target.side);
    }
    updateDropTarget(null);
  }, [onMoveSurface, onUnlinkSurface, updateDropTarget]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      if (!drag.active) {
        drag.active = true;
        document.body.dataset.surfaceDragging = "true";
      }
      targetAtPoint(event.clientX, event.clientY, drag.sourceId);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      finishPointerDrag(event.clientX, event.clientY);
    };
    const handlePointerCancel = () => {
      pointerDragRef.current = null;
      delete document.body.dataset.surfaceDragging;
      updateDropTarget(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      delete document.body.dataset.surfaceDragging;
    };
  }, [finishPointerDrag, targetAtPoint, updateDropTarget]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, surfaceId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = {
      sourceId: surfaceId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      active: false,
    };
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, targetSurfaceId: string) => {
    if (!event.dataTransfer.types.includes("text/plain")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const distances: Array<[DropSide, number]> = [
      ["left", event.clientX - rect.left],
      ["right", rect.right - event.clientX],
      ["top", event.clientY - rect.top],
      ["bottom", rect.bottom - event.clientY],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    updateDropTarget({ surfaceId: targetSurfaceId, side: distances[0]?.[0] ?? "right" });
  }, [updateDropTarget]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>, targetSurfaceId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain")
      || event.dataTransfer.getData("application/x-basebuild-surface");
    const side = dropTargetRef.current?.surfaceId === targetSurfaceId ? dropTargetRef.current.side : "right";
    updateDropTarget(null);
    if (!sourceId || sourceId === targetSurfaceId) return;
    onMoveSurface(sourceId, targetSurfaceId, side);
  }, [onMoveSurface, updateDropTarget]);

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
          <h3>No chat windows open</h3>
          <p>Add a chat window or reopen one from History.</p>
          {onAddChat ? (
            <button className="btn btn-primary" type="button" title="Add chat window" onClick={onAddChat}>
              Add chat window
            </button>
          ) : null}
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
          onDragEnter={(event) => handleDragOver(event, node.surfaceId)}
          onDragOver={(event) => handleDragOver(event, node.surfaceId)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateDropTarget(null);
          }}
          onDrop={(event) => handleDrop(event, node.surfaceId)}
        >
          <PanelHeader
            surface={surface}
            isActive={isActive}
            onFocus={() => handleFocus(node.surfaceId)}
            onClose={() => handleClose(node.surfaceId)}
            onSplitRight={handleSplitRight}
            onSplitDown={handleSplitDown}
            onPointerDown={(event) => handlePointerDown(event, node.surfaceId)}
            minimizable={isBackgroundAgent}
            splitDisabled={splitDisabled}
            splitDisabledReason={splitDisabledReason}
          />
          {dropTarget?.surfaceId === node.surfaceId ? (
            <div className={`panel-drop-zone is-${dropTarget.side}`} aria-hidden="true" />
          ) : null}
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
    const splitMin = 0.01;
    const splitMax = 0.99;

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

type DropSide = "left" | "right" | "top" | "bottom";

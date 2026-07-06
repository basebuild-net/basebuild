import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { MessageSquare, Plus, TerminalSquare } from "lucide-react";
import {
  closePanel,
  equalizeSplit,
  findParentSplit,
  flattenPanels,
  movePanel,
  removePanel,
  resizeSplitChild,
  resolveDragIndex,
  resolveDragOffset,
  getDragAffectedIds,
  splitPanelAt,
  type DropSide,
  type Panel,
  type PanelGridState,
  type PanelMetric,
  type SplitBranch,
  type SplitDirection,
  type SplitNode,
} from "../../lib/panelGrid";
import { PanelSplitter, PANEL_MIN_SIZE_PX } from "./PanelSplitter";
import { PanelHeader } from "./PanelHeader";
import { usePanelStatus } from "./PanelStatusContext";

const DRAG_THRESHOLD_PX = 4;
const CLOSE_ANIMATION_MS = 180;
const REPOSITION_SUPPRESSION_MS = 420;

export type PanelGridProps = {
  state: PanelGridState;
  onStateChange: (state: PanelGridState) => void;
  /** Render a panel's content by panel id. The caller owns mounting. */
  renderPanel: (panel: Panel, isActive: boolean) => React.ReactNode;
  /** Called when a panel is created (split/duplicate). Returns the new panel. */
  onCreatePanel: (anchorId: string | null, side: DropSide) => Panel;
  /** Viewport width for size calculations. 0 = use default. */
  viewportWidth: number;
  /** Viewport height for size calculations. 0 = use default. */
  viewportHeight: number;
};

type DragState = {
  draggedId: string;
  initialIndex: number;
  currentIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
  pointerId: number;
  /** Metrics for the split the dragged panel is in. */
  splitMetrics: PanelMetric[];
  splitDirection: SplitDirection;
  /** The split node the dragged panel belongs to. */
  splitNode: SplitBranch;
  /** Drop target during a split-drag (null = reorder mode). */
  dropTarget: { panelId: string; side: DropSide } | null;
};

export function PanelGrid(props: PanelGridProps) {
  const { state, onStateChange, renderPanel, onCreatePanel, viewportWidth, viewportHeight } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement>>({});
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const closeTimersRef = useRef<Record<string, number>>({});
  const settlingTimerRef = useRef<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const [settlingIds, setSettlingIds] = useState<string[]>([]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      if (settlingTimerRef.current) window.clearTimeout(settlingTimerRef.current);
      for (const id of Object.values(closeTimersRef.current)) {
        window.clearTimeout(id);
      }
    };
  }, []);

  const allPanels = useMemo(() => flattenPanels(state.root), [state.root]);

  // ── Panel operations ──
  const handleSplit = useCallback(
    (anchorId: string, side: DropSide) => {
      const newPanel = onCreatePanel(anchorId, side);
      const newRoot = splitPanelAt(state.root, anchorId, newPanel, side);
      onStateChange({ ...state, root: newRoot, activePanelId: newPanel.id });
    },
    [state, onStateChange, onCreatePanel],
  );

  const handleClose = useCallback(
    (panelId: string) => {
      if (closingIds.has(panelId)) return;
      setClosingIds((prev) => new Set(prev).add(panelId));
      if (closeTimersRef.current[panelId]) {
        window.clearTimeout(closeTimersRef.current[panelId]);
      }
      closeTimersRef.current[panelId] = window.setTimeout(() => {
        delete closeTimersRef.current[panelId];
        const newState = closePanel(state, panelId);
        onStateChange(newState);
        setClosingIds((prev) => {
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        });
      }, CLOSE_ANIMATION_MS);
    },
    [state, onStateChange, closingIds],
  );

  const handleFocus = useCallback(
    (panelId: string) => {
      if (state.activePanelId !== panelId) {
        onStateChange({ ...state, activePanelId: panelId });
      }
    },
    [state, onStateChange],
  );

  const handleRename = useCallback(
    (panelId: string, title: string) => {
      const newRoot = renamePanelInTree(state.root, panelId, title);
      if (newRoot !== state.root) {
        onStateChange({ ...state, root: newRoot });
      }
    },
    [state, onStateChange],
  );

  const handleDuplicate = useCallback(
    (sourceId: string) => {
      // Create a new panel with the same type as the source.
      const newPanel = onCreatePanel(sourceId, "right");
      const newRoot = splitPanelAt(state.root, sourceId, newPanel, "right");
      onStateChange({ ...state, root: newRoot, activePanelId: newPanel.id });
    },
    [state, onStateChange, onCreatePanel],
  );

  const handleResize = useCallback(
    (splitNode: SplitNode, childIndex: number, deltaFraction: number) => {
      if (!state.root) return;
      const newRoot = resizeSplitChild(state.root, splitNode, childIndex, deltaFraction);
      onStateChange({ ...state, root: newRoot });
    },
    [state, onStateChange],
  );

  const handleEqualize = useCallback(
    (splitNode: SplitNode) => {
      if (!state.root) return;
      const newRoot = equalizeSplit(state.root, splitNode);
      onStateChange({ ...state, root: newRoot });
    },
    [state, onStateChange],
  );

  // ── Drag-to-reorder (ported from reference IDE) ──
  const handleHeaderPointerDown = useCallback(
    (panelId: string, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (!state.root) return;

      // Find the split containing this panel.
      const parentSplit = findParentSplit(state.root, panelId);
      if (!parentSplit || parentSplit.kind !== "split") return; // single panel, no reorder

      // Get the siblings in the same split.
      const siblings = parentSplit.children;
      const panelIndex = siblings.findIndex(
        (child) => child.kind === "leaf" && child.panel.id === panelId,
      );
      if (panelIndex === -1) return;
      if (siblings.length < 2) return; // nothing to reorder

      // Measure sibling positions.
      const isRow = parentSplit.direction === "row";
      const metrics: PanelMetric[] = [];
      for (const sibling of siblings) {
        if (sibling.kind !== "leaf") continue;
        const el = panelRefs.current[sibling.panel.id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        metrics.push({
          id: sibling.panel.id,
          start: isRow ? rect.left : rect.top,
          size: isRow ? rect.width : rect.height,
        });
      }
      if (metrics.length !== siblings.filter((s) => s.kind === "leaf").length) return;

      e.preventDefault();
      dragCleanupRef.current?.();

      const startCoord = isRow ? e.clientX : e.clientY;
      const nextDrag: DragState = {
        draggedId: panelId,
        initialIndex: panelIndex,
        currentIndex: panelIndex,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
        splitMetrics: metrics,
        splitDirection: parentSplit.direction,
        splitNode: parentSplit,
        dropTarget: null,
      };

      dragRef.current = nextDrag;
      setDragState(nextDrag);

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const updateDrag = (clientX: number, clientY: number) => {
        const current = dragRef.current;
        if (!current || current.pointerId !== e.pointerId) return;
        const coord = isRow ? clientX : clientY;
        const dragOffset = coord - startCoord;
        const moved = current.moved || Math.abs(dragOffset) >= DRAG_THRESHOLD_PX;

        // Check for drop zones (split onto another panel).
        let dropTarget: DragState["dropTarget"] = null;
        if (moved) {
          const el = document.elementFromPoint(clientX, clientY);
          const panelEl = el?.closest("[data-panel-id]") as HTMLElement | null;
          if (panelEl) {
            const targetId = panelEl.dataset.panelId!;
            if (targetId !== current.draggedId) {
              const rect = panelEl.getBoundingClientRect();
              const relX = (clientX - rect.left) / rect.width;
              const relY = (clientY - rect.top) / rect.height;
              // Determine which edge the pointer is closest to (equal priority
              // for all 4 edges, instead of left>right>top>bottom priority).
              const distLeft = relX;
              const distRight = 1 - relX;
              const distTop = relY;
              const distBottom = 1 - relY;
              const minDist = Math.min(distLeft, distRight, distTop, distBottom);
              if (minDist < 0.25) {
                if (minDist === distLeft) dropTarget = { panelId: targetId, side: "left" };
                else if (minDist === distRight) dropTarget = { panelId: targetId, side: "right" };
                else if (minDist === distTop) dropTarget = { panelId: targetId, side: "top" };
                else dropTarget = { panelId: targetId, side: "bottom" };
              }
            }
          }
        }

        // For reorder, use the drag math.
        const dragStateForReorder = {
          draggedId: current.draggedId,
          initialIndex: current.initialIndex,
          currentIndex: current.currentIndex,
          startX: startCoord,
          currentX: coord,
          moved,
          metrics: current.splitMetrics,
        };
        const newIndex = moved && !dropTarget ? resolveDragIndex(dragStateForReorder) : current.initialIndex;

        const updated: DragState = {
          ...current,
          currentX: clientX,
          currentY: clientY,
          moved,
          currentIndex: newIndex,
          dropTarget,
        };

        if (
          current.currentX === updated.currentX &&
          current.currentY === updated.currentY &&
          current.currentIndex === updated.currentIndex &&
          current.moved === updated.moved &&
          (current.dropTarget?.panelId === updated.dropTarget?.panelId) &&
          (current.dropTarget?.side === updated.dropTarget?.side)
        ) return;

        dragRef.current = updated;
        setDragState(updated);
      };

      const finishDrag = (clientX: number, clientY: number, commit: boolean) => {
        updateDrag(clientX, clientY);
        const finalDrag = dragRef.current;

        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.removeEventListener("pointercancel", handleCancel);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        dragCleanupRef.current = null;

        if (!finalDrag || finalDrag.pointerId !== e.pointerId) return;

        if (commit && finalDrag.moved) {
          // If we have a drop target, do a split.
          if (finalDrag.dropTarget) {
            const { panelId: targetId, side } = finalDrag.dropTarget;
            if (targetId !== finalDrag.draggedId) {
              const newRoot = movePanel(state.root, finalDrag.draggedId, targetId, side);
              onStateChange({ ...state, root: newRoot, activePanelId: finalDrag.draggedId });
            }
          } else if (finalDrag.initialIndex !== finalDrag.currentIndex) {
            // Reorder within the split.
            const affected = getDragAffectedIds({
              draggedId: finalDrag.draggedId,
              initialIndex: finalDrag.initialIndex,
              currentIndex: finalDrag.currentIndex,
              startX: startCoord,
              currentX: isRow ? finalDrag.currentX : finalDrag.currentY,
              moved: true,
              metrics: finalDrag.splitMetrics,
            });
            flushSync(() => {
              setDragState(null);
              setSettlingIds(affected);
              const newRoot = state.root ? reorderWithinSplit(state.root, finalDrag.splitNode, finalDrag.initialIndex, finalDrag.currentIndex) : null;
              onStateChange({ ...state, root: newRoot, activePanelId: finalDrag.draggedId });
            });
            if (settlingTimerRef.current) window.clearTimeout(settlingTimerRef.current);
            settlingTimerRef.current = window.setTimeout(() => {
              setSettlingIds([]);
              settlingTimerRef.current = null;
            }, REPOSITION_SUPPRESSION_MS);
            return;
          }
        }

        dragRef.current = null;
        setDragState(null);
      };

      function handleMove(ev: PointerEvent) {
        updateDrag(ev.clientX, ev.clientY);
      }
      function handleUp(ev: PointerEvent) {
        finishDrag(ev.clientX, ev.clientY, true);
      }
      function handleCancel(ev: PointerEvent) {
        finishDrag(ev.clientX, ev.clientY, false);
      }

      dragCleanupRef.current = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.removeEventListener("pointercancel", handleCancel);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        dragCleanupRef.current = null;
        dragRef.current = null;
        setDragState(null);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp, { once: true });
      document.addEventListener("pointercancel", handleCancel, { once: true });
    },
    [state, onStateChange],
  );

  // ── Empty state ──
  if (!state.root) {
    return (
      <div className="panel-grid">
        <div className="panel-grid-empty">
          <MessageSquare size={32} className="text-muted" />
          <h3>No panels open</h3>
          <p>Start a chat or open a terminal to begin.</p>
          <button
            className="btn btn-primary"
            type="button"
            title="Start a new chat"
            onClick={() => {
              const newPanel = onCreatePanel(null, "right");
              const newRoot: SplitNode = { kind: "leaf", panel: newPanel };
              onStateChange({ ...state, root: newRoot, activePanelId: newPanel.id });
            }}
          >
            <Plus size={12} /> New chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-grid" ref={containerRef}>
      {renderNode(state.root, null, 0)}
    </div>
  );

  /** Recursively render a split tree node. */
  function renderNode(node: SplitNode, parent: SplitNode | null, indexInParent: number): React.ReactNode {
    if (node.kind === "leaf") {
      const panel = node.panel;
      const isActive = panel.id === state.activePanelId;
      const isClosing = closingIds.has(panel.id);
      const isDragged = dragState?.draggedId === panel.id && dragState.moved;
      const isDropTarget = dragState?.dropTarget?.panelId === panel.id;
      const isSettling = settlingIds.includes(panel.id);

      // Calculate drag offset for reorder animation.
      let dragOffset = 0;
      if (dragState?.moved && !dragState.dropTarget && parent === dragState.splitNode) {
        const siblingIndex = parent!.children.indexOf(node);
        dragOffset = resolveDragOffset(
          {
            draggedId: dragState.draggedId,
            initialIndex: dragState.initialIndex,
            currentIndex: dragState.currentIndex,
            startX: dragState.splitDirection === "row" ? dragState.startX : dragState.startY,
            currentX: dragState.splitDirection === "row" ? dragState.currentX : dragState.currentY,
            moved: true,
            metrics: dragState.splitMetrics,
          },
          panel.id,
          siblingIndex,
        );
      }

      const style: CSSProperties = {
        opacity: isClosing ? 0 : 1,
        transform: dragOffset !== 0
          ? `translate${dragState?.splitDirection === "row" ? "X" : "Y"}(${dragOffset}px)`
          : undefined,
        transition: isClosing
          ? "opacity 0.18s ease-in"
          : isDragged || dragOffset !== 0 || isSettling
            ? "none"
            : "transform 0.15s ease-out, opacity 0.18s ease-out",
        zIndex: isDragged ? 10 : 0,
      };

      return (
        <div
          key={panel.id}
          className={`panel-grid-leaf${isActive ? " is-active" : ""}${isClosing ? " is-closing" : ""}`}
          ref={(el) => {
            if (el) panelRefs.current[panel.id] = el;
          }}
          style={style}
          data-panel-id={panel.id}
        >
          <PanelHeader
            panel={panel}
            status="idle"
            isActive={isActive}
            onFocus={() => handleFocus(panel.id)}
            onClose={() => handleClose(panel.id)}
            onSplitRight={() => handleSplit(panel.id, "right")}
            onSplitDown={() => handleSplit(panel.id, "bottom")}
            onDuplicate={() => handleDuplicate(panel.id)}
            onRename={(title) => handleRename(panel.id, title)}
            onDragStart={(e) => handleHeaderPointerDown(panel.id, e)}
            onDragEnd={() => {}}
            onDragMove={() => {}}
            onDragCancel={() => {}}
          />
          <div className="panel-grid-content">
            {renderPanel(panel, isActive)}
          </div>
          {isDropTarget && dragState?.dropTarget ? (
            <DropZoneOverlay side={dragState.dropTarget.side} />
          ) : null}
        </div>
      );
    }

    // Node is a split.
    const isRow = node.direction === "row";
    const children = node.children;
    const sizes = node.sizes;

    return (
      <div
        key={`split-${indexInParent}`}
        className={`panel-grid-split is-${node.direction}`}
        style={{
          display: "flex",
          flexDirection: isRow ? "row" : "column",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {children.map((child, i) => {
          const size = sizes[i] ?? 1 / children.length;
          const basis = `${size * 100}%`;
          return (
            <div
              key={`split-child-${i}`}
              className="panel-grid-split-child"
              style={{
                flexBasis: basis,
                flexGrow: 1,
                flexShrink: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: isRow ? "row" : "column",
              }}
            >
              {renderNode(child, node, i)}
              {i < children.length - 1 ? (
                <PanelSplitter
                  orientation={isRow ? "vertical" : "horizontal"}
                  onDelta={(deltaPx) => {
                    // Convert pixel delta to fraction of the split's total size.
                    const containerEl = containerRef.current;
                    if (!containerEl) return;
                    const rect = containerEl.getBoundingClientRect();
                    const totalSize = isRow ? rect.width : rect.height;
                    if (totalSize <= 0) return;
                    const deltaFraction = deltaPx / totalSize;
                    handleResize(node, i, deltaFraction);
                  }}
                  onEqualize={() => handleEqualize(node)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }
}

/** Drop zone overlay rendered on the target panel during a drag-to-split. */
function DropZoneOverlay({ side }: { side: DropSide }) {
  const className = `panel-drop-zone is-${side}`;
  return <div className={className} title={`Drop to split ${side}`} />;
}

// ── Helper: rename a panel in the tree ────────────────────────────────────

function renamePanelInTree(root: SplitNode | null, panelId: string, title: string): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    return root.panel.id === panelId
      ? { kind: "leaf", panel: { ...root.panel, title } }
      : root;
  }
  return {
    ...root,
    children: root.children.map((child) => renamePanelInTree(child, panelId, title)!),
  };
}

// ── Helper: reorder within a split ──────────────────────────────────────────

function reorderWithinSplit(
  root: SplitNode,
  splitNode: SplitBranch,
  fromIndex: number,
  toIndex: number,
): SplitNode {
  if (root === splitNode) {
    if (root.kind !== "split") return root;
    const newChildren = [...root.children];
    const [moved] = newChildren.splice(fromIndex, 1);
    if (!moved) return root;
    newChildren.splice(toIndex, 0, moved);
    return { ...root, children: newChildren };
  }
  if (root.kind === "leaf") return root;
  return {
    ...root,
    children: root.children.map((child) => reorderWithinSplit(child, splitNode, fromIndex, toIndex)),
  };
}


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
  activeTab,
  equalizeSplit,
  findParentSplit,
  flattenPanels,
  movePanel,
  tearOffTab,
  removePanel,
  removeTabFromPanel,
  resizeSplitChild,
  resolveDragIndex,
  resolveDragOffset,
  getDragAffectedIds,
  setActiveTab,
  reorderTabs,
  splitPanelAt,
  type DropSide,
  type Panel,
  type PanelGridState,
  type PanelMetric,
  type PanelTab,
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
  /** Called when a panel/tab is renamed so the caller can persist the new
   *  title to the session_tabs table and (for chat tabs) the native chat
   *  session. Without this, renames revert on project switch. */
  onRenameTab?: (panelId: string, title: string) => void;
  /** Render a panel's content by panel id. The caller owns mounting. */
  renderPanel: (panel: Panel, isActive: boolean) => React.ReactNode;
  /** Called when a panel is created (split/duplicate). Returns the new panel. */
  onCreatePanel: (anchorId: string | null, side: DropSide) => Panel;
  /** Viewport width for size calculations. 0 = use default. */
  viewportWidth: number;
  viewportHeight: number;
  /** Called when an external item (e.g. a background agent) is dragged
   *  into the grid and dropped. The chatSessionId is passed through. */
  onDropExternalChat?: (chatSessionId: string) => void;
  /** Chat session IDs currently hosting a background agent. Panels matching
   *  these show a minimize button instead of close. */
  backgroundChatSessionIds?: Set<string>;
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
  /** The split node the dragged panel belongs in (null for standalone leaf). */
  splitNode: SplitBranch | null;
  /** Drop target during a split-drag (null = reorder mode). */
  dropTarget: { panelId: string; side: DropSide } | null;
};

export function PanelGrid(props: PanelGridProps) {
  const { state, onStateChange, onRenameTab, renderPanel, onCreatePanel, viewportWidth, viewportHeight, onDropExternalChat, backgroundChatSessionIds } = props;
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

  const handleAddTab = useCallback(
    (panelId: string) => {
      const newPanel = onCreatePanel(panelId, "center");
      const newRoot = splitPanelAt(state.root, panelId, newPanel, "center");
      onStateChange({ ...state, root: newRoot, activePanelId: panelId });
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
      onRenameTab?.(panelId, title);
    },
    [state, onStateChange, onRenameTab],
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

  // ── Drag-to-reorder / split / merge ──
  // Works for single panels too: dragging onto an edge of the same panel
  // creates a split. Dragging onto another panel's edge splits there.
  // Center drop on another panel merges as a tab.
  const handleHeaderPointerDown = useCallback(
    (panelId: string, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (!state.root) return;

      // Find the split containing this panel (may be null for a single
      // standalone panel — drag still works for self-split and cross-panel drops).
      const parentSplit = findParentSplit(state.root, panelId);

      // Gather sibling metrics for reorder (only if we're in a split with 2+ siblings).
      let metrics: PanelMetric[] = [];
      let panelIndex = 0;
      let isRow = true;
      if (parentSplit && parentSplit.kind === "split") {
        const siblings = parentSplit.children;
        panelIndex = siblings.findIndex(
          (child) => child.kind === "leaf" && child.panel.id === panelId,
        );
        if (panelIndex !== -1 && siblings.length >= 2) {
          isRow = parentSplit.direction === "row";
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
        }
      }

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
        splitDirection: isRow ? "row" : "column",
        splitNode: parentSplit as SplitBranch | null,
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

        // Check for drop zones (split onto another panel or self).
        let dropTarget: DragState["dropTarget"] = null;
        if (moved) {
          const el = document.elementFromPoint(clientX, clientY);
          let panelEl = el?.closest("[data-panel-id]") as HTMLElement | null;
          // When the cursor is over a splitter (or any non-panel gap),
          // elementFromPoint returns an element with no data-panel-id
          // ancestor. Fall back to the nearest panel by bounding rect so
          // drags over dividing lines don't lose their drop target.
          if (!panelEl) {
            let bestDist = Infinity;
            for (const id of Object.keys(panelRefs.current)) {
              const refEl = panelRefs.current[id];
              if (!refEl) continue;
              const r = refEl.getBoundingClientRect();
              const dx = Math.max(r.left - clientX, 0, clientX - r.right);
              const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
              const dist = dx * dx + dy * dy;
              if (dist < bestDist) {
                bestDist = dist;
                panelEl = refEl;
              }
            }
          }
          if (panelEl) {
            const targetId = panelEl.dataset.panelId!;
            const rect = panelEl.getBoundingClientRect();
            const relX = (clientX - rect.left) / rect.width;
            const relY = (clientY - rect.top) / rect.height;
            const distLeft = relX;
            const distRight = 1 - relX;
            const distTop = relY;
            const distBottom = 1 - relY;
            const minDist = Math.min(distLeft, distRight, distTop, distBottom);
            if (minDist < 0.2) {
              if (minDist === distLeft) dropTarget = { panelId: targetId, side: "left" };
              else if (minDist === distRight) dropTarget = { panelId: targetId, side: "right" };
              else if (minDist === distTop) dropTarget = { panelId: targetId, side: "top" };
              else dropTarget = { panelId: targetId, side: "bottom" };
            } else if (targetId !== current.draggedId) {
              // Center drop = add as tab (only for other panels, not self).
              dropTarget = { panelId: targetId, side: "center" };
            }
          }
        }

        // For reorder, use the drag math (only if we have metrics).
        const newIndex = moved && !dropTarget && metrics.length >= 2
          ? resolveDragIndex({
              draggedId: current.draggedId,
              initialIndex: current.initialIndex,
              currentIndex: current.currentIndex,
              startX: startCoord,
              currentX: coord,
              moved,
              metrics: current.splitMetrics,
            })
          : current.initialIndex;

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
          if (finalDrag.dropTarget) {
            const { panelId: targetId, side } = finalDrag.dropTarget;
            if (side === "center" && targetId !== finalDrag.draggedId) {
              // Merge as tab into target panel. The dragged panel is removed
              // from the tree and added as a tab — set activePanelId to the
              // surviving target leaf, not the dragged panel (whose id is
              // now a tab id, not a leaf id).
              const newRoot = movePanel(state.root, finalDrag.draggedId, targetId, side);
              onStateChange({ ...state, root: newRoot, activePanelId: targetId });
            } else if (side !== "center" && targetId !== finalDrag.draggedId) {
              // Edge drop onto another panel: split beside it.
              const newRoot = movePanel(state.root, finalDrag.draggedId, targetId, side);
              onStateChange({ ...state, root: newRoot, activePanelId: finalDrag.draggedId });
            } else if (side !== "center" && targetId === finalDrag.draggedId) {
              // Self-edge drop: tear off the active tab into a new panel
              // beside the current one. Only works when the panel has 2+
              // tabs — with a single tab there's nothing to tear off, so
              // it's a no-op (no blank panel creation).
              const torn = tearOffTab(state.root, finalDrag.draggedId, side);
              if (torn) {
                onStateChange({ ...state, root: torn.root, activePanelId: torn.newPanelId });
              }
            }
          } else if (finalDrag.initialIndex !== finalDrag.currentIndex && metrics.length >= 2) {
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
              const newRoot = state.root && finalDrag.splitNode
                ? reorderWithinSplit(state.root, finalDrag.splitNode, finalDrag.initialIndex, finalDrag.currentIndex)
                : null;
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
    <div
      className="panel-grid"
      ref={containerRef}
      onDragOver={(e) => {
        if (onDropExternalChat && e.dataTransfer.types.includes("text/plain")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (!onDropExternalChat) return;
        const chatSessionId = e.dataTransfer.getData("text/plain");
        if (chatSessionId) {
          e.preventDefault();
          onDropExternalChat(chatSessionId);
        }
      }}
    >
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

      // Compute the effective panel from the active tab — always, since
      // the header now always renders a tab strip.
      const tab = activeTab(panel);
      const effectivePanel: Panel = panel.tabs && panel.tabs.length > 0
        ? { ...panel, type: tab.type, title: tab.title, chatSessionId: tab.chatSessionId, terminalId: tab.terminalId, filePath: tab.filePath }
        : panel;

      // Calculate drag offset for reorder animation.
      let dragOffset = 0;
      if (dragState?.moved && !dragState.dropTarget && parent && dragState.splitNode && parent === dragState.splitNode) {
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
            onAddTab={() => handleAddTab(panel.id)}
            onSplitDown={() => handleSplit(panel.id, "bottom")}
            onDuplicate={() => handleDuplicate(panel.id)}
            onRename={(title) => handleRename(panel.id, title)}
            onSwitchTab={(tabId) => {
              onStateChange({ ...state, root: setActiveTab(state.root, panel.id, tabId) });
            }}
            onCloseTab={(tabId) => {
              onStateChange(removeTabFromPanel(state, panel.id, tabId));
            }}
            onReorderTabs={(from, to) => {
              onStateChange({ ...state, root: reorderTabs(state.root, panel.id, from, to) });
            }}
            onDragStart={(e) => handleHeaderPointerDown(panel.id, e)}
            onDragEnd={() => {}}
            onDragMove={() => {}}
            onDragCancel={() => {}}
            minimizable={!!panel.chatSessionId && !!backgroundChatSessionIds?.has(panel.chatSessionId)}
          />
          <div className="panel-grid-content">
            {renderPanel(effectivePanel, isActive)}
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

/** Drop zone overlay rendered on the target panel during a drag-to-split.
 *  For "center" (add-as-tab), the guide appears as a strip at the top of
 *  the panel (where the tab strip lives), not a center overlay. */
function DropZoneOverlay({ side }: { side: DropSide }) {
  if (side === "center") {
    return (
      <div className="panel-drop-zone is-center" title="Drop to add as tab">
        <span className="panel-drop-zone-center-label">Add as tab</span>
      </div>
    );
  }
  const className = `panel-drop-zone is-${side}`;
  return <div className={className} title={`Drop to split ${side}`} />;
}

// ── Helper: rename a panel in the tree ────────────────────────────────────

function renamePanelInTree(root: SplitNode | null, panelId: string, title: string): SplitNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    if (root.panel.id !== panelId) return root;
    const panel = root.panel;
    // When the panel has tabs, rename the active tab (the one the user
    // double-clicked) — not just the panel-level title.
    if (panel.tabs && panel.tabs.length > 0) {
      const activeId = panel.activeTabId ?? panel.tabs[0].id;
      const tabs = panel.tabs.map((t) =>
        t.id === activeId ? { ...t, title } : t,
      );
      return { kind: "leaf", panel: { ...panel, title, tabs } };
    }
    return { kind: "leaf", panel: { ...panel, title } };
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


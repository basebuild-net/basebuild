import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import {
  CHAT_PANEL_MIN_WIDTH_PX,
  CHAT_ROW_MIN_HEIGHT_PX,
  addChatBeside,
  clampRowWidths,
  emptyGrid,
  moveChat,
  removeChat,
  resizeAdjacent,
  resizeAdjacentRows,
  singleColumnGrid,
  type ChatGrid,
} from "../../lib/gridMath";

/** Multi-chat grid container (`chat-grid-layout`).
 *
 * Renders `rows × columns` of chat columns. Each column is an independent
 * chat session rendered via `renderChat(chatId)`. Mounts only visible chats
 * (the caller decides which to mount; idle columns are just views). Supports
 * `1×N` and `M×N` layouts, drag-resize splitters (vertical + horizontal),
 * column reorder via header drag, animated close, and an empty-state.
 *
 * Ported from the reference IDE's grid layout, adapted to basebuild's
 * `globals.css`-only stack. Reference: dream IDE (MIT).
 *
 * Attribution: docs/agents/design-system.md. */

export type ChatGridProps = {
  /** The tab's grid layout (rows of chat ids + widths + row heights). */
  grid: ChatGrid;
  /** Called when the grid changes (resize, reorder, add, remove). The caller
   *  persists it via the tab's grid state. */
  onGridChange: (grid: ChatGrid) => void;
  /** Render a chat column's content by chat id. The caller owns mounting:
   *  it may choose to mount only visible/streaming chats. */
  renderChat: (chatId: string, isFocused: boolean) => React.ReactNode;
  /** The currently focused chat id (receives keyboard + outline). */
  focusedChatId: string | null;
  /** Focus a chat (clicks, drag end, add). */
  onFocusChat: (chatId: string) => void;
  /** Close a chat column (session is retained by the caller). */
  onCloseChat: (chatId: string) => void;
  /** Add a chat beside the focused one (or at the end if null). Returns the
   *  new chat id so the caller can create the session. */
  onAddChatBeside: (anchorId: string | null) => string;
  /** Duplicate a chat's settings into a new column. Returns the new chat id. */
  onDuplicateChat: (sourceId: string) => string;
  /** Viewport width in pixels (for width clamping). 0 = use a default. */
  viewportWidth: number;
  /** Viewport height in pixels (for row-height clamping). 0 = use a default. */
  viewportHeight: number;
};

const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const DRAG_THRESHOLD_PX = 4;

export function ChatGrid(props: ChatGridProps) {
  const { grid, onGridChange, renderChat, focusedChatId, onFocusChat, onCloseChat, onAddChatBeside, onDuplicateChat } = props;
  const viewportWidth = props.viewportWidth || DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = props.viewportHeight || DEFAULT_VIEWPORT_HEIGHT;

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Resize (splitters) ──
  const handleColumnResize = useCallback(
    (rowIndex: number, leftId: string, rightId: string, delta: number) => {
      const row = grid.rows[rowIndex] ?? [];
      const widths = clampRowWidths(grid.chatColumnWidths, row, viewportWidth);
      const next = resizeAdjacent(widths, leftId, rightId, delta);
      onGridChange({ ...grid, chatColumnWidths: next });
    },
    [grid, viewportWidth, onGridChange],
  );

  const handleRowResize = useCallback(
    (topIndex: number, bottomIndex: number, delta: number) => {
      const next = resizeAdjacentRows(grid.rowHeights, topIndex, bottomIndex, delta, viewportHeight);
      onGridChange({ ...grid, rowHeights: next });
    },
    [grid, viewportHeight, onGridChange],
  );

  // ── Reorder (header drag) ──
  const handleHeaderDragStart = useCallback(
    (chatId: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setDragState({
        draggedId: chatId,
        startX: e.clientX,
        startY: e.clientY,
        hoverRowIndex: -1,
        hoverColIndex: -1,
        hoverRightHalf: false,
        moved: false,
      });
    },
    [],
  );

  const handleHeaderDragEnd = useCallback(() => {
    if (!dragState) return;
    if (!dragState.moved) {
      setDragState(null);
      return;
    }
    // Resolve the drop target from the hover indices.
    const { draggedId, hoverRowIndex, hoverColIndex } = dragState;
    if (hoverRowIndex >= 0) {
      const next = moveChat(grid, draggedId, hoverRowIndex, hoverColIndex, viewportWidth);
      onGridChange(next);
      onFocusChat(draggedId);
    }
    setDragState(null);
  }, [dragState, grid, viewportWidth, onGridChange, onFocusChat]);

  // Track mouse movement during a drag to detect threshold + hover target.
  useEffect(() => {
    if (!dragState) return;
    function onMove(e: MouseEvent) {
      if (!dragState) return;
      if (!dragState.moved) {
        const dx = Math.abs(e.clientX - dragState.startX);
        const dy = Math.abs(e.clientY - dragState.startY);
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
      }
      // Find which column the pointer is over.
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const columnEl = el?.closest("[data-chat-column-id]") as HTMLElement | null;
      if (columnEl) {
        const chatId = columnEl.dataset.chatColumnId!;
        const rect = columnEl.getBoundingClientRect();
        const hoverRightHalf = e.clientX > rect.left + rect.width / 2;
        // Find the row/col indices.
        let rowIndex = -1, colIndex = -1;
        for (let r = 0; r < grid.rows.length; r++) {
          const idx = grid.rows[r].indexOf(chatId);
          if (idx !== -1) { rowIndex = r; colIndex = idx; break; }
        }
        setDragState({
          ...dragState,
          moved: true,
          hoverRowIndex: rowIndex,
          hoverColIndex: hoverRightHalf ? colIndex + 1 : colIndex,
          hoverRightHalf,
        });
      } else {
        setDragState({ ...dragState, moved: true });
      }
    }
    function onUp() {
      // Defer to handler.
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, grid.rows]);

  // ── Close with animation ──
  const handleClose = useCallback(
    (chatId: string) => {
      // Animate out first, then remove from the grid after the transition.
      setClosingIds((prev) => new Set(prev).add(chatId));
      window.setTimeout(() => {
        const next = removeChat(grid, chatId);
        onGridChange(next);
        setClosingIds((prev) => {
          const n = new Set(prev);
          n.delete(chatId);
          return n;
        });
        // Focus the next chat to the right (or the last).
        const flat = grid.rows.flat().filter((id) => id !== chatId);
        if (flat.length > 0) onFocusChat(flat[0]);
      }, 180);
    },
    [grid, onGridChange, onFocusChat],
  );

  // ── Add / duplicate ──
  const handleAddBeside = useCallback(
    (anchorId: string | null) => {
      const newId = onAddChatBeside(anchorId);
      const next = addChatBeside(grid, anchorId, newId, viewportWidth);
      onGridChange(next);
      onFocusChat(newId);
    },
    [grid, viewportWidth, onGridChange, onFocusChat, onAddChatBeside],
  );

  const handleDuplicate = useCallback(
    (sourceId: string) => {
      const newId = onDuplicateChat(sourceId);
      const next = addChatBeside(grid, sourceId, newId, viewportWidth);
      onGridChange(next);
      onFocusChat(newId);
    },
    [grid, viewportWidth, onGridChange, onFocusChat, onDuplicateChat],
  );

  const flatChats = useMemo(() => grid.rows.flat(), [grid.rows]);

  if (flatChats.length === 0) {
    return (
      <div className="chat-grid">
        <div className="chat-grid-empty">
          <MessageSquare size={32} className="text-muted" />
          <h3>No chat open</h3>
          <button
            className="btn btn-primary"
            type="button"
            title="Start a new chat in this tab"
            onClick={() => handleAddBeside(null)}
          >
            Start a chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-grid"
      ref={gridRef}
      onMouseUp={handleHeaderDragEnd}
    >
      {grid.rows.map((row, rowIndex) => {
        const rowHeight = grid.rowHeights[rowIndex];
        const rowWidths = clampRowWidths(grid.chatColumnWidths, row, viewportWidth);
        const totalWidth = row.reduce((sum, id) => sum + (rowWidths[id] ?? viewportWidth / row.length), 0);
        return (
          <div
            key={rowIndex}
            className="chat-grid-row"
            style={rowHeight ? { flex: `0 0 ${rowHeight}px` } : undefined}
          >
            {row.map((chatId, colIndex) => {
              const width = rowWidths[chatId] ?? Math.floor(totalWidth / row.length);
              const isFocused = chatId === focusedChatId;
              const isClosing = closingIds.has(chatId);
              const isDragged = dragState?.draggedId === chatId && dragState.moved;
              const showDropLeft = dragState?.moved && dragState.draggedId !== chatId &&
                dragState.hoverRowIndex === rowIndex && dragState.hoverColIndex === colIndex && !dragState.hoverRightHalf;
              const showDropRight = dragState?.moved && dragState.draggedId !== chatId &&
                dragState.hoverRowIndex === rowIndex && dragState.hoverColIndex === colIndex + 1 && dragState.hoverRightHalf;
              return (
                <div
                  key={chatId}
                  data-chat-column-id={chatId}
                  className={`chat-grid-column${isFocused ? " is-focused" : ""}${isClosing ? " is-closing" : ""}`}
                  style={{ flexBasis: `${width}px`, flexGrow: isClosing ? 0 : 1, flexShrink: 0, opacity: isDragged ? 0.4 : 1 }}
                  onMouseDown={() => onFocusChat(chatId)}
                >
                  {showDropLeft ? <div className="chat-grid-drop-indicator is-left" /> : null}
                  {renderChat(chatId, isFocused)}
                  {showDropRight ? <div className="chat-grid-drop-indicator is-right" /> : null}
                  <button
                    className="btn-icon btn-icon-sm chat-grid-close"
                    type="button"
                    title="Close chat (session retained)"
                    onClick={(e) => { e.stopPropagation(); handleClose(chatId); }}
                  >
                    <X size={11} />
                  </button>
                  {colIndex < row.length - 1 ? (
                    <ChatSplitter
                      orientation="vertical"
                      onDelta={(d) => handleColumnResize(rowIndex, chatId, row[colIndex + 1], d)}
                    />
                  ) : null}
                </div>
              );
            })}
            {rowIndex < grid.rows.length - 1 ? (
              <ChatSplitter
                orientation="horizontal"
                onDelta={(d) => handleRowResize(rowIndex, rowIndex + 1, d)}
              />
            ) : null}
          </div>
        );
      })}
      {/* Hidden handler to expose add/duplicate to the header via the grid props.
          The header's more-actions menu calls these through the parent. */}
      <span
        aria-hidden
        data-grid-add-beside={String(handleAddBeside)}
        data-grid-duplicate={String(handleDuplicate)}
        style={{ display: "none" }}
      />
    </div>
  );
}

type DragState = {
  draggedId: string;
  startX: number;
  startY: number;
  hoverRowIndex: number;
  hoverColIndex: number;
  hoverRightHalf: boolean;
  moved: boolean;
};

/** A draggable splitter between two columns or rows. */
function ChatSplitter({ orientation, onDelta }: { orientation: "vertical" | "horizontal"; onDelta: (delta: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef(0);

  const onPointerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;
      function onMove(ev: MouseEvent) {
        const pos = orientation === "vertical" ? ev.clientX : ev.clientY;
        const delta = pos - lastPos.current;
        lastPos.current = pos;
        onDelta(delta);
      }
      function onUp() {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [orientation, onDelta],
  );

  return (
    <div
      className={`chat-grid-splitter is-${orientation}${dragging ? " is-active" : ""}`}
      onMouseDown={onPointerDown}
      title={orientation === "vertical" ? "Drag to resize columns" : "Drag to resize rows"}
    />
  );
}

export { CHAT_PANEL_MIN_WIDTH_PX, CHAT_ROW_MIN_HEIGHT_PX, singleColumnGrid, emptyGrid };

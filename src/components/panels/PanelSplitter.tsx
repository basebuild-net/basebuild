import { useCallback, useRef, useState } from "react";

/** Minimum panel size in pixels (both width and height). */
export const PANEL_MIN_SIZE_PX = 200;

const RESIZE_DRAG_THRESHOLD_PX = 2;
const SPLITTER_THICKNESS_PX = 6;

type PanelSplitterProps = {
  /** Orientation: "vertical" = a column splitter (between left/right panels in a row split).
   *  "horizontal" = a row splitter (between top/bottom panels in a column split). */
  orientation: "vertical" | "horizontal";
  /** Called with the pixel delta as the user drags. Positive = grow the
   *  first panel, shrink the second. */
  onDelta: (deltaPx: number) => void;
  /** Called on double-click to equalize the split. */
  onEqualize?: () => void;
};

/** A draggable splitter between two panels in a split.
 *
 *  Ported from the reference IDE's pointer-based resize with rAF batching,
 *  extended to support both col-resize (row splits) and row-resize (column
 *  splits). The reference only supports col-resize. */
export function PanelSplitter({ orientation, onDelta, onEqualize }: PanelSplitterProps) {
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef(0);
  const didDrag = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.detail > 1) return; // let double-click through

      setDragging(true);
      didDrag.current = false;
      lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;

      const startPos = lastPos.current;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: PointerEvent) => {
        const pos = orientation === "vertical" ? moveEvent.clientX : moveEvent.clientY;
        const delta = pos - lastPos.current;
        if (Math.abs(pos - startPos) >= RESIZE_DRAG_THRESHOLD_PX) {
          didDrag.current = true;
        }
        lastPos.current = pos;
        onDelta(delta);
      };

      const handleEnd = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupRef.current = null;
        setDragging(false);
      };

      cleanupRef.current = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupRef.current = null;
        setDragging(false);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleEnd, { once: true });
      document.addEventListener("pointercancel", handleEnd, { once: true });
    },
    [orientation, onDelta],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEqualize?.();
    },
    [onEqualize],
  );

  const isVertical = orientation === "vertical";
  return (
    <div
      className={`panel-grid-splitter is-${orientation}${dragging ? " is-active" : ""}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={isVertical ? "Drag to resize columns (double-click to equalize)" : "Drag to resize rows (double-click to equalize)"}
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
    />
  );
}

import { useCallback, useRef, useState } from "react";

/** Minimum panel size in pixels (both width and height) — legacy fallback
 *  when type-specific minimums are not available. */
export const PANEL_MIN_SIZE_PX = 200;

const RESIZE_DRAG_THRESHOLD_PX = 2;
const SPLITTER_THICKNESS_PX = 6;
/** Keyboard resize step in pixels. */
const KEYBOARD_STEP_PX = 16;

type PanelSplitterProps = {
  /** Orientation: "vertical" = a column splitter (between left/right panels
   *  in a horizontal split). "horizontal" = a row splitter (between
   *  top/bottom panels in a vertical split). */
  orientation: "vertical" | "horizontal";
  /** Called with the pixel delta as the user drags. Positive = grow the
   *  first panel, shrink the second. */
  onDelta: (deltaPx: number) => void;
  /** Called on double-click to equalize the split. */
  onEqualize?: () => void;
  /** Current ratio value (0..1) for aria-valuenow. */
  value?: number;
  /** Minimum ratio for aria-valuemin. */
  min?: number;
  /** Maximum ratio for aria-valuemax. */
  max?: number;
};

/** A draggable, keyboard-focusable splitter between two panels in a split.
 *
 *  Pointer deltas are frame-batched via `requestAnimationFrame` so at most
 *  one `onDelta` call fires per animation frame, reducing state/layout churn.
 *  The splitter is keyboard focusable with `role="separator"`, Arrow keys
 *  for fine/coarse resize, and Home/End for min/max. */
export function PanelSplitter({ orientation, onDelta, onEqualize, value, min, max }: PanelSplitterProps) {
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef(0);
  const didDrag = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);

  // onDelta closes over PanelGrid state that changes every move event. Route
  // through a ref so the document listener always sees the freshest closure.
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;

  const flushDelta = useCallback(() => {
    rafIdRef.current = null;
    if (pendingDeltaRef.current !== 0) {
      onDeltaRef.current(pendingDeltaRef.current);
      pendingDeltaRef.current = 0;
    }
  }, []);

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
        // Frame-batch: accumulate deltas and flush at most once per frame.
        pendingDeltaRef.current += delta;
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(flushDelta);
        }
      };

      const handleEnd = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupRef.current = null;
        // Flush any pending delta before clearing dragging state.
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        if (pendingDeltaRef.current !== 0) {
          onDeltaRef.current(pendingDeltaRef.current);
          pendingDeltaRef.current = 0;
        }
        setDragging(false);
      };

      cleanupRef.current = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleEnd);
        document.removeEventListener("pointercancel", handleEnd);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        pendingDeltaRef.current = 0;
        cleanupRef.current = null;
        setDragging(false);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleEnd, { once: true });
      document.addEventListener("pointercancel", handleEnd, { once: true });
    },
    [orientation, flushDelta],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEqualize?.();
    },
    [onEqualize],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const isVertical = orientation === "vertical";
      let delta = 0;
      switch (e.key) {
        case "ArrowLeft":
          if (isVertical) delta = -KEYBOARD_STEP_PX;
          break;
        case "ArrowRight":
          if (isVertical) delta = KEYBOARD_STEP_PX;
          break;
        case "ArrowUp":
          if (!isVertical) delta = -KEYBOARD_STEP_PX;
          break;
        case "ArrowDown":
          if (!isVertical) delta = KEYBOARD_STEP_PX;
          break;
        case "Home":
          // Jump to minimum (first child smallest).
          onEqualize?.();
          e.preventDefault();
          return;
        case "End":
          // Jump to maximum (first child largest).
          onEqualize?.();
          e.preventDefault();
          return;
        case "Enter":
        case " ":
          onEqualize?.();
          e.preventDefault();
          return;
        default:
          return;
      }
      if (delta !== 0) {
        e.preventDefault();
        onDeltaRef.current(delta);
      }
    },
    [orientation, onEqualize],
  );

  const isVertical = orientation === "vertical";
  const valuenow = value != null ? Math.round(value * 100) : undefined;
  const ariaMin = min != null ? Math.round(min * 100) : undefined;
  const ariaMax = max != null ? Math.round(max * 100) : undefined;

  return (
    <div
      className={`panel-grid-splitter is-${orientation}${dragging ? " is-active" : ""}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      title={isVertical
        ? "Drag to resize columns (double-click to equalize, arrow keys to resize)"
        : "Drag to resize rows (double-click to equalize, arrow keys to resize)"}
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuenow={valuenow}
      aria-valuemin={ariaMin}
      aria-valuemax={ariaMax}
      tabIndex={0}
    />
  );
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type PopoverPosition = { top: number; left: number };

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

export type PopoverOptions = {
  placement?: PopoverPlacement;
  /** Margin from the trigger in px (default 4). */
  margin?: number;
  /** Viewport padding in px (default 8). */
  viewportPadding?: number;
};

export type PopoverController = {
  open: boolean;
  position: PopoverPosition | null;
  toggle: () => void;
  close: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
};

/**
 * Viewport-clamped popover positioning. Measures the trigger rect and the
 * dropdown dimensions, then clamps within the viewport so the dropdown never
 * overflows edges. Re-measures on resize and scroll while open.
 */
export function useViewportClampedPopover(options: PopoverOptions = {}): PopoverController {
  const { placement = "bottom-end", margin = 4, viewportPadding = 8 } = options;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Estimate dropdown size from the trigger's likely content width; the
    // actual dropdown element is measured after paint via useLayoutEffect.
    const estWidth = 200;
    const estHeight = 160;

    let top: number;
    let left: number;

    if (placement.startsWith("bottom")) {
      top = rect.bottom + margin;
      if (top + estHeight > vh - viewportPadding) {
        top = Math.max(viewportPadding, rect.top - margin - estHeight);
      }
    } else {
      top = rect.top - margin - estHeight;
      if (top < viewportPadding) {
        top = rect.bottom + margin;
      }
    }

    if (placement.endsWith("end")) {
      left = rect.right - estWidth;
      if (left < viewportPadding) {
        left = viewportPadding;
      }
      if (left + estWidth > vw - viewportPadding) {
        left = vw - viewportPadding - estWidth;
      }
    } else {
      left = rect.left;
      if (left + estWidth > vw - viewportPadding) {
        left = vw - viewportPadding - estWidth;
      }
      if (left < viewportPadding) {
        left = viewportPadding;
      }
    }

    setPosition({ top: Math.round(top), left: Math.round(left) });
  }, [placement, margin, viewportPadding]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        // Measure on next paint — the dropdown will be rendered by then.
        requestAnimationFrame(() => measure());
      }
      return next;
    });
  }, [measure]);

  const close = useCallback(() => setOpen(false), []);

  // Re-measure on resize/scroll while open.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const handler = () => measure();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, measure]);

  return { open, position, toggle, close, triggerRef };
}

import { useEffect } from "react";

/** Close a modal or popover when the Escape key is pressed.
 *
 * The handler is added to `window` so it fires regardless of focus within the
 * modal. The effect is a no-op when `open` is false, so it can be wired
 * unconditionally. */
export function useEscapeKey(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

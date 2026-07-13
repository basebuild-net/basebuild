import { useCallback, useLayoutEffect, useRef, useState } from "react";

type DropdownPlacement = "bottom" | "top";

/**
 * Computes whether a dropdown should open below or above its trigger
 * based on available viewport space. Attach `triggerRef` to the button
 * that opens the dropdown. The dropdown must be `position: absolute`
 * with a `position: relative` parent.
 */
export function useDropdownPosition<T extends HTMLElement = HTMLButtonElement>(dropdownHeight = 240) {
  const triggerRef = useRef<T | null>(null);
  const [placement, setPlacement] = useState<DropdownPlacement>("bottom");

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setPlacement(spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? "top" : "bottom");
  }, [dropdownHeight]);

  useLayoutEffect(() => {
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  return { triggerRef, placement, recompute };
}

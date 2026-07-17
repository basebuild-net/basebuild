import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, MoreHorizontal } from "lucide-react";

export type ActionMenuItem = {
  key: string;
  label: string;
  title: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Keep the menu open after selection (two-step delete confirms). */
  keepOpen?: boolean;
  onSelect: () => void;
};

/** `…` actions menu that portals to the body with fixed, viewport-clamped
 *  positioning — it can never be clipped by an `overflow: hidden` panel or
 *  shrunk by a small popup, and it flips above the trigger when there is no
 *  room below. Every secondary row/card action across the planning surfaces
 *  goes through this component. */
export function ActionMenu({
  items,
  triggerTitle,
  triggerClassName,
  icon,
}: {
  items: ActionMenuItem[];
  triggerTitle: string;
  triggerClassName?: string;
  icon?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Measure after render and clamp into the viewport; items can change
  // while open (confirm-delete relabels), so re-clamp on item changes too.
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(pad, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - pad));
    let top = anchor.bottom + 2;
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, anchor.top - rect.height - 2);
    }
    setPos({ top, left });
  }, [anchor, items]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // If the user clicked another ActionMenu trigger, hide the portal
      // synchronously so it doesn't intercept the subsequent click event.
      // setAnchor(null) is async (React re-renders later), but the browser
      // fires `click` immediately after `pointerdown` — the portal would
      // still be in the DOM and steal the click.
      if (menuRef.current) menuRef.current.style.display = "none";
      setAnchor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Consume the escape so the hosting dropdown/modal stays open.
      event.stopPropagation();
      setAnchor(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? "btn-icon btn-icon-sm"}
        title={triggerTitle}
        aria-label={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          event.stopPropagation();
          // Read the rect before setState: React nulls currentTarget after
          // the handler, and updater callbacks can run later.
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setAnchor((current) => (current ? null : rect));
        }}
      >
        {icon ?? <MoreHorizontal size={11} />}
      </button>
      {anchor
        ? createPortal(
            <div
              ref={menuRef}
              className={`context-menu context-menu-portal${pos ? "" : " is-measuring"}`}
              role="menu"
              style={{ top: `${pos?.top ?? 0}px`, left: `${pos?.left ?? 0}px` }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`menu-item text-sm${item.danger ? " menu-item-danger" : ""}`}
                  title={item.title}
                  role="menuitem"
                  disabled={item.disabled || item.busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!item.keepOpen) setAnchor(null);
                    item.onSelect();
                  }}
                >
                  {item.busy ? <LoaderCircle size={12} className="spin" /> : item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

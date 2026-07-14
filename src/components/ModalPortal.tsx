import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/// Renders children into a portal at `document.body`.
///
/// Modals rendered inside nested panel containers can be trapped behind
/// sibling panels when an ancestor creates a stacking context (e.g. via
/// `opacity` transitions, `will-change`, or `contain`). Portaling to the
/// body root eliminates this class of bug entirely — the overlay's
/// `position: fixed; z-index: 1000` always competes in the root stacking
/// context.
export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // During SSR or the first client render, `document.body` is not yet
  // available. Render nothing to avoid hydration mismatch; the effect
  // flips `mounted` immediately after mount.
  if (!mounted) return null;
  return createPortal(children, document.body);
}

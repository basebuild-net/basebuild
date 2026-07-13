/** Non-null Suspense fallback for user-opened modal bodies.
 *
 * The design contract requires that Suspense fallbacks for user-opened
 * surfaces are never `null` — a blank modal body looks broken. This component
 * renders the Basebuild logo with a breathing pulse plus a label so the user
 * sees immediate feedback while the lazy-loaded modal content resolves. */
import { LogoPulse } from "./LogoPulse";

export function ModalLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="modal-loading" role="status" aria-live="polite">
      <LogoPulse size={20} />
      <span>{label}</span>
    </div>
  );
}

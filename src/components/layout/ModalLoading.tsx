/** Non-null Suspense fallback for user-opened modal bodies.
 *
 * The design contract requires that Suspense fallbacks for user-opened
 * surfaces are never `null` — a blank modal body looks broken. This component
 * renders a centered spinner with a label so the user sees immediate feedback
 * while the lazy-loaded modal content resolves. */
export function ModalLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="modal-loading" role="status" aria-live="polite">
      <span className="is-spinning project-restore-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Shared loading affordances.
 *
 * The design contract is that no surface may render nothing, a false empty
 * state, or a false negative while its data is in flight. Before this, panels
 * either blanked out or actively lied ("Working tree is clean", "No projects
 * yet") and then snapped in.
 *
 * Pick by shape, not by taste:
 * - `LoadingBlock` when the whole panel/section has nothing to show yet.
 * - `SkeletonRows` when the shape of the result is known (a list or table);
 *   placeholder rows keep the layout from jumping when the data lands.
 * - `SkeletonText` for a single inline value inside otherwise-real content.
 *
 * All three are `role="status" aria-live="polite"` so screen readers announce
 * the wait instead of silence. */
import { LogoPulse } from "./LogoPulse";

/** Centred pulse + label. For a panel or section with no known result shape. */
export function LoadingBlock({
  label = "Loading…",
  compact = false,
}: {
  label?: string;
  /** Tighter padding for use inside an already-small card. */
  compact?: boolean;
}) {
  return (
    <div
      className={`bb-loading-block${compact ? " is-compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <LogoPulse size={compact ? 16 : 22} />
      <span className="text-muted text-sm">{label}</span>
    </div>
  );
}

/** Placeholder rows matching the shape of the list or table being loaded.
 *
 * Preferred over `LoadingBlock` wherever the result is a repeated row: the
 * layout settles once, when the skeleton mounts, instead of again when the
 * real content replaces it. */
export function SkeletonRows({
  rows = 3,
  label = "Loading…",
}: {
  rows?: number;
  /** Announced to assistive tech; the rows themselves are decorative. */
  label?: string;
}) {
  return (
    <div className="bb-skeleton-rows" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className="bb-skeleton" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

/** A single inline placeholder, sized in ch so it matches the text it stands
 * in for. Use inside a row that is otherwise real content. */
export function SkeletonText({ width = 8 }: { width?: number }) {
  return (
    <span
      className="bb-skeleton bb-skeleton-inline"
      style={{ width: `${width}ch` }}
      role="status"
      aria-label="Loading"
    />
  );
}

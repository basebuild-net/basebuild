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
import { Loader2 } from "lucide-react";
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

/** Stands in for a form control whose value is still loading.
 *
 * A checkbox bound to `state?.enabled ?? false` is not neutral while it
 * loads — it renders *unchecked*, which reads as "this setting is off". The
 * user can act on that before the real value arrives. Render this instead,
 * sized to the control it replaces so the row does not reflow.
 *
 * `label` is what the control is, not what it is doing: "Sync usage
 * automatically", not "Loading". */
export function SkeletonControl({
  label,
  size = 14,
}: {
  label: string;
  /** Pixel size; defaults to a checkbox footprint. Match the control it replaces. */
  size?: number;
}) {
  return (
    <span
      className="bb-skeleton-control"
      role="status"
      aria-label={`Loading ${label}`}
      title={`Loading ${label}…`}
    >
      <Loader2 size={size} className="spin" aria-hidden="true" />
    </span>
  );
}

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type DisclosureProps = {
  /** Toggle row label (short, always visible). */
  label: ReactNode;
  /** Compact one-line summary shown while collapsed. */
  summary?: ReactNode;
  /** Tooltip explaining what the section reveals. */
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

/** Collapsed-by-default section: a chevron toggle with an inline summary,
 *  revealing dense configuration or detail only on demand. The planning
 *  surfaces use this instead of always-visible flat input groups. */
export function Disclosure({ label, summary, title, defaultOpen = false, className, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button className="disclosure-toggle" type="button" title={title} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="disclosure-label">{label}</span>
        {!open && summary ? <span className="disclosure-summary text-muted">{summary}</span> : null}
      </button>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </div>
  );
}

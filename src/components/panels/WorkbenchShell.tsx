import type { ReactNode } from "react";

type WorkbenchShellProps = {
  ariaLabel: string;
  eyebrow: ReactNode;
  title: string;
  description?: string | null;
  headerActions?: ReactNode;
  progressLabel?: string;
  progressTitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  readOnly?: boolean;
};

export function WorkbenchShell({
  ariaLabel,
  eyebrow,
  title,
  description,
  headerActions,
  progressLabel,
  progressTitle,
  children,
  footer,
  className,
  readOnly = false,
}: WorkbenchShellProps) {
  const classes = [
    "interaction-workbench",
    readOnly ? "is-read-only" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <section className={classes} aria-label={ariaLabel}>
      <header className="interaction-workbench-header">
        <div className="interaction-workbench-heading">
          <span className="interaction-workbench-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {headerActions ? (
          <div className="interaction-workbench-header-actions">{headerActions}</div>
        ) : null}
      </header>

      {progressLabel || progressTitle ? (
        <div className="interaction-workbench-progress-row">
          {progressLabel ? <span className="interaction-workbench-progress">{progressLabel}</span> : null}
          {progressTitle ? <strong>{progressTitle}</strong> : null}
        </div>
      ) : null}

      {children}

      {footer ? <footer className="interaction-workbench-footer">{footer}</footer> : null}
    </section>
  );
}

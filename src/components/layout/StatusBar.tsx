import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { useLogs } from "../../state/log";

type StatusBarProps = {
  onClick: () => void;
};

const icons = {
  info: CheckCircle,
  warn: AlertTriangle,
  error: AlertCircle,
};

const levelClass = {
  info: "is-info",
  warn: "is-warn",
  error: "is-error",
};

export function StatusBar({ onClick }: StatusBarProps) {
  const { lastEntry, hasErrors, hasWarnings, logs } = useLogs();

  if (!lastEntry) {
    return (
      <button className="status-bar" type="button" onClick={onClick}>
        <span className="status-bar-message text-muted">No issues</span>
        <span className="status-bar-count">{logs.length} events</span>
      </button>
    );
  }

  const Icon = icons[lastEntry.level];
  const status = hasErrors ? "error" : hasWarnings ? "warn" : "info";

  return (
    <button
      className={`status-bar ${levelClass[status]}`}
      type="button"
      onClick={onClick}
      title="Click to view all warnings and errors"
    >
      <Icon size={12} />
      <span className="status-bar-message">{lastEntry.message}</span>
      <span className="status-bar-meta">
        {hasErrors ? `${logs.filter((l) => l.level === "error").length} error(s)` : null}
        {hasErrors && hasWarnings ? " · " : null}
        {hasWarnings ? `${logs.filter((l) => l.level === "warn").length} warning(s)` : null}
      </span>
      <span className="status-bar-count">{logs.length} events</span>
    </button>
  );
}

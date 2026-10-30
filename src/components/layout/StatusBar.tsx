import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { useLogs } from "../../state/log";
import { t } from "../../i18n";

type StatusBarProps = {
  onClick: () => void;
};

const icons = {
  debug: CheckCircle,
  info: CheckCircle,
  warn: AlertTriangle,
  error: AlertCircle,
};

const levelClass = {
  debug: "is-info",
  info: "is-info",
  warn: "is-warn",
  error: "is-error",
};

export function StatusBar({ onClick }: StatusBarProps) {
  const { lastEntry, hasErrors, hasWarnings, logs } = useLogs();

  if (!lastEntry) {
    return (
      <button className="status-bar" type="button" title={t("statusBar.openLogPanel")} onClick={onClick}>
        <span className="status-bar-message text-muted">{t("statusBar.noIssues")}</span>
        <span className="status-bar-count">{t("statusBar.events", { count: logs.length })}</span>
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
      title={t("statusBar.clickToViewAllWarnings")}
    >
      <span className="status-bar-message">
        <Icon size={10} />
        {lastEntry.message}
      </span>
      <span className="status-bar-meta">
        {hasErrors ? t("statusBar.errorS", { valueCount: logs.filter((l) => l.level === "error").length }) : null}
        {hasErrors && hasWarnings ? " · " : null}
        {hasWarnings ? t("statusBar.warningS", { valueCount: logs.filter((l) => l.level === "warn").length }) : null}
        {(hasErrors || hasWarnings) ? " · " : null}
        {t("statusBar.events", { count: logs.length })}
      </span>
    </button>
  );
}

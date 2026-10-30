import { AlertCircle, AlertTriangle } from "lucide-react";
import { useLogs } from "../../state/log";
import { t } from "../../i18n";

type StatusBarProps = {
  onClick: () => void;
};

/** Quiet by default: renders only while a warning or error is outstanding. */
export function StatusBar({ onClick }: StatusBarProps) {
  const { logs, addLog, hasErrors, hasWarnings } = useLogs();

  if (!hasErrors && !hasWarnings) return null;

  const Icon = hasErrors ? AlertCircle : AlertTriangle;
  const lastIssue = [...logs].reverse().find((entry) => entry.level === "error" || entry.level === "warn");
  const errorCount = logs.filter((entry) => entry.level === "error").length;
  const warnCount = logs.filter((entry) => entry.level === "warn").length;

  return (
    <button
      className={`status-bar ${hasErrors ? "is-error" : "is-warn"}`}
      type="button"
      onClick={() => {
        addLog("debug", "Status bar: open log panel");
        onClick();
      }}
      title={t("statusBar.clickToViewAllWarnings")}
    >
      <span className="status-bar-message">
        <Icon size={10} />
        {lastIssue?.message}
      </span>
      <span className="status-bar-meta">
        {hasErrors ? t("statusBar.errorS", { valueCount: errorCount }) : null}
        {hasErrors && hasWarnings ? " · " : null}
        {hasWarnings ? t("statusBar.warningS", { valueCount: warnCount }) : null}
      </span>
    </button>
  );
}

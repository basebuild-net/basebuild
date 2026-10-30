import { Activity, RefreshCw } from "lucide-react";

import { TerminalPanel } from "./TerminalPanel";
import { useOmpTelemetry } from "../../state/ompTelemetry";
import type { OmpUsageWindow } from "../../lib/ompTelemetry";
import { t } from "../../i18n";
import { formatAgo } from "../../i18n/format";

type OmpTerminalTabProps = {
  terminalId: number | null;
  onOutput?: (data: string) => void;
  onReconnect?: () => void;
};

function severityClass(severity: string): string {
  switch (severity) {
    case "ok":
      return "omp-sev-ok";
    case "warning":
      return "omp-sev-warning";
    case "critical":
      return "omp-sev-critical";
    default:
      return "omp-sev-unknown";
  }
}

function formatAge(minutes?: number): string {
  if (minutes == null) return "?";
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return formatAgo(Math.round(minutes), "minute");
  const hours = minutes / 60;
  if (hours < 24) return formatAgo(Math.round(hours), "hour");
  return formatAgo(Math.round(hours / 24), "day");
}

function WindowBar({ window: w }: { window: OmpUsageWindow }) {
  const pct = Math.round(w.usedFraction * 100);
  return (
    <div
      className={`omp-window-row ${w.isStale ? "is-stale" : ""} ${severityClass(w.severity)}`}
      title={t((w.isStale ? "ompTerminalTab.used.stale" : "ompTerminalTab.used.none"), { window: w.window, pct: pct, value: w.resetsAt ? t("ompTerminalTab.resets", { resetsAt: w.resetsAt }) : "" })}
    >
      <span className="omp-window-label">{w.window}</span>
      <div className="omp-window-bar">
        <div className="omp-window-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="omp-window-pct">{pct}%</span>
      {w.isStale ? <span className="omp-window-stale">{t("ompTerminalTab.stale", { ageMinutes: formatAge(w.ageMinutes) })}</span> : null}
    </div>
  );
}
export function OmpTerminalTab({ terminalId, onOutput, onReconnect }: OmpTerminalTabProps) {
  const { context, loading, refresh } = useOmpTelemetry();

  const attached = context?.attachment.state === "attached";
  const stale = context?.attachment.state === "stale";
  const detached = context?.attachment.state === "detached";

  return (
    <div className="omp-terminal-tab">
      <div className="omp-telemetry-hud">
        <div className="omp-hud-header">
          <span className="omp-hud-title" title={t("ompTerminalTab.oMPSessionTelemetry")}>
            <Activity size={11} /> {t("ompTerminalTab.telemetry")}
          </span>
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title={t("ompTerminalTab.refreshTelemetry")}
            onClick={() => void refresh()}
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {loading && !context ? (
          <span className="text-muted text-sm">{t("ompTerminalTab.loading")}</span>
        ) : detached ? (
          <span className="text-muted text-sm">
            {t("ompTerminalTab.detached")}{context?.attachment.state === "detached" && "reason" in context.attachment && context.attachment.reason ? t("ompTerminalTab.text", { reason: context.attachment.reason }) : ""}
          </span>
        ) : (
          <div className="omp-hud-body">
            <div className="omp-hud-row">
              <span className="omp-hud-label">{t("ompTerminalTab.provider")}</span>
              <span className="omp-hud-value">{context?.provider ?? t("ompTerminalTab.unknown")}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">{t("ompTerminalTab.model")}</span>
              <span className="omp-hud-value">{context?.model ?? t("ompTerminalTab.unknown")}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">{t("ompTerminalTab.plan")}</span>
              <span className="omp-hud-value">{context?.planTier ?? t("ompTerminalTab.unknown")}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">{t("ompTerminalTab.effort")}</span>
              <span className="omp-hud-value">{context?.effort ?? t("ompTerminalTab.unknown")}</span>
            </div>
            {stale ? (
              <span className="omp-stale-badge" title={t("ompTerminalTab.telemetryDataIsStale")}>
                {t("ompTerminalTab.stale2")}
              </span>
            ) : null}
            {attached ? (
              <span className="omp-live-badge" title={t("ompTerminalTab.liveSessionAttached")}>
                {t("ompTerminalTab.live")}
              </span>
            ) : null}
            {context?.windows.length ? (
              <div className="omp-windows">
                {context.windows.map((w, i) => (
                  <WindowBar key={`${i}-${w.window}`} window={w} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="omp-terminal-body">
        <TerminalPanel terminalId={terminalId} onOutput={onOutput} onReconnect={onReconnect} />
      </div>
    </div>
  );
}

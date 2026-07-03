import { Activity, RefreshCw } from "lucide-react";

import { TerminalPanel } from "./TerminalPanel";
import { useOmpTelemetry } from "../../state/ompTelemetry";
import type { OmpUsageWindow } from "../../lib/ompTelemetry";

type OmpTerminalTabProps = {
  terminalId: number | null;
  onOutput?: (data: string) => void;
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
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function WindowBar({ window: w }: { window: OmpUsageWindow }) {
  const pct = Math.round(w.usedFraction * 100);
  return (
    <div
      className={`omp-window-row ${w.isStale ? "is-stale" : ""} ${severityClass(w.severity)}`}
      title={`${w.window}: ${pct}% used${w.resetsAt ? ` · resets ${w.resetsAt}` : ""}${w.isStale ? " · stale" : ""}`}
    >
      <span className="omp-window-label">{w.window}</span>
      <div className="omp-window-bar">
        <div className="omp-window-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="omp-window-pct">{pct}%</span>
      {w.isStale ? <span className="omp-window-stale">stale · {formatAge(w.ageMinutes)}</span> : null}
    </div>
  );
}

export function OmpTerminalTab({ terminalId, onOutput }: OmpTerminalTabProps) {
  const { context, loading, refresh } = useOmpTelemetry();

  const attached = context?.attachment.state === "attached";
  const stale = context?.attachment.state === "stale";
  const detached = context?.attachment.state === "detached";

  return (
    <div className="omp-terminal-tab">
      <div className="omp-telemetry-hud">
        <div className="omp-hud-header">
          <span className="omp-hud-title" title="OMP session telemetry">
            <Activity size={11} /> Telemetry
          </span>
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title="Refresh telemetry"
            onClick={() => void refresh()}
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {loading && !context ? (
          <span className="text-muted text-sm">Loading…</span>
        ) : detached ? (
          <span className="text-muted text-sm">
            Detached{context?.attachment.state === "detached" && "reason" in context.attachment && context.attachment.reason ? `: ${context.attachment.reason}` : ""}
          </span>
        ) : (
          <div className="omp-hud-body">
            <div className="omp-hud-row">
              <span className="omp-hud-label">Provider</span>
              <span className="omp-hud-value">{context?.provider ?? "unknown"}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">Model</span>
              <span className="omp-hud-value">{context?.model ?? "unknown"}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">Plan</span>
              <span className="omp-hud-value">{context?.planTier ?? "unknown"}</span>
            </div>
            <div className="omp-hud-row">
              <span className="omp-hud-label">Effort</span>
              <span className="omp-hud-value">{context?.effort ?? "unknown"}</span>
            </div>
            {stale ? (
              <span className="omp-stale-badge" title="Telemetry data is stale">
                stale
              </span>
            ) : null}
            {attached ? (
              <span className="omp-live-badge" title="Live session attached">
                live
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
        <TerminalPanel terminalId={terminalId} onOutput={onOutput} />
      </div>
    </div>
  );
}

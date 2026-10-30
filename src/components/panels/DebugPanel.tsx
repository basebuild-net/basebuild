import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, DollarSign, Cpu, RefreshCw, Settings, TerminalSquare, Trash2 } from "lucide-react";

import { appVersion } from "../../lib/app";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { ompDebugContext, ompStatus, type OmpStatus } from "../../lib/omp";
import { listTerminals, type TerminalSession } from "../../lib/terminal";
import {
  stabilityListReports,
  stabilityDeleteReport,
  stabilityMarkSeen,
  stabilityUnseenCount,
  stabilityRecentTelemetry,
  stabilityViolations,
  type StabilityReport,
  type CommandTelemetryEntry,
} from "../../lib/stability";
import { OmpPanel } from "./OmpPanel";
import { useOmpState } from "../../state/omp";
import { LoadingBlock, SkeletonRows } from "../layout/Loading";
import { t } from "../../i18n";

type DebugData = {
  appVersion: string;
  platform: string;
  requirements: RequirementStatus[];
  omp: OmpStatus | null;
  context: { stats: unknown; usage: unknown; config: unknown } | null;
};

function formatTimestamp(ts: number): string {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString();
}

function formatDuration(ts: number): string {
  if (!ts) return "-";
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function DebugPanel() {
  const [data, setData] = useState<DebugData | null>(null);
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<StabilityReport[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [telemetry, setTelemetry] = useState<CommandTelemetryEntry[]>([]);
  const [violations, setViolations] = useState<CommandTelemetryEntry[]>([]);
  // `loadAll` fires `refreshStability` without awaiting it, so the stability
  // sections settle after `data` lands and need their own flag.
  const [stabilityLoading, setStabilityLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<StabilityReport | null>(null);

  const refreshTerminals = useCallback(async () => {
    try {
      setTerminals(await listTerminals());
    } catch {
      setTerminals([]);
    }
  }, []);

  const refreshStability = useCallback(async () => {
    try {
      const [rpts, unseen, tel, viols] = await Promise.all([
        stabilityListReports(),
        stabilityUnseenCount(),
        stabilityRecentTelemetry(20),
        stabilityViolations(),
      ]);
      setReports(rpts);
      setUnseenCount(unseen);
      setTelemetry(tel);
      setViolations(viols);
    } catch {
      // ignore
    } finally {
      setStabilityLoading(false);
    }
  }, []);


  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [version, requirements, omp, terms] = await Promise.all([
        appVersion(),
        listRequirements(),
        ompStatus(),
        listTerminals(),
      ]);
      let context: { stats: unknown; usage: unknown; config: unknown } | null = null;
      if (omp.installed) {
        try { context = await ompDebugContext(); } catch { /* ignore */ }
      }
      setData({
        appVersion: version,
        platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
        requirements, omp, context,
      });
      setTerminals(terms);
      void refreshStability();
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [refreshStability]);

  useEffect(() => {
    void loadAll();
    // Auto-refresh terminal list every 3 seconds
    const interval = setInterval(() => void refreshTerminals(), 3000);
    return () => clearInterval(interval);
  }, [loadAll, refreshTerminals]);

  const ompState = useOmpState();

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <LoadingBlock label={t("debugPanel.loadingDebugData")} />;

  const stats = data.context?.stats as { overall?: { totalRequests?: number; totalCost?: number; avgTtft?: number; avgTokensPerSecond?: number } } | undefined;
  const overall = stats?.overall;

  return (
    <div className="stack">
      <div className="debug-section">
        <div className="row-between">
          <h3>{t("debugPanel.app")}</h3>
          <button
            className="btn-icon btn-icon-sm"
            title={t("debugPanel.refreshDebugData")}
            onClick={() => void loadAll()}
            disabled={loading}
            type="button"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>
        {/* Version — compiled in at build time. "0.0.0" in dev; real version in
            release builds (set by .github/workflows/windows.yml). */}
        <div className="debug-grid">
          <div className="debug-item"><span>{t("debugPanel.version")}</span><strong>{data.appVersion}</strong></div>
          <div className="debug-item"><span>{t("debugPanel.platform")}</span><strong>{data.platform}</strong></div>
        </div>
      </div>

      {/* Terminal sessions */}
      <div className="debug-section">
        <div className="row-between">
          <h3>{t("debugPanel.terminalSessions", { terminalsCount: terminals.length })}</h3>
          <button
            className="btn-icon btn-icon-sm"
            title={t("debugPanel.refreshTerminals")}
            onClick={() => void refreshTerminals()}
            type="button"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {loading && terminals.length === 0 ? (
          <SkeletonRows rows={2} label={t("debugPanel.loadingTerminalSessions")} />
        ) : terminals.length === 0 ? (
          <p className="text-muted text-sm pad">{t("debugPanel.noActiveTerminals")}</p>
        ) : (
          <div className="terminal-debug-list">
            {terminals.map((terminal) => (
              <div className="terminal-debug-card" key={terminal.id}>
                <div className="terminal-debug-card-header">
                  <span className="terminal-debug-card-title">
                    <TerminalSquare size={12} className="icon-inline-mr" />
                    #{terminal.id} · {terminal.shell}
                  </span>
                  <span className={`terminal-debug-card-status ${terminal.alive ? "is-active" : "is-dead"}`}>
                    {terminal.alive ? t("debugPanel.active") : t("debugPanel.dead")}
                  </span>
                </div>
                <div className="terminal-debug-grid">
                  <span>{t("debugPanel.pID", { pid: terminal.pid ?? "-" })}</span>
                  <span>{t("debugPanel.size", { rows: terminal.rows, cols: terminal.cols })}</span>
                  <span>{t("debugPanel.started", { startedAt: formatTimestamp(terminal.startedAt) })}</span>
                  <span>{t("debugPanel.uptime", { uptime: formatDuration(terminal.startedAt) })}</span>
                  {terminal.cwd ? <span className="grid-span-2" title={terminal.cwd}>{t("debugPanel.cWD", { cwd: terminal.cwd })}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="debug-section">
        <h3>{t("debugPanel.requirements")}</h3>
        <div className="debug-grid">
          {data.requirements.map((req) => (
            <div className="debug-item" key={req.id}>
              <span>{req.label}</span>
              <strong className={req.installed ? "text-ok" : "text-danger"}>
                {req.installed ? t("debugPanel.installed2", { value: req.version ? ` (${req.version})` : "" }) : t("debugPanel.missing")}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {data.omp ? (
        <div className="debug-section">
          <h3>{t("debugPanel.oMP")}</h3>
          <div className="debug-grid">
            <div className="debug-item">
              <span>{t("debugPanel.status")}</span>
              <strong className={data.omp.installed ? "text-ok" : "text-danger"}>
                {data.omp.installed ? t("debugPanel.installed") : t("debugPanel.notInstalled")}
              </strong>
            </div>
            {data.omp.version ? <div className="debug-item"><span>{t("debugPanel.version")}</span><strong>{data.omp.version}</strong></div> : null}
            {data.omp.configPath ? <div className="debug-item"><span>{t("debugPanel.config")}</span><strong className="mono text-sm">{data.omp.configPath}</strong></div> : null}
          </div>
        </div>
      ) : null}

      {overall ? (
        <div className="debug-section">
          <h3>{t("debugPanel.oMPStats")}</h3>
          <div className="debug-stats-grid">
            <div className="debug-stat-card"><Activity size={16} /><div><span>{t("debugPanel.requests")}</span><strong>{overall.totalRequests?.toLocaleString() ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><DollarSign size={16} /><div><span>{t("debugPanel.cost")}</span><strong>${overall.totalCost?.toFixed(2) ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><Cpu size={16} /><div><span>{t("debugPanel.tokensS")}</span><strong>{overall.avgTokensPerSecond?.toFixed(1) ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><Settings size={16} /><div><span>{t("debugPanel.avgTtft")}</span><strong>{overall.avgTtft ? t("debugPanel.s", { value: (overall.avgTtft / 1000).toFixed(1) }) : "-"}</strong></div></div>
          </div>
        </div>
      ) : null}

      {data.context ? (
        <div className="debug-section">
          <h3>{t("debugPanel.rawContext")}</h3>
          <details><summary>{t("debugPanel.statsJson")}</summary><pre className="pre">{JSON.stringify(data.context.stats, null, 2)}</pre></details>
          <details><summary>{t("debugPanel.usageJson")}</summary><pre className="pre">{JSON.stringify(data.context.usage, null, 2)}</pre></details>
          <details><summary>{t("debugPanel.configJson")}</summary><pre className="pre">{JSON.stringify(data.context.config, null, 2)}</pre></details>
        </div>
      ) : null}

      <div className="debug-section">
        <h3>{t("debugPanel.oMPConsole")}</h3>
        <OmpPanel state={ompState} />
      </div>

      {/* ─── Stability Reports ─── */}
      <div className="debug-section">
        <h3>
          <AlertTriangle size={14} /> {t("debugPanel.crashAndFreezeReports")}
          {unseenCount > 0 ? <span className="badge badge-error">{t("debugPanel.new", { unseenCount: unseenCount })}</span> : null}
        </h3>
        {stabilityLoading && reports.length === 0 ? (
          <SkeletonRows rows={2} label={t("debugPanel.loadingCrashAndFreezeReports")} />
        ) : reports.length === 0 ? (
          <p className="text-muted text-sm">{t("debugPanel.noCrashOrFreezeReports")}</p>
        ) : (
          <div className="stack">
            {reports.map((rpt) => (
              <div key={rpt.id} className="debug-item debug-item-col">
                <div className="row align-center justify-between">
                  <span>
                    <span className={`badge badge-${rpt.kind === "panic" ? "error" : rpt.kind === "freeze" ? "warning" : "info"}`}>{rpt.kind}</span>
                    {" "}{rpt.summary.slice(0, 80)}{rpt.summary.length > 80 ? "…" : ""}
                    {" "}<span className="text-muted text-xs">{new Date(rpt.timestamp * 1000).toLocaleString()}</span>
                  </span>
                  <div className="row gap-sm">
                    <button
                      className="btn btn-sm"
                      type="button"
                      title={t("debugPanel.viewFullReport")}
                      onClick={() => { setSelectedReport(rpt); if (!rpt.seen) void stabilityMarkSeen(rpt.id).then(() => void refreshStability()); }}
                    >
                      {t("debugPanel.view")}
                    </button>
                    <button
                      className="btn btn-sm"
                      type="button"
                      title={t("debugPanel.deleteThisReport")}
                      onClick={() => void stabilityDeleteReport(rpt.id).then(() => void refreshStability())}
                    >
                      <Trash2 size={12} />
                    </button>
                    <a
                      className="btn btn-sm"
                      title={t("debugPanel.fileAGithubIssueWith")}
                      href={`https://github.com/basebuild-net/basebuild/issues/new?title=${encodeURIComponent(rpt.summary)}&body=${encodeURIComponent(rpt.details)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("debugPanel.fileIssue")}
                    </a>
                  </div>
                </div>
                {selectedReport?.id === rpt.id ? (
                  <pre className="text-xs mono debug-pre-block">
                    {rpt.details}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Slow Commands ─── */}
      <div className="debug-section">
        <h3><Activity size={14} /> {t("debugPanel.commandTelemetry")}</h3>
        {violations.length > 0 ? (
          <div className="stack mb-8">
            <h4 className="text-danger text-sm">{t("debugPanel.violationsSync50ms")}</h4>
            {violations.slice(0, 10).map((v, i) => (
              <div key={i} className="debug-item">
                <span className="mono text-sm">{v.command}</span>
                <strong className="text-danger">{t("debugPanel.ms", { durationMs: v.durationMs })}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {telemetry.length > 0 ? (
          <div className="stack">
            <h4 className="text-muted text-sm">{t("debugPanel.recentSlowestFirst")}</h4>
            {telemetry.slice(0, 10).map((entry, i) => (
              <div key={i} className="debug-item">
                <span className="mono text-sm">{entry.command}</span>
                <strong className={entry.violation ? "text-danger" : ""}>{t("debugPanel.ms2", { durationMs: entry.durationMs })}</strong>
              </div>
            ))}
          </div>
        ) : stabilityLoading ? (
          <SkeletonRows rows={3} label={t("debugPanel.loadingCommandTelemetry")} />
        ) : (
          <p className="text-muted text-sm">{t("debugPanel.noTelemetryYet")}</p>
        )}
      </div>
    </div>
  );
}

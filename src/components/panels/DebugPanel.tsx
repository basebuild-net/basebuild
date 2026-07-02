import { useCallback, useEffect, useState } from "react";
import { Activity, DollarSign, Cpu, RefreshCw, Settings, TerminalSquare } from "lucide-react";

import { appVersion } from "../../lib/app";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { ompDebugContext, ompStatus, type OmpStatus } from "../../lib/omp";
import { listTerminals, type TerminalSession } from "../../lib/terminal";
import { OmpPanel } from "./OmpPanel";
import { useOmpState } from "../../state/omp";

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
  const [loading, setLoading] = useState(false);

  const refreshTerminals = useCallback(async () => {
    try {
      setTerminals(await listTerminals());
    } catch {
      setTerminals([]);
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
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void loadAll();
    // Auto-refresh terminal list every 3 seconds
    const interval = setInterval(() => void refreshTerminals(), 3000);
    return () => clearInterval(interval);
  }, [loadAll, refreshTerminals]);

  const ompState = useOmpState();

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const stats = data.context?.stats as { overall?: { totalRequests?: number; totalCost?: number; avgTtft?: number; avgTokensPerSecond?: number } } | undefined;
  const overall = stats?.overall;

  return (
    <div className="stack">
      <div className="debug-section">
        <div className="row-between">
          <h3>App</h3>
          <button
            className="btn-icon btn-icon-sm"
            title="Refresh debug data"
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
          <div className="debug-item"><span>Version</span><strong>{data.appVersion}</strong></div>
          <div className="debug-item"><span>Platform</span><strong>{data.platform}</strong></div>
        </div>
      </div>

      {/* Terminal sessions */}
      <div className="debug-section">
        <div className="row-between">
          <h3>Terminal Sessions ({terminals.length})</h3>
          <button
            className="btn-icon btn-icon-sm"
            title="Refresh terminals"
            onClick={() => void refreshTerminals()}
            type="button"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {terminals.length === 0 ? (
          <p className="text-muted text-sm pad">No active terminals.</p>
        ) : (
          <div className="terminal-debug-list">
            {terminals.map((t) => (
              <div className="terminal-debug-card" key={t.id}>
                <div className="terminal-debug-card-header">
                  <span className="terminal-debug-card-title">
                    <TerminalSquare size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    #{t.id} · {t.shell}
                  </span>
                  <span className={`terminal-debug-card-status ${t.alive ? "is-active" : "is-dead"}`}>
                    {t.alive ? "Active" : "Dead"}
                  </span>
                </div>
                <div className="terminal-debug-grid">
                  <span>PID: {t.pid ?? "-"}</span>
                  <span>Size: {t.rows}×{t.cols}</span>
                  <span>Started: {formatTimestamp(t.startedAt)}</span>
                  <span>Uptime: {formatDuration(t.startedAt)}</span>
                  {t.cwd ? <span style={{ gridColumn: "span 2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.cwd}>CWD: {t.cwd}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="debug-section">
        <h3>Requirements</h3>
        <div className="debug-grid">
          {data.requirements.map((req) => (
            <div className="debug-item" key={req.id}>
              <span>{req.label}</span>
              <strong className={req.installed ? "text-ok" : "text-danger"}>
                {req.installed ? `Installed${req.version ? ` (${req.version})` : ""}` : "Missing"}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {data.omp ? (
        <div className="debug-section">
          <h3>OMP</h3>
          <div className="debug-grid">
            <div className="debug-item">
              <span>Status</span>
              <strong className={data.omp.installed ? "text-ok" : "text-danger"}>
                {data.omp.installed ? "Installed" : "Not installed"}
              </strong>
            </div>
            {data.omp.version ? <div className="debug-item"><span>Version</span><strong>{data.omp.version}</strong></div> : null}
            {data.omp.configPath ? <div className="debug-item"><span>Config</span><strong className="mono text-sm">{data.omp.configPath}</strong></div> : null}
          </div>
        </div>
      ) : null}

      {overall ? (
        <div className="debug-section">
          <h3>OMP Stats</h3>
          <div className="debug-stats-grid">
            <div className="debug-stat-card"><Activity size={16} /><div><span>Requests</span><strong>{overall.totalRequests?.toLocaleString() ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><DollarSign size={16} /><div><span>Cost</span><strong>${overall.totalCost?.toFixed(2) ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><Cpu size={16} /><div><span>Tokens/s</span><strong>{overall.avgTokensPerSecond?.toFixed(1) ?? "-"}</strong></div></div>
            <div className="debug-stat-card"><Settings size={16} /><div><span>Avg TTFT</span><strong>{overall.avgTtft ? `${(overall.avgTtft / 1000).toFixed(1)}s` : "-"}</strong></div></div>
          </div>
        </div>
      ) : null}

      {data.context ? (
        <div className="debug-section">
          <h3>Raw context</h3>
          <details><summary>Stats JSON</summary><pre className="pre">{JSON.stringify(data.context.stats, null, 2)}</pre></details>
          <details><summary>Usage JSON</summary><pre className="pre">{JSON.stringify(data.context.usage, null, 2)}</pre></details>
          <details><summary>Config JSON</summary><pre className="pre">{JSON.stringify(data.context.config, null, 2)}</pre></details>
        </div>
      ) : null}

      <div className="debug-section">
        <h3>OMP Console</h3>
        <OmpPanel state={ompState} />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Activity, DollarSign, Cpu, Settings } from "lucide-react";

import { appVersion } from "../../lib/app";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { ompDebugContext, ompStatus, type OmpStatus } from "../../lib/omp";

type DebugData = {
  appVersion: string;
  platform: string;
  requirements: RequirementStatus[];
  omp: OmpStatus | null;
  context: { stats: unknown; usage: unknown; config: unknown } | null;
};

export function DebugPanel() {
  const [data, setData] = useState<DebugData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [version, requirements, omp] = await Promise.all([appVersion(), listRequirements(), ompStatus()]);
        let context: { stats: unknown; usage: unknown; config: unknown } | null = null;
        if (omp.installed) {
          try { context = await ompDebugContext(); } catch { /* ignore */ }
        }
        if (!cancelled) setData({
          appVersion: version,
          platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
          requirements, omp, context,
        });
      } catch (err) { if (!cancelled) setError(String(err)); }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const stats = data.context?.stats as { overall?: { totalRequests?: number; totalCost?: number; avgTtft?: number; avgTokensPerSecond?: number } } | undefined;
  const overall = stats?.overall;

  return (
    <div className="stack">
      <div className="debug-section">
        <h3>App</h3>
        <div className="debug-grid">
          <div className="debug-item"><span>Version</span><strong>{data.appVersion}</strong></div>
          <div className="debug-item"><span>Platform</span><strong>{data.platform}</strong></div>
        </div>
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
            <div className="debug-stat-card"><Activity size={16} /><div><span>Requests</span><strong>{overall.totalRequests?.toLocaleString() ?? "—"}</strong></div></div>
            <div className="debug-stat-card"><DollarSign size={16} /><div><span>Cost</span><strong>${overall.totalCost?.toFixed(2) ?? "—"}</strong></div></div>
            <div className="debug-stat-card"><Cpu size={16} /><div><span>Tokens/s</span><strong>{overall.avgTokensPerSecond?.toFixed(1) ?? "—"}</strong></div></div>
            <div className="debug-stat-card"><Settings size={16} /><div><span>Avg TTFT</span><strong>{overall.avgTtft ? `${(overall.avgTtft / 1000).toFixed(1)}s` : "—"}</strong></div></div>
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
    </div>
  );
}

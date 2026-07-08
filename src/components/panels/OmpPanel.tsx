import { useState } from "react";
import { Play, Zap } from "lucide-react";

import { useOmpState, type OmpController } from "../../state/omp";

type OmpPanelProps = {
  state: OmpController;
};

export function OmpPanel({ state }: OmpPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState<string[]>([]);

  async function runPrompt() {
    if (!prompt.trim().length || state.busy) return;
    setOutput([]);
    await state.runStream([prompt], (event: { kind: string; line?: string }) => {
      if (event.kind === "line" && typeof event.line === "string") {
        const line = event.line;
        setOutput((current) => [...current, line]);
      }
    });
  }

  async function quickstart() {
    if (state.busy) return;
    setOutput([]);
    await state.runStream(["--version"], (event: { kind: string; line?: string }) => {
      if (event.kind === "line" && typeof event.line === "string") {
        const line = event.line;
        setOutput((current) => [...current, line]);
      }
    });
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="omp-status-row">
          <h3>OMP status</h3>
          {state.status?.installed ? (
            <button className="btn btn-ghost" disabled={state.busy} onClick={() => void quickstart()} type="button">
              <Zap size={14} /> Quickstart
            </button>
          ) : null}
        </div>
        {state.status === null ? (
          <p className="text-muted">Loading…</p>
        ) : state.status.installed ? (
          <div className="omp-info">
            <span className="pill is-ok">Installed</span>
            {state.status.version ? <span className="text-sm text-muted">{state.status.version}</span> : null}
            {state.status.configPath ? <span className="text-sm text-muted mono">{state.status.configPath}</span> : null}
          </div>
        ) : (
          <div className="omp-info">
            <span className="pill pill-danger">Not installed</span>
            {state.status.message ? <span className="text-sm text-muted">{state.status.message}</span> : null}
          </div>
        )}
      </div>

      {state.config ? (
        <div className="card">
          <h4>Config</h4>
          {state.config.success ? (
            <pre className="pre">{state.config.json ? JSON.stringify(state.config.json, null, 2) : state.config.stdout}</pre>
          ) : (
            <p className="text-danger text-sm">{state.config.stderr || "Failed to load config."}</p>
          )}
        </div>
      ) : null}

      {state.busy ? <p className="text-muted text-sm">Running…</p> : null}
      {state.error ? <p className="text-danger text-sm">{state.error}</p> : null}

      {state.status?.installed ? (
        <div className="card">
          <h4>Run prompt</h4>
          <div className="row gap-sm">
            <input
              className="input"
              placeholder="Ask OMP…"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runPrompt(); }}
            />
            <button className="btn btn-primary" disabled={state.busy} onClick={() => void runPrompt()} type="button">
              <Play size={14} /> Run
            </button>
          </div>
          {output.length > 0 ? (
            <div className="omp-output-box mt-8">
              {output.map((line, i) => <pre key={i}>{line}</pre>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function useOmpPanelState() {
  return useOmpState();
}

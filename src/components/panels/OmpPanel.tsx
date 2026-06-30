import { useOmpState, type OmpController } from "../../state/omp";

type OmpPanelProps = {
  state: OmpController;
};

import { useState } from "react";

export function OmpPanel({ state }: OmpPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState<string[]>([]);

  async function runPrompt() {
    if (!prompt.trim().length || state.busy) {
      return;
    }
    setOutput([]);
    await state.runStream([prompt], (event: { kind: string; line?: string }) => {
      if (event.kind === "line" && typeof event.line === "string") {
        const line = event.line;
        setOutput((current) => [...current, line]);
      }
    });
  }

  return (
    <div className="omp-panel">
      <div className="omp-status">
        <h3>OMP status</h3>
        {state.status === null ? (
          <p>Loading OMP status…</p>
        ) : state.status.installed ? (
          <div className="omp-info">
            <p className="omp-pill is-ok">Installed</p>
            {state.status.version ? <p>Version: {state.status.version}</p> : null}
            {state.status.configPath ? <p>Config path: {state.status.configPath}</p> : null}
          </div>
        ) : (
          <div className="omp-info">
            <p className="omp-pill is-error">Not installed</p>
            {state.status.message ? <p>{state.status.message}</p> : null}
          </div>
        )}
      </div>

      {state.config ? (
        <div className="omp-config">
          <h4>Config list</h4>
          {state.config.success ? (
            <pre>{state.config.json ? JSON.stringify(state.config.json, null, 2) : state.config.stdout}</pre>
          ) : (
            <p className="omp-error">{state.config.stderr || "Failed to load config."}</p>
          )}
        </div>
      ) : null}

      {state.busy ? <p className="omp-busy">Running OMP command…</p> : null}
      {state.error ? <p className="omp-error">{state.error}</p> : null}

      {state.status?.installed ? (
        <div className="omp-prompt">
          <label className="omp-label" htmlFor="omp-prompt-input">
            Run an OMP prompt
          </label>
          <input
            id="omp-prompt-input"
            className="omp-input"
            placeholder="Ask OMP to do something…"
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runPrompt();
              }
            }}
          />
          <button className="primary-action" disabled={state.busy} onClick={() => void runPrompt()} type="button">
            Run
          </button>
          {output.length > 0 ? (
            <div className="omp-output">
              {output.map((line, index) => (
                <pre key={index}>{line}</pre>
              ))}
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

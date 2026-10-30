import { useState } from "react";
import { Play, Zap } from "lucide-react";

import { useOmpState, type OmpController } from "../../state/omp";
import { LoadingBlock } from "../layout/Loading";
import { t } from "../../i18n";
import { isImeComposing } from "../../lib/keyboard";

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

  // Until the mount fetch settles, `status`/`config` are null and every branch
  // below would read as a negative: "Not installed", no config, no prompt box.
  if (state.loading) {
    return (
      <div className="stack">
        <div className="card">
          <h3>{t("ompPanel.oMPStatus")}</h3>
          <LoadingBlock label={t("ompPanel.checkingOmpStatus")} compact />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="omp-status-row">
          <h3>{t("ompPanel.oMPStatus")}</h3>
          {state.status?.installed ? (
            <button className="btn btn-ghost" title={t("ompPanel.runOmpQuickstart")} disabled={state.busy} onClick={() => void quickstart()} type="button">
              <Zap size={14} /> {t("ompPanel.quickstart")}
            </button>
          ) : null}
        </div>
        {state.status === null ? (
          <p className="text-muted">{t("ompPanel.oMPStatusUnavailable")}</p>
        ) : state.status.installed ? (
          <div className="omp-info">
            <span className="pill is-ok">{t("ompPanel.installed")}</span>
            {state.status.version ? <span className="text-sm text-muted">{state.status.version}</span> : null}
            {state.status.configPath ? <span className="text-sm text-muted mono">{state.status.configPath}</span> : null}
          </div>
        ) : (
          <div className="omp-info">
            <span className="pill pill-danger">{t("ompPanel.notInstalled")}</span>
            {state.status.message ? <span className="text-sm text-muted">{state.status.message}</span> : null}
          </div>
        )}
      </div>

      {state.config ? (
        <div className="card">
          <h4>{t("ompPanel.config")}</h4>
          {state.config.success ? (
            <pre className="pre">{state.config.json ? JSON.stringify(state.config.json, null, 2) : state.config.stdout}</pre>
          ) : (
            <p className="text-danger text-sm">{state.config.stderr || t("ompPanel.failedToLoadConfig")}</p>
          )}
        </div>
      ) : null}

      {state.busy ? <p className="text-muted text-sm">{t("ompPanel.running")}</p> : null}
      {state.error ? <p className="text-danger text-sm">{state.error}</p> : null}

      {state.status?.installed ? (
        <div className="card">
          <h4>{t("ompPanel.runPrompt")}</h4>
          <div className="row gap-sm">
            <input
              className="input"
              placeholder={t("ompPanel.askOmp")}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isImeComposing(e)) void runPrompt(); }}
            />
            <button className="btn btn-primary" title={t("ompPanel.runOmpPrompt")} disabled={state.busy} onClick={() => void runPrompt()} type="button">
              <Play size={14} /> {t("ompPanel.run")}
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

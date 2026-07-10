import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, Terminal, Wrench } from "lucide-react";
import {
  openspecRuntimeStatus,
  openspecRuntimeInstall,
  openspecRuntimeUpdate,
  type OpenSpecRuntimeStatus,
} from "../../lib/openspecRuntime";

type OpenSpecSettingsTabProps = {
  projectPath: string | null;
};

export function OpenSpecSettingsTab({ projectPath }: OpenSpecSettingsTabProps) {
  const [status, setStatus] = useState<OpenSpecRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const s = await openspecRuntimeStatus(projectPath);
      setStatus(s);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleInstall() {
    setActionError(null);
    try {
      const s = await openspecRuntimeInstall(projectPath);
      setStatus(s);
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function handleUpdate() {
    setActionError(null);
    try {
      const s = await openspecRuntimeUpdate(projectPath);
      setStatus(s);
    } catch (e) {
      setActionError(String(e));
    }
  }

  const state = status?.state ?? "missing";
  const isReady = state === "ready";
  const isMissing = state === "missing";
  const isError = state === "error";
  const isInstalling = state === "installing";

  return (
    <div className="stack">
      <div className="settings-section-header">
        <h3>OpenSpec Runtime</h3>
        <button
          className="btn btn-sm"
          type="button"
          title="Re-check OpenSpec runtime status"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {/* Status badge */}
      <div
        className={`requirement-row ${isReady ? "is-ok" : isError ? "is-warn" : "is-warn"}`}
        title={`OpenSpec runtime: ${state}`}
      >
        <span className={`requirement-badge ${isReady ? "is-ok" : "is-warn"}`}>
          {isReady ? <Check size={14} /> : isError ? <AlertTriangle size={14} /> : <Wrench size={14} />}
        </span>
        <div>
          <div className="requirement-name">
            OpenSpec: {state}
          </div>
          {status?.message ? (
            <div className="requirement-detail text-muted text-sm">{status.message}</div>
          ) : null}
        </div>
      </div>

      {/* Details grid */}
      <div className="update-version-grid">
        <div className="update-version-cell">
          <div className="text-muted text-sm">Version</div>
          <div className="mono">{status?.version ?? "—"}</div>
        </div>
        <div className="update-version-cell">
          <div className="text-muted text-sm">Schema</div>
          <div className="mono">{status?.schema ?? "—"}</div>
        </div>
        <div className="update-version-cell">
          <div className="text-muted text-sm">Executable</div>
          <div className="mono text-sm" title={status?.executablePath ?? undefined}>
            {status?.executablePath ?? "not found"}
          </div>
        </div>
        <div className="update-version-cell">
          <div className="text-muted text-sm">Project Ready</div>
          <div className="mono">{status?.projectReady ? "Yes" : "No"}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="row gap-sm">
        <button
          className="btn btn-sm"
          type="button"
          title="Attempt to install OpenSpec (requires a configured source)"
          onClick={() => void handleInstall()}
          disabled={isInstalling || loading}
        >
          <Wrench size={12} /> Install
        </button>
        <button
          className="btn btn-sm"
          type="button"
          title="Check for OpenSpec updates (requires a configured source)"
          onClick={() => void handleUpdate()}
          disabled={isInstalling || loading || isMissing}
        >
          <RefreshCw size={12} /> Update
        </button>
      </div>

      {/* Manual path guidance */}
      {isMissing ? (
        <div className="requirement-row is-warn" title="Manual setup guidance">
          <span className="requirement-badge is-warn">
            <Terminal size={14} />
          </span>
          <div>
            <div className="requirement-name">Manual setup</div>
            <div className="requirement-detail text-muted text-sm">
              Install OpenSpec on your system and ensure the <code className="mono">openspec</code> command is on your PATH.
              Then click Refresh. Alternatively, set a manual executable path once path configuration is available.
            </div>
          </div>
        </div>
      ) : null}

      {/* Error display */}
      {actionError ? (
        <div className="requirement-row is-warn" title="Action error">
          <span className="requirement-badge is-warn">
            <AlertTriangle size={14} />
          </span>
          <div>
            <div className="requirement-name">Action error</div>
            <div className="requirement-detail text-muted text-sm mono">{actionError}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

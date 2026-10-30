import { AlertTriangle, Check, RefreshCw, Terminal, Wrench } from "lucide-react";
import type { OpenSpecRuntimeAction } from "../../lib/openspecRuntime";
import { useLogs } from "../../state/log";
import { useOpenSpecRuntime } from "../../state/useOpenSpecRuntime";
import { ConfirmDialog } from "./ConfirmDialog";
import { LoadingBlock } from "./Loading";

type OpenSpecSettingsTabProps = {
  projectPath: string | null;
};

const CONFIRM_COPY: Record<OpenSpecRuntimeAction, { title: string; message: string; confirmLabel: string }> = {
  install: {
    title: "Install OpenSpec?",
    message:
      "Basebuild will run `npm install -g @fission-ai/openspec@latest` on this machine. This requires Node.js and npm on your PATH.",
    confirmLabel: "Install",
  },
  update: {
    title: "Update OpenSpec?",
    message:
      "Basebuild will run `npm install -g @fission-ai/openspec@latest`, replacing the globally installed OpenSpec with the latest release.",
    confirmLabel: "Update",
  },
};

const BUSY_LABEL: Record<OpenSpecRuntimeAction, string> = {
  install: "Installing OpenSpec…",
  update: "Updating OpenSpec…",
};

export function OpenSpecSettingsTab({ projectPath }: OpenSpecSettingsTabProps) {
  const { addLog } = useLogs();
  const {
    status,
    loading,
    error,
    refresh,
    pendingAction,
    activeAction,
    progressLines,
    actionError,
    requestAction,
    cancelPendingAction,
    confirmPendingAction,
  } = useOpenSpecRuntime(projectPath);

  const state = status?.state ?? "missing";
  const isReady = state === "ready";
  const isMissing = state === "missing";
  const isError = state === "error";
  const isInstalled = status?.executablePath != null;
  const isBusy = activeAction !== null || state === "installing";
  // `status ?? "missing"` reads as a definitive verdict, so the very first
  // check must not render the badge, the details grid, or the manual-install
  // callout. A re-check keeps the previous status on screen (the Refresh
  // button already spins) instead of blanking the panel.
  const initialLoading = loading && status === null;
  const visibleError = actionError ?? error;
  const confirmCopy = pendingAction ? CONFIRM_COPY[pendingAction] : null;

  function handleRefresh() {
    addLog("debug", "OpenSpec runtime refresh requested", projectPath ?? "no project");
    void refresh();
  }

  function handleRequest(action: OpenSpecRuntimeAction) {
    addLog("debug", `OpenSpec ${action} requested`, projectPath ?? "no project");
    requestAction(action);
  }

  function handleConfirm() {
    addLog("debug", `OpenSpec ${pendingAction ?? "action"} confirmed`, projectPath ?? "no project");
    void confirmPendingAction();
  }

  function handleCancel() {
    addLog("debug", `OpenSpec ${pendingAction ?? "action"} cancelled`, projectPath ?? "no project");
    cancelPendingAction();
  }

  return (
    <div className="stack">
      <div className="settings-section-header">
        <h3>OpenSpec Runtime</h3>
        <button
          className="btn btn-sm"
          type="button"
          title="Re-check OpenSpec runtime status"
          onClick={handleRefresh}
          disabled={loading || isBusy}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {initialLoading ? (
        <LoadingBlock label="Checking OpenSpec runtime…" />
      ) : (
        <>
          {/* Status badge */}
          <div
            className={`requirement-row ${isReady ? "is-ok" : "is-warn"}`}
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
              title={
                isInstalled
                  ? "OpenSpec is already installed. Use Update to get the latest release."
                  : "Install OpenSpec from npm (asks for confirmation first)"
              }
              onClick={() => handleRequest("install")}
              disabled={isBusy || loading || isInstalled}
            >
              <Wrench size={12} /> Install
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={
                isInstalled
                  ? "Update OpenSpec to the latest npm release (asks for confirmation first)"
                  : "Install OpenSpec before updating it"
              }
              onClick={() => handleRequest("update")}
              disabled={isBusy || loading || !isInstalled}
            >
              <RefreshCw size={12} /> Update
            </button>
          </div>

          {/* npm output for the current or most recent run */}
          {activeAction !== null || progressLines.length > 0 ? (
            <div className="stack-sm">
              <div className="text-muted text-sm">
                {activeAction ? BUSY_LABEL[activeAction] : "Last run output"}
              </div>
              <pre
                className="openspec-progress-log"
                title="npm output from the last OpenSpec install or update"
                aria-live="polite"
              >
                {progressLines.join("\n")}
              </pre>
            </div>
          ) : null}

          {/* Manual path guidance */}
          {isMissing ? (
            <div className="requirement-row is-warn" title="Manual setup guidance">
              <span className="requirement-badge is-warn">
                <Terminal size={14} />
              </span>
              <div>
                <div className="requirement-name">Manual setup</div>
                <div className="requirement-detail text-muted text-sm">
                  Install OpenSpec with the button above, or install it yourself so the <code className="mono">openspec</code> command is on your PATH.
                  Then click Refresh.
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Error display */}
      {visibleError ? (
        <div className="requirement-row is-warn" title="Action error">
          <span className="requirement-badge is-warn">
            <AlertTriangle size={14} />
          </span>
          <div>
            <div className="requirement-name">Action error</div>
            <div className="requirement-detail text-muted text-sm mono">{visibleError}</div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmCopy !== null}
        title={confirmCopy?.title ?? ""}
        message={confirmCopy?.message ?? ""}
        confirmLabel={confirmCopy?.confirmLabel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

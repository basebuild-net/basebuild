import { AlertTriangle, Check, RefreshCw, Terminal, Wrench } from "lucide-react";
import { t } from "../../i18n";
import type { OpenSpecRuntimeAction } from "../../lib/openspecRuntime";
import { useLogs } from "../../state/log";
import { useOpenSpecRuntime } from "../../state/useOpenSpecRuntime";
import { ConfirmDialog } from "./ConfirmDialog";
import { LoadingBlock } from "./Loading";

type OpenSpecSettingsTabProps = {
  projectPath: string | null;
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
  const confirmCopy =
    pendingAction === null
      ? null
      : pendingAction === "install"
        ? {
            title: t("openSpecSettingsTab.installConfirmTitle"),
            message: t("openSpecSettingsTab.installConfirmMessage"),
          }
        : {
            title: t("openSpecSettingsTab.updateConfirmTitle"),
            message: t("openSpecSettingsTab.updateConfirmMessage"),
          };

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
        <h3>{t("openSpecSettingsTab.openSpecRuntime")}</h3>
        <button
          className="btn btn-sm"
          type="button"
          title={t("openSpecSettingsTab.reCheckOpenspecRuntimeStatus")}
          onClick={handleRefresh}
          disabled={loading || isBusy}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} /> {t("openSpecSettingsTab.refresh")}
        </button>
      </div>

      {initialLoading ? (
        <LoadingBlock label={t("openSpecSettingsTab.checkingOpenspecRuntime")} />
      ) : (
        <>
          {/* Status badge */}
          <div
            className={`requirement-row ${isReady ? "is-ok" : "is-warn"}`}
            title={t("openSpecSettingsTab.openSpecRuntime2", { state })}
          >
            <span className={`requirement-badge ${isReady ? "is-ok" : "is-warn"}`}>
              {isReady ? <Check size={14} /> : isError ? <AlertTriangle size={14} /> : <Wrench size={14} />}
            </span>
            <div>
              <div className="requirement-name">{t("openSpecSettingsTab.openSpec", { state })}</div>
              {status?.message ? (
                <div className="requirement-detail text-muted text-sm">{status.message}</div>
              ) : null}
            </div>
          </div>

          {/* Details grid */}
          <div className="update-version-grid">
            <div className="update-version-cell">
              <div className="text-muted text-sm">{t("openSpecSettingsTab.version")}</div>
              <div className="mono">{status?.version ?? "—"}</div>
            </div>
            <div className="update-version-cell">
              <div className="text-muted text-sm">{t("openSpecSettingsTab.schema")}</div>
              <div className="mono">{status?.schema ?? "—"}</div>
            </div>
            <div className="update-version-cell">
              <div className="text-muted text-sm">{t("openSpecSettingsTab.executable")}</div>
              <div className="mono text-sm" title={status?.executablePath ?? undefined}>
                {status?.executablePath ?? t("openSpecSettingsTab.notFound")}
              </div>
            </div>
            <div className="update-version-cell">
              <div className="text-muted text-sm">{t("openSpecSettingsTab.projectReady")}</div>
              <div className="mono">
                {status?.projectReady ? t("openSpecSettingsTab.yes") : t("openSpecSettingsTab.no")}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="row gap-sm">
            <button
              className="btn btn-sm"
              type="button"
              title={
                isInstalled
                  ? t("openSpecSettingsTab.installTitleInstalled")
                  : t("openSpecSettingsTab.installTitle")
              }
              onClick={() => handleRequest("install")}
              disabled={isBusy || loading || isInstalled}
            >
              <Wrench size={12} /> {t("openSpecSettingsTab.install")}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={
                isInstalled
                  ? t("openSpecSettingsTab.updateTitleInstalled")
                  : t("openSpecSettingsTab.updateTitleNotInstalled")
              }
              onClick={() => handleRequest("update")}
              disabled={isBusy || loading || !isInstalled}
            >
              <RefreshCw size={12} /> {t("openSpecSettingsTab.update")}
            </button>
          </div>

          {/* npm output for the current or most recent run */}
          {activeAction !== null || progressLines.length > 0 ? (
            <div className="stack-sm">
              <div className="text-muted text-sm">
                {activeAction === null
                  ? t("openSpecSettingsTab.lastRunOutput")
                  : activeAction === "install"
                    ? t("openSpecSettingsTab.installingOpenSpec")
                    : t("openSpecSettingsTab.updatingOpenSpec")}
              </div>
              <pre
                className="openspec-progress-log"
                title={t("openSpecSettingsTab.progressTitle")}
                aria-live="polite"
              >
                {progressLines.join("\n")}
              </pre>
            </div>
          ) : null}

          {/* Manual path guidance */}
          {isMissing ? (
            <div className="requirement-row is-warn" title={t("openSpecSettingsTab.manualSetupGuidance")}>
              <span className="requirement-badge is-warn">
                <Terminal size={14} />
              </span>
              <div>
                <div className="requirement-name">{t("openSpecSettingsTab.manualSetup")}</div>
                <div className="requirement-detail text-muted text-sm">
                  {t("openSpecSettingsTab.manualSetupBodyBefore")}
                  <code className="mono">{t("openSpecSettingsTab.openspec")}</code>{" "}
                  {t("openSpecSettingsTab.manualSetupBodyAfter")}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Error display */}
      {visibleError ? (
        <div className="requirement-row is-warn" title={t("openSpecSettingsTab.actionError")}>
          <span className="requirement-badge is-warn">
            <AlertTriangle size={14} />
          </span>
          <div>
            <div className="requirement-name">{t("openSpecSettingsTab.actionError")}</div>
            <div className="requirement-detail text-muted text-sm mono">{visibleError}</div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmCopy !== null}
        title={confirmCopy?.title ?? ""}
        message={confirmCopy?.message ?? ""}
        confirmLabel={pendingAction === "install" ? t("openSpecSettingsTab.install") : t("openSpecSettingsTab.update")}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

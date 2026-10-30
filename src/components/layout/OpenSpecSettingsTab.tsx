import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, Terminal, Wrench } from "lucide-react";
import {
  openspecRuntimeStatus,
  openspecRuntimeInstall,
  openspecRuntimeUpdate,
  type OpenSpecRuntimeStatus,
} from "../../lib/openspecRuntime";
import { LoadingBlock } from "./Loading";
import { t } from "../../i18n";

type OpenSpecSettingsTabProps = {
  projectPath: string | null;
};

export function OpenSpecSettingsTab({ projectPath }: OpenSpecSettingsTabProps) {
  const [status, setStatus] = useState<OpenSpecRuntimeStatus | null>(null);
  // True until the mount check settles — the effect below fires after the
  // first paint, so `false` here would flash a "missing" verdict.
  const [loading, setLoading] = useState(true);
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
  // `status ?? "missing"` reads as a definitive verdict, so the very first
  // check must not render the badge, the details grid, or the manual-install
  // callout. A re-check keeps the previous status on screen (the Refresh
  // button already spins) instead of blanking the panel.
  const initialLoading = loading && status === null;

  return (
    <div className="stack">
      <div className="settings-section-header">
        <h3>{t("openSpecSettingsTab.openSpecRuntime")}</h3>
        <button
          className="btn btn-sm"
          type="button"
          title={t("openSpecSettingsTab.reCheckOpenspecRuntimeStatus")}
          onClick={() => void refresh()}
          disabled={loading}
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
            className={`requirement-row ${isReady ? "is-ok" : isError ? "is-warn" : "is-warn"}`}
            title={t("openSpecSettingsTab.openSpecRuntime2", { state: state })}
          >
            <span className={`requirement-badge ${isReady ? "is-ok" : "is-warn"}`}>
              {isReady ? <Check size={14} /> : isError ? <AlertTriangle size={14} /> : <Wrench size={14} />}
            </span>
            <div>
              <div className="requirement-name">
                {t("openSpecSettingsTab.openSpec", { state: state })}</div>
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
              <div className="mono">{status?.projectReady ? t("openSpecSettingsTab.yes") : t("openSpecSettingsTab.no")}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="row gap-sm">
            <button
              className="btn btn-sm"
              type="button"
              title={t("openSpecSettingsTab.attemptToInstallOpenspecRequires")}
              onClick={() => void handleInstall()}
              disabled={isInstalling || loading}
            >
              <Wrench size={12} /> {t("openSpecSettingsTab.install")}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={t("openSpecSettingsTab.checkForOpenspecUpdatesRequires")}
              onClick={() => void handleUpdate()}
              disabled={isInstalling || loading || isMissing}
            >
              <RefreshCw size={12} /> {t("openSpecSettingsTab.update")}
            </button>
          </div>

          {/* Manual path guidance */}
          {isMissing ? (
            <div className="requirement-row is-warn" title={t("openSpecSettingsTab.manualSetupGuidance")}>
              <span className="requirement-badge is-warn">
                <Terminal size={14} />
              </span>
              <div>
                <div className="requirement-name">{t("openSpecSettingsTab.manualSetup")}</div>
                <div className="requirement-detail text-muted text-sm">
                  {t("openSpecSettingsTab.installOpenspecOnYourSystem")} <code className="mono">{t("openSpecSettingsTab.openspec")}</code> {t("openSpecSettingsTab.commandIsOnYourPath")}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Error display */}
      {actionError ? (
        <div className="requirement-row is-warn" title={t("openSpecSettingsTab.actionError")}>
          <span className="requirement-badge is-warn">
            <AlertTriangle size={14} />
          </span>
          <div>
            <div className="requirement-name">{t("openSpecSettingsTab.actionError")}</div>
            <div className="requirement-detail text-muted text-sm mono">{actionError}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

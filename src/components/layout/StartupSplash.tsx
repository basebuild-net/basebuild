import { useEffect, useState } from "react";
import { AlertTriangle, Download, RefreshCw, X } from "lucide-react";
import type { UpdaterState } from "../../state/updater";
import { appVersion } from "../../lib/app";
import { CopyButton } from "./CopyButton";
import { t } from "../../i18n";

type StartupSplashProps = {
  updates: UpdaterState;
  onComplete: () => void;
};

/// Splash phase drives the UI state machine.
type SplashPhase =
  | "checking"
  | "mandatory"
  | "progress"
  | "error"
  | "ready";

export function StartupSplash({ updates, onComplete }: StartupSplashProps) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<SplashPhase>("checking");
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    void appVersion().then(setVersion).catch(() => {});
  }, []);

  // React to updater state changes. The splash is the ONLY place an update
  // is applied automatically: at startup nothing is open yet, so a restart
  // is free and a closed/re-opened app comes up already updated. Once the
  // splash is dismissed, updates only download in the background and apply
  // via the explicit "Restart to apply update" button.
  useEffect(() => {
    const { status, info } = updates;

    // Update staged and ready → install and restart into the new version.
    if (status === "downloaded") {
      setPhase("progress");
      if (!autoStarted) {
        setAutoStarted(true);
        void updates.restartToApply();
      }
      return;
    }

    // Download or install in progress → show progress.
    if (status === "downloading" || status === "installing") {
      setPhase("progress");
      return;
    }

    // Error state.
    if (status === "error") {
      setPhase("error");
      return;
    }

    // No update or not yet checked.
    if (status === "idle" || status === "checking") {
      setPhase("checking");
      return;
    }

    // Up to date → proceed to app.
    if (status === "up_to_date" || !info?.available) {
      setPhase("ready");
      onComplete();
      return;
    }

    // Update available — the background download starts automatically.
    if (info.available) {
      // If user already skipped this exact version, proceed.
      if (info.skipped) {
        setPhase("ready");
        onComplete();
        return;
      }
      setPhase(info.policy.mandatory ? "mandatory" : "progress");
    }
  }, [updates, onComplete, autoStarted]);

  // Enter the app while the download continues in the background. The
  // staged update is applied later via the taskbar "Restart to apply
  // update" button (or automatically on the next launch).
  const handleContinueWithoutRestart = () => {
    setPhase("ready");
    onComplete();
  };

  const handleRetry = () => {
    void updates.checkNow();
    setAutoStarted(false);
  };

  // Progress percentage from backend events.
  const progressPct = (() => {
    const p = updates.progress;
    if (!p || !p.total) return null;
    return Math.min(100, Math.round((p.downloaded / p.total) * 100));
  })();

  return (
    <div className="splash-overlay">
      <div className="splash-card">
        <div className="splash-brand">{t("startupSplash.bASEBUILD")}</div>
        <div className="splash-version mono">{t("startupSplash.v", { version: version || "0.0.0" })}</div>

        {phase === "checking" && (
          <div className="splash-status">
            <RefreshCw size={14} className="spin" />
            <span>{t("startupSplash.checkingForUpdates")}</span>
          </div>
        )}

        {phase === "progress" && (
          <div className="splash-progress">
            <div className="splash-status">
              {updates.status === "installing" || updates.status === "downloaded"
                ? t("startupSplash.restartingToApplyUpdate")
                : updates.progress?.step === "installing"
                  ? t("startupSplash.installing")
                  : updates.progress?.step === "restarting"
                    ? t("startupSplash.restarting")
                    : t("startupSplash.downloadingUpdate", { value: updates.info?.version ? ` ${updates.info.version}` : "" })}
            </div>
            {progressPct !== null ? (
              <div className="splash-progress-bar">
                <div className="splash-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            ) : (
              <div className="splash-progress-indeterminate" />
            )}
            {updates.progress?.message ? (
              <p className="splash-progress-message text-muted text-sm">{updates.progress.message}</p>
            ) : null}
            {!updates.info?.policy.mandatory && updates.status === "downloading" ? (
              <div className="splash-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  title={t("startupSplash.useBasebuildNowTheUpdate")}
                  onClick={handleContinueWithoutRestart}
                >
                  {t("startupSplash.continueWithoutRestarting")}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {phase === "mandatory" && updates.info && (
          <div className="splash-update-info">
            <div className="splash-update-title">
              <AlertTriangle size={14} /> {t("startupSplash.mandatoryUpdateRequired")}
            </div>
            <p className="splash-update-summary text-sm">
              {t("startupSplash.thisVersionOfBasebuildIs", {
                minimumSupportedVersionNote: updates.info.policy.minimumSupportedVersion
                  ? t("startupSplash.minimumSupportedVersionNote", { minimumSupportedVersion: updates.info.policy.minimumSupportedVersion })
                  : "",
                version: updates.info.version ?? "",
              })}
            </p>
            <div className="splash-actions">
              <button
                className="btn btn-update btn-sm"
                type="button"
                title={t("startupSplash.updatingToBasebuild", { version: updates.info.version ?? "" })}
                disabled
              >
                <Download size={12} /> {t("startupSplash.updating")}
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="splash-update-info">
            <div className="splash-update-title">
              <AlertTriangle size={14} /> {t("startupSplash.updateCheckFailed")}
            </div>
            <p className="splash-update-summary text-muted text-sm">
              {updates.info?.channelExplanation ?? updates.error ?? t("startupSplash.couldNotCheckForUpdates")}
            </p>
            {updates.info?.rawError ? (
              <details className="update-raw-error">
                <summary className="text-muted text-sm">{t("startupSplash.rawError")}</summary>
                <pre className="text-sm mono">{updates.info.rawError}</pre>
              </details>
            ) : null}
            {updates.info?.rawError ? (
              <div className="splash-error-copy">
                <CopyButton text={updates.info.rawError} label={t("startupSplash.copyError")} />
              </div>
            ) : null}
            <div className="splash-actions">
              <button
                className="btn btn-sm"
                type="button"
                title={t("startupSplash.retryUpdateCheck")}
                onClick={handleRetry}
              >
                <RefreshCw size={12} /> {t("startupSplash.retry")}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                title={t("startupSplash.continueToBasebuildWithoutUpdating")}
                onClick={() => {
                  setPhase("ready");
                  onComplete();
                }}
              >
                {t("startupSplash.continueAnyway")}
              </button>
            </div>
          </div>
        )}

        {phase === "checking" && (
          <button
            className="btn btn-ghost btn-sm splash-skip-check"
            type="button"
            title={t("startupSplash.skipUpdateCheckAndContinue")}
            onClick={() => {
              setPhase("ready");
              onComplete();
            }}
          >
            <X size={12} /> {t("startupSplash.skip")}
          </button>
        )}
      </div>
    </div>
  );
}

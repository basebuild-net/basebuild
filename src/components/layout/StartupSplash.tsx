import { useEffect, useState } from "react";
import { AlertTriangle, Download, RefreshCw, X } from "lucide-react";
import type { UpdaterState } from "../../state/updater";
import { appVersion } from "../../lib/app";
import { CopyButton } from "./CopyButton";

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
        <div className="splash-brand">BASEBUILD</div>
        <div className="splash-version mono">v{version || "0.0.0"}</div>

        {phase === "checking" && (
          <div className="splash-status">
            <RefreshCw size={14} className="spin" />
            <span>Checking for updates…</span>
          </div>
        )}

        {phase === "progress" && (
          <div className="splash-progress">
            <div className="splash-status">
              {updates.status === "installing" || updates.status === "downloaded"
                ? "Restarting to apply update…"
                : updates.progress?.step === "installing"
                  ? "Installing…"
                  : updates.progress?.step === "restarting"
                    ? "Restarting…"
                    : `Downloading update${updates.info?.version ? ` ${updates.info.version}` : ""}…`}
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
                  title="Use Basebuild now — the update keeps downloading and applies when you restart"
                  onClick={handleContinueWithoutRestart}
                >
                  Continue without restarting
                </button>
              </div>
            ) : null}
          </div>
        )}

        {phase === "mandatory" && updates.info && (
          <div className="splash-update-info">
            <div className="splash-update-title">
              <AlertTriangle size={14} /> Mandatory update required
            </div>
            <p className="splash-update-summary text-sm">
              This version of Basebuild is no longer supported.
              {updates.info.policy.minimumSupportedVersion
                ? ` Minimum supported version is ${updates.info.policy.minimumSupportedVersion}.`
                : ""}
              {" "}Updating to {updates.info.version}…
            </p>
            <div className="splash-actions">
              <button
                className="btn btn-update btn-sm"
                type="button"
                title={`Updating to Basebuild ${updates.info.version ?? ""}`}
                disabled
              >
                <Download size={12} /> Updating…
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="splash-update-info">
            <div className="splash-update-title">
              <AlertTriangle size={14} /> Update check failed
            </div>
            <p className="splash-update-summary text-muted text-sm">
              {updates.info?.channelExplanation ?? updates.error ?? "Could not check for updates."}
            </p>
            {updates.info?.rawError ? (
              <details className="update-raw-error">
                <summary className="text-muted text-sm">Raw error</summary>
                <pre className="text-sm mono">{updates.info.rawError}</pre>
              </details>
            ) : null}
            {updates.info?.rawError ? (
              <div className="splash-error-copy">
                <CopyButton text={updates.info.rawError} label="Copy error" />
              </div>
            ) : null}
            <div className="splash-actions">
              <button
                className="btn btn-sm"
                type="button"
                title="Retry update check"
                onClick={handleRetry}
              >
                <RefreshCw size={12} /> Retry
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                title="Continue to Basebuild without updating"
                onClick={() => {
                  setPhase("ready");
                  onComplete();
                }}
              >
                Continue anyway
              </button>
            </div>
          </div>
        )}

        {phase === "checking" && (
          <button
            className="btn btn-ghost btn-sm splash-skip-check"
            type="button"
            title="Skip update check and continue to Basebuild"
            onClick={() => {
              setPhase("ready");
              onComplete();
            }}
          >
            <X size={12} /> Skip
          </button>
        )}
      </div>
    </div>
  );
}

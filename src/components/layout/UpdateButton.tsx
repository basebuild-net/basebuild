import { Download, RefreshCw } from "lucide-react";
import type { UpdaterState } from "../../state/updater";

type UpdateButtonProps = {
  updates: UpdaterState;
  onOpenSettings: () => void;
};

export function UpdateButton({ updates, onOpenSettings }: UpdateButtonProps) {
  const { info, status } = updates;
  const checking = status === "checking";
  const versionLabel = info?.version ? ` ${info.version}` : "";

  if (status === "downloaded" || status === "installing") {
    // The update is staged locally. Never restart on our own — surface an
    // explicit CTA and let the user decide when to apply it.
    const installing = status === "installing";
    return (
      <button
        className="update-taskbar-btn"
        type="button"
        title={`Basebuild${versionLabel} is downloaded — click to restart and apply it`}
        onClick={() => void updates.restartToApply()}
        disabled={installing}
      >
        <RefreshCw size={13} className={installing ? "spin" : ""} />
        <span>{installing ? "Restarting…" : "Restart to apply update"}</span>
      </button>
    );
  }

  if (info?.available || status === "downloading") {
    // Background download in progress: calm, non-interactive status only.
    return (
      <button
        className="update-taskbar-status"
        type="button"
        title={`Downloading Basebuild${versionLabel} in the background — you can keep working; it applies when you restart`}
        onClick={onOpenSettings}
        disabled
      >
        <Download size={13} />
        <span>{`Downloading${versionLabel}…`}</span>
      </button>
    );
  }

  if (checking) {
    return (
      <button
        className="update-taskbar-status"
        type="button"
        title="Checking for Basebuild updates"
        onClick={onOpenSettings}
      >
        <RefreshCw size={12} className="spin" />
        <span>Checking</span>
      </button>
    );
  }

  if (status === "error") {
    const channelStatus = info?.channelStatus ?? "unknown";
    // Network errors are transient and worth a retry; channel errors
    // (endpoint unavailable, malformed manifest, etc.) are release pipeline
    // issues the user cannot fix by retrying. Show a calmer indicator.
    const isChannelBroken =
      channelStatus === "endpointUnavailable" ||
      channelStatus === "malformedManifest" ||
      channelStatus === "platformMissing" ||
      channelStatus === "signatureInvalid";
    const label = isChannelBroken ? "Update unavailable" : "Update error";
    return (
      <button
        className={`update-taskbar-status${isChannelBroken ? " is-warning" : " is-error"}`}
        type="button"
        title={info?.channelExplanation ?? updates.error ?? "Update check failed"}
        onClick={onOpenSettings}
      >
        <RefreshCw size={12} />
        <span>{label}</span>
      </button>
    );
  }

  return null;
}

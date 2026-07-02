import { Download, RefreshCw } from "lucide-react";
import type { UpdaterState } from "../../state/updater";

type UpdateButtonProps = {
  updates: UpdaterState;
  onOpenSettings: () => void;
};

export function UpdateButton({ updates, onOpenSettings }: UpdateButtonProps) {
  const { info, status } = updates;
  const checking = status === "checking";
  const installing = status === "installing";

  if (info?.available) {
    const versionLabel = info.version ? ` ${info.version}` : "";
    return (
      <button
        className="update-taskbar-btn"
        type="button"
        title={`Download and install Basebuild${versionLabel}`}
        onClick={() => void updates.install()}
        disabled={installing}
      >
        <Download size={13} />
        <span>{installing ? "Installing…" : `Update${versionLabel}`}</span>
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

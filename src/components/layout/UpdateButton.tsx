import { Download, RefreshCw } from "lucide-react";
import type { UpdaterState } from "../../state/updater";
import { t } from "../../i18n";

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
        title={t("updateButton.basebuildIsDownloadedClickToRestart", { versionLabel: versionLabel })}
        onClick={() => void updates.restartToApply()}
        disabled={installing}
      >
        <RefreshCw size={13} className={installing ? "spin" : ""} />
        <span>{installing ? t("updateButton.restarting") : t("updateButton.restartToApplyUpdate")}</span>
      </button>
    );
  }

  if (info?.available || status === "downloading") {
    // Background download in progress: calm, non-interactive status only.
    return (
      <button
        className="update-taskbar-status"
        type="button"
        title={t("updateButton.downloadingBasebuildInTheBackgroundYou", { versionLabel: versionLabel })}
        onClick={onOpenSettings}
        disabled
      >
        <Download size={13} />
        <span>{t("updateButton.downloading", { versionLabel: versionLabel })}</span>
      </button>
    );
  }

  if (checking) {
    return (
      <button
        className="update-taskbar-status"
        type="button"
        title={t("updateButton.checkingForBasebuildUpdates")}
        onClick={onOpenSettings}
      >
        <RefreshCw size={12} className="spin" />
        <span>{t("updateButton.checking")}</span>
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
    const label = isChannelBroken ? t("updateButton.updateUnavailable") : t("updateButton.updateError");
    return (
      <button
        className={`update-taskbar-status${isChannelBroken ? " is-warning" : " is-error"}`}
        type="button"
        title={info?.channelExplanation ?? updates.error ?? t("updateButton.updateCheckFailed")}
        onClick={onOpenSettings}
      >
        <RefreshCw size={12} />
        <span>{label}</span>
      </button>
    );
  }

  return null;
}

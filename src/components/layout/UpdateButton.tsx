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
    return (
      <button
        className="update-taskbar-status is-error"
        type="button"
        title={updates.error ?? "Update check failed"}
        onClick={onOpenSettings}
      >
        <RefreshCw size={12} />
        <span>Update error</span>
      </button>
    );
  }

  return null;
}

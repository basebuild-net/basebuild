import type { MessageKey } from "../../i18n";
import { desktopPlatform, type DesktopPlatform } from "../../lib/platform";

/** Message keys for the launch-at-login control, per OS. */
export type StartupCopy = {
  firstRunLabel: MessageKey;
  firstRunHint: MessageKey;
  settingsSection: MessageKey;
  settingsTitle: MessageKey;
  settingsLabel: MessageKey;
};

const STARTUP_COPY: Record<DesktopPlatform, StartupCopy> = {
  macos: {
    firstRunLabel: "startup.firstRunLabel.macos",
    firstRunHint: "startup.firstRunHint.macos",
    settingsSection: "startup.settingsSection.macos",
    settingsTitle: "startup.settingsTitle.macos",
    settingsLabel: "startup.settingsLabel.macos",
  },
  windows: {
    firstRunLabel: "startup.firstRunLabel.windows",
    firstRunHint: "startup.firstRunHint.windows",
    settingsSection: "startup.settingsSection.windows",
    settingsTitle: "startup.settingsTitle.windows",
    settingsLabel: "startup.settingsLabel.windows",
  },
  linux: {
    firstRunLabel: "startup.firstRunLabel.linux",
    firstRunHint: "startup.firstRunHint.linux",
    settingsSection: "startup.settingsSection.linux",
    settingsTitle: "startup.settingsTitle.linux",
    settingsLabel: "startup.settingsLabel.linux",
  },
};

export const startupCopy: StartupCopy = STARTUP_COPY[desktopPlatform];

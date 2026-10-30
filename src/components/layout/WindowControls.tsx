import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { desktopPlatform } from "../../lib/platform";
import { t } from "../../i18n";

/** Custom min/max/close for frameless Windows and Linux windows. macOS keeps
 *  its native traffic lights (overlay title bar), so this renders nothing there. */
export function WindowControls() {
  if (desktopPlatform === "macos") return null;
  return <CustomWindowControls />;
}

function CustomWindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    });
    void win.isMaximized().then(setMaximized);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const minimize = () => void getCurrentWindow().minimize();
  const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
  const close = () => void getCurrentWindow().close();

  return (
    <div className="window-controls">
      <button className="window-control-btn" title={t("windowControls.minimize")} type="button" onClick={minimize}>
        <Minus size={14} />
      </button>
      <button className="window-control-btn" title={maximized ? t("windowControls.restore") : t("windowControls.maximize")} type="button" onClick={toggleMaximize}>
        <Square size={11} />
      </button>
      <button className="window-control-btn window-control-close" title={t("windowControls.close")} type="button" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}

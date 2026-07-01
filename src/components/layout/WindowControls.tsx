import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function WindowControls() {
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
      <button className="window-control-btn" title="Minimize" type="button" onClick={minimize}>
        <Minus size={14} />
      </button>
      <button className="window-control-btn" title={maximized ? "Restore" : "Maximize"} type="button" onClick={toggleMaximize}>
        <Square size={11} />
      </button>
      <button className="window-control-btn window-control-close" title="Close" type="button" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}

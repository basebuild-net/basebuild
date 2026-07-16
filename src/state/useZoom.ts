import { useCallback, useEffect, useState } from "react";
import {
  getUiScale,
  resetUiScale,
  stepUiScale,
  subscribeUiScale,
  type UiScale,
} from "../lib/uiScale";

/** Global UI-scale hook: exposes the live scale plus in/out/reset actions
 *  and registers the CTRL+= / CTRL+- / CTRL+0 keyboard shortcuts. The scale
 *  itself is applied by `lib/uiScale` as a root zoom multiplier (and
 *  pre-paint by the index.html bootstrap), so all sizes stay proportional. */
export function useZoom() {
  const [zoom, setZoom] = useState<UiScale>(() => getUiScale());

  useEffect(() => subscribeUiScale(setZoom), []);

  const zoomIn = useCallback(() => {
    stepUiScale(1);
  }, []);
  const zoomOut = useCallback(() => {
    stepUiScale(-1);
  }, []);
  const zoomReset = useCallback(() => {
    resetUiScale();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (!["+", "=", "-", "_", "0"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "+" || event.key === "=") {
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        zoomOut();
      } else if (event.key === "0") {
        zoomReset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, zoomReset]);

  return { zoom, zoomIn, zoomOut, zoomReset };
}

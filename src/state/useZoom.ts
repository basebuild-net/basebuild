import { useCallback, useEffect, useState } from "react";

export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const;
const STORAGE_KEY = "basebuild.zoom";

function clampZoom(value: number): number {
  const min = ZOOM_STEPS[0];
  const max = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return Math.min(Math.max(value, min), max);
}

function applyZoom(percent: number) {
  document.documentElement.dataset.bbZoom = String(percent);
  localStorage.setItem(STORAGE_KEY, String(percent));
}

function loadZoom(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if (!Number.isNaN(n)) return clampZoom(n);
  }
  return 100;
}

function nextZoomUp(current: number): number {
  const idx = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
  if (idx === -1) return 100;
  return ZOOM_STEPS[Math.min(idx + 1, ZOOM_STEPS.length - 1)];
}

function nextZoomDown(current: number): number {
  const idx = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
  if (idx === -1) return 100;
  return ZOOM_STEPS[Math.max(idx - 1, 0)];
}

export function useZoom() {
  const [zoom, setZoom] = useState<number>(100);

  useEffect(() => {
    const initial = loadZoom();
    setZoom(initial);
    applyZoom(initial);
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((prev) => {
      const next = nextZoomUp(prev);
      applyZoom(next);
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => {
      const next = nextZoomDown(prev);
      applyZoom(next);
      return next;
    });
  }, []);

  const zoomReset = useCallback(() => {
    setZoom(100);
    applyZoom(100);
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

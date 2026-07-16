/** UI scale (zoom) — a bounded root zoom multiplier persisted beside the
 *  theme. Applied via the standard CSS `zoom` property on the root element
 *  (Chromium/WebView2), so every px-derived size, padding, and layout scales
 *  proportionally without a stylesheet rewrite. Persisted values are
 *  untrusted: exact-allowlisted before applying (missing/malformed → 100). */

const STORAGE_KEY = "basebuild.zoom";

export const UI_SCALE_STEPS = [80, 90, 100, 110, 120, 130, 140, 150] as const;
export type UiScale = (typeof UI_SCALE_STEPS)[number];
export const UI_SCALE_DEFAULT: UiScale = 100;

type Listener = (scale: UiScale) => void;
const listeners = new Set<Listener>();

/** Exact-allowlist an untrusted persisted value. */
export function parseUiScale(value: unknown): UiScale {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return (UI_SCALE_STEPS as readonly number[]).includes(numeric) ? (numeric as UiScale) : UI_SCALE_DEFAULT;
}

export function getUiScale(): UiScale {
  try {
    return parseUiScale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

function applyUiScale(scale: UiScale): void {
  // Standard CSS zoom — layout zoom, crisp text, fixed-position aware.
  document.documentElement.style.setProperty("zoom", String(scale / 100));
}

export function setUiScale(scale: UiScale): UiScale {
  const next = parseUiScale(scale);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Storage may be unavailable (private mode); scale still applies live.
  }
  applyUiScale(next);
  for (const listener of listeners) listener(next);
  return next;
}

/** Step the scale up/down one notch, clamped at the bounds. */
export function stepUiScale(direction: 1 | -1): UiScale {
  const current = getUiScale();
  const index = UI_SCALE_STEPS.indexOf(current);
  const next = UI_SCALE_STEPS[Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, index + direction))];
  return setUiScale(next);
}

export function resetUiScale(): UiScale {
  return setUiScale(UI_SCALE_DEFAULT);
}

/** Subscribe to scale changes (settings UI live value). */
export function subscribeUiScale(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

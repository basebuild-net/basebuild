/**
 * Lightweight interaction timing marks for project activation, modal first
 * paint, provider/model restore, and first activity event. Uses
 * `performance.mark` / `performance.measure` so data is visible in DevTools
 * but never transmitted. Marks with the same key are cleared before re-marking
 * so repeated interactions measure only the latest.
 */

const PREFIX = "bb:";

export type TimingKey =
  | "project-activation"
  | "modal-first-paint"
  | "provider-model-restore"
  | "first-activity-event";

/** Record the start of an interaction. Safe to call multiple times — clears any
 *  prior mark with the same key first. */
export function markStart(key: TimingKey): void {
  const name = `${PREFIX}${key}:start`;
  if (performance.getEntriesByName(name).length > 0) {
    performance.clearMarks(name);
  }
  performance.mark(name);
}

/** Record the end of an interaction and return the duration in milliseconds,
 *  or `null` if no start mark exists. */
export function markEnd(key: TimingKey): number | null {
  const startName = `${PREFIX}${key}:start`;
  const endName = `${PREFIX}${key}:end`;
  const measureName = `${PREFIX}${key}:duration`;
  const starts = performance.getEntriesByName(startName);
  if (starts.length === 0) return null;
  if (performance.getEntriesByName(endName).length > 0) {
    performance.clearMarks(endName);
  }
  performance.mark(endName);
  try {
    performance.clearMeasures(measureName);
    performance.measure(measureName, startName, endName);
    const entries = performance.getEntriesByName(measureName);
    const duration = entries.length > 0 ? entries[0].duration : null;
    if (duration !== null && duration > 50) {
      // Surface >50ms violations as a visible console warning.
      // eslint-disable-next-line no-console
      console.warn(`[timing] ${key} took ${duration.toFixed(0)}ms (>50ms threshold)`);
    }
    return duration;
  } catch {
    return null;
  }
}

/** Convenience wrapper that times a promise-returning callback. */
export async function timed<T>(key: TimingKey, fn: () => Promise<T>): Promise<T> {
  markStart(key);
  try {
    return await fn();
  } finally {
    markEnd(key);
  }
}


/** Format an epoch timestamp as a lowercase relative string.
 *  Accepts both seconds (Rust `updated_at`) and milliseconds (JS `Date.now()`)
 *  by treating values below 1 trillion as seconds.
 *  Returns: "just now", "{n}s ago", "{n} min ago", "{n}h ago", "{n}d ago".
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const now = Date.now();
  const tsMs = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const diff = Math.max(0, Math.floor((now - tsMs) / 1000));
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


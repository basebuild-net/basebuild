/**
 * Task-velocity completion estimates for plan runs.
 *
 * Honest, display-only linear projection: once at least two task-completion
 * ticks have been observed, the median inter-tick interval projects the time
 * to finish the remaining tasks. Estimates never gate behavior
 * (`run-mission-control` spec).
 */

export type EtaResult =
  | { kind: "none" }
  | { kind: "estimating" }
  | { kind: "estimate"; remainingMs: number; label: string };

/** Median of consecutive tick intervals; null with fewer than 2 ticks. */
export function medianIntervalMs(tickTimesMs: number[]): number | null {
  if (tickTimesMs.length < 2) return null;
  const sorted = [...tickTimesMs].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i] - sorted[i - 1]);
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 1
    ? intervals[mid]
    : (intervals[mid - 1] + intervals[mid]) / 2;
}

/** Human label for a remaining-time estimate. Always marked as an estimate. */
export function formatEtaMs(ms: number): string {
  if (ms < 60_000) return "~<1m left";
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `~${totalMinutes}m left`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `~${hours}h ${String(minutes).padStart(2, "0")}m left` : `~${hours}h left`;
}

/**
 * Estimate remaining time for a running plan from observed task ticks.
 * - `remainingTasks <= 0` → none (nothing left to project).
 * - fewer than 2 ticks → estimating (no fabricated number).
 * - otherwise → median inter-tick interval × remaining tasks.
 */
export function estimateEta(tickTimesMs: number[], remainingTasks: number): EtaResult {
  if (remainingTasks <= 0) return { kind: "none" };
  const median = medianIntervalMs(tickTimesMs);
  if (median === null) return { kind: "estimating" };
  const remainingMs = median * remainingTasks;
  return { kind: "estimate", remainingMs, label: formatEtaMs(remainingMs) };
}

/** Elapsed-time label for run cards (actual duration, not an estimate). */
export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

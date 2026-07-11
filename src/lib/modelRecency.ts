/**
 * Local-first persistence for recently-used chat models.
 * Mirrors the command-recency pattern in src/lib/chatCommands.ts.
 */

const RECENCY_KEY = "basebuild.modelRecency";
const RECENCY_CAP = 50;

/** Read the model recency map (providerId/modelId → epoch ms of last use). */
export function readModelRecency(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENCY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Record a model use and persist the updated recency map (capped). */
export function recordModelUse(
  providerId: string,
  modelId: string,
  now: number = Date.now(),
): Record<string, number> {
  const current = readModelRecency();
  current[`${providerId}/${modelId}`] = now;
  const entries = Object.entries(current).sort((a, b) => b[1] - a[1]);
  const pruned = entries.slice(0, RECENCY_CAP);
  const result = Object.fromEntries(pruned);
  try {
    localStorage.setItem(RECENCY_KEY, JSON.stringify(result));
  } catch {
    // ignore quota errors
  }
  return result;
}

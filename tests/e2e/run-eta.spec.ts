import { expect, test } from "@playwright/test";
import { estimateEta, formatElapsedMs, formatEtaMs, medianIntervalMs } from "../../src/lib/runEta";

// Pure-function spec (panel-grid-math.spec.ts pattern): the estimator is the
// contract behind mission-control completion estimates — it must never
// fabricate a number from insufficient data.

test.describe("runEta: median interval", () => {
  test("fewer than two ticks yields no interval", () => {
    expect(medianIntervalMs([])).toBeNull();
    expect(medianIntervalMs([1_000])).toBeNull();
  });

  test("odd interval count uses the middle value", () => {
    // Intervals: 60s, 120s, 300s → median 120s.
    expect(medianIntervalMs([0, 60_000, 180_000, 480_000])).toBe(120_000);
  });

  test("even interval count averages the middle pair", () => {
    // Intervals: 60s, 180s → median 120s.
    expect(medianIntervalMs([0, 60_000, 240_000])).toBe(120_000);
  });

  test("unsorted ticks are handled", () => {
    expect(medianIntervalMs([180_000, 0, 60_000, 480_000])).toBe(120_000);
  });

  test("outlier ticks do not dominate the median", () => {
    // Intervals: 60s, 60s, 60s, 3600s → median 60s, not skewed by the stall.
    expect(medianIntervalMs([0, 60_000, 120_000, 180_000, 3_780_000])).toBe(60_000);
  });
});

test.describe("runEta: estimate", () => {
  test("zero remaining tasks yields none, even with ticks", () => {
    expect(estimateEta([0, 60_000], 0)).toEqual({ kind: "none" });
    expect(estimateEta([0, 60_000], -1)).toEqual({ kind: "none" });
  });

  test("no ticks yields estimating, never a number", () => {
    expect(estimateEta([], 5)).toEqual({ kind: "estimating" });
    expect(estimateEta([1_000], 5)).toEqual({ kind: "estimating" });
  });

  test("projects median interval over remaining tasks", () => {
    const result = estimateEta([0, 120_000, 240_000], 3);
    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      expect(result.remainingMs).toBe(360_000);
      expect(result.label).toBe("~6m left");
    }
  });

  test("estimate updates as ticks arrive", () => {
    // Velocity slows: intervals 1m, then 1m+5m — median moves 1m → 3m.
    const fast = estimateEta([0, 60_000], 4);
    const slower = estimateEta([0, 60_000, 360_000], 4);
    expect(fast.kind).toBe("estimate");
    expect(slower.kind).toBe("estimate");
    if (fast.kind === "estimate" && slower.kind === "estimate") {
      expect(fast.remainingMs).toBe(240_000);
      // Intervals 60s and 300s → median 180s × 4 remaining = 720s.
      expect(slower.remainingMs).toBe(720_000);
    }
  });
});

test.describe("runEta: formatting", () => {
  test("sub-minute, minutes, and hours labels", () => {
    expect(formatEtaMs(30_000)).toBe("~<1m left");
    expect(formatEtaMs(12 * 60_000)).toBe("~12m left");
    expect(formatEtaMs(65 * 60_000)).toBe("~1h 05m left");
    expect(formatEtaMs(120 * 60_000)).toBe("~2h left");
  });

  test("elapsed renders mm:ss and h:mm:ss", () => {
    expect(formatElapsedMs(0)).toBe("0:00");
    expect(formatElapsedMs(65_000)).toBe("1:05");
    expect(formatElapsedMs(3_665_000)).toBe("1:01:05");
    expect(formatElapsedMs(-5)).toBe("0:00");
  });
});

import { useEffect, useState, useCallback } from "react";

import {
  stabilityUnseenCount,
  stabilityListReports,
  stabilityMarkSeen,
  stabilityDeleteReport,
  stabilityRecentTelemetry,
  stabilityViolations,
  type StabilityReport,
  type CommandTelemetryEntry,
} from "../lib/stability";

export type StabilityState = {
  unseenCount: number;
  reports: StabilityReport[];
  telemetry: CommandTelemetryEntry[];
  violations: CommandTelemetryEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
  markSeen: (id: string) => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
};

export function useStability(): StabilityState {
  const [unseenCount, setUnseenCount] = useState(0);
  const [reports, setReports] = useState<StabilityReport[]>([]);
  const [telemetry, setTelemetry] = useState<CommandTelemetryEntry[]>([]);
  const [violations, setViolations] = useState<CommandTelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [count, reps, tel, viols] = await Promise.all([
        stabilityUnseenCount(),
        stabilityListReports(),
        stabilityRecentTelemetry(20),
        stabilityViolations(),
      ]);
      setUnseenCount(count);
      setReports(reps);
      setTelemetry(tel);
      setViolations(viols);
    } catch {
      // Silently ignore — stability data is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markSeen = useCallback(async (id: string) => {
    await stabilityMarkSeen(id);
    setUnseenCount((prev) => Math.max(0, prev - 1));
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, seen: true } : r)));
  }, []);

  const deleteReport = useCallback(async (id: string) => {
    await stabilityDeleteReport(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    setUnseenCount((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    unseenCount,
    reports,
    telemetry,
    violations,
    loading,
    refresh,
    markSeen,
    deleteReport,
  };
}

import { useCallback, useEffect, useState } from "react";
import {
  listenOmpTelemetry,
  ompTelemetryRefresh,
  ompTelemetrySnapshot,
  ompTelemetryStart,
  type OmpLiveContext,
} from "../lib/ompTelemetry";

export type OmpTelemetryState = {
  context: OmpLiveContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useOmpTelemetry(): OmpTelemetryState {
  const [context, setContext] = useState<OmpLiveContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ctx = await ompTelemetryRefresh();
      setContext(ctx);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function init() {
      try {
        // Start the backend polling loop (idempotent).
        await ompTelemetryStart();
        // Load the cached snapshot immediately.
        const cached = await ompTelemetrySnapshot().catch(() => null);
        if (cached) setContext(cached);
        // Subscribe to live updates.
        unlisten = await listenOmpTelemetry((event) => {
          setContext(event.payload);
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    void init();
    return () => {
      unlisten?.();
    };
  }, []);

  return { context, loading, error, refresh };
}

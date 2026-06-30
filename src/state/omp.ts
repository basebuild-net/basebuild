import { useEffect, useState } from "react";

import { listenOmpEvents, ompConfigList, ompStatus, startOmpStream, type OmpCommandResult, type OmpStatus, type OmpStreamEvent } from "../lib/omp";

export type OmpState = {
  status: OmpStatus | null;
  config: OmpCommandResult | null;
  busy: boolean;
  error: string | null;
};

export type OmpController = OmpState & {
  runStream: (args: string[], onEvent?: (event: OmpStreamEvent) => void) => Promise<number>;
};

export function useOmpState(): OmpController {
  const [state, setState] = useState<OmpState>({ status: null, config: null, busy: false, error: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [status, config] = await Promise.all([ompStatus(), ompConfigList()]);
        if (!cancelled) {
          setState((current) => ({ ...current, status, config }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({ ...current, error: String(error) }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runStream(args: string[], onEvent?: (event: OmpStreamEvent) => void) {
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const streamId = await startOmpStream(args);
      const unlisten = await listenOmpEvents((event) => {
        if (event.payload.id === streamId) {
          onEvent?.(event.payload);
          if (event.payload.kind === "done" || event.payload.kind === "error") {
            setState((current) => ({ ...current, busy: false }));
            void unlisten();
          }
        }
      });
      return streamId;
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: String(error) }));
      throw error;
    }
  }

  return { ...state, runStream };
}

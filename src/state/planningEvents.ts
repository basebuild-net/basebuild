import { useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Planning event payload emitted from the backend on `planning://event`.
 * Mirrors `PlanningEvent` in `src-tauri/src/models/planning_event.rs`.
 */
export type PlanningEvent = {
  kind: PlanningEventKind;
  entityId: string;
  projectPath: string;
  sessionId?: string;
  title: string;
  detail?: string;
  seq: number;
  ts: number;
};

export type PlanningEventKind =
  | "plan_created"
  | "plan_updated"
  | "plan_status_changed"
  | "idea_captured"
  | "idea_updated"
  | "idea_status_changed"
  | "category_created"
  | "category_updated"
  | "schematic_updated"
  | "stage_started"
  | "stage_succeeded"
  | "stage_failed"
  | "stage_cancelled"
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "integration_action";

/**
 * Subscribe to the planning event bus. One subscription per mount; consumers
 * pass a `refetch` callback that is called on every event and on any detected
 * sequence gap (e.g. after webview reload).
 *
 * Seq-gap detection: the backend emits a monotonic `seq` per app run. If the
 * subscriber observes a gap (event.seq !== lastSeq + 1), it refetches instead
 * of trusting event completeness — this covers the case where the webview
 * missed events during a reload.
 */
export function usePlanningEvents(
  refetch: (() => void) | (() => Promise<void>) | null,
): void {
  const lastSeq = useRef<number>(0);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<PlanningEvent>("planning://event", (event) => {
      const seq = event.payload.seq;
      // Detect a sequence gap. The first event (seq=1, lastSeq=0) is not a
      // gap — it's the first event this subscriber has seen. A gap means we
      // missed events (e.g. webview was reloading) and must refetch the full
      // catalog rather than trust incremental updates.
      const isGap = lastSeq.current > 0 && seq !== lastSeq.current + 1;
      lastSeq.current = seq;

      const cb = refetchRef.current;
      if (cb) {
        // Always refetch on a gap; otherwise refetch on every event so panels
        // reflect the mutation. The refetch is debounced by React's batching
        // when multiple events arrive in the same tick.
        if (isGap) {
          void cb();
        } else {
          void cb();
        }
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Listen failed (e.g. during SSR or early startup). The next mount
        // will retry; panels fall back to their initial fetch.
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}

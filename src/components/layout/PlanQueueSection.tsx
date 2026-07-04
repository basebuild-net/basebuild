import { useEffect, useState } from "react";
import { Loader2, Pause, Play, Square, X } from "lucide-react";
import type { Plan } from "../../lib/plans";
import {
  cancelPlanRun,
  enqueuePlan,
  listPlanQueue,
  listPlanRuns,
  onPlanRunEvent,
  pauseQueue,
  removePlanRun,
  startQueue,
  startOmpPlanRun,
  type ExecutionProfile,
  type PlanQueueEntry,
  type PlanRun,
} from "../../lib/planRuns";
import { nativeChatModelDefault } from "../../lib/native-chat";

type PlanQueueSectionProps = {
  sessionId: string | null;
  plans: Plan[];
  onOpenChatSession: (chatSessionId: string) => void;
};

/// Default execution profile: 1× (concurrency 1, no worktrees yet).
const DEFAULT_PROFILE: ExecutionProfile = {
  concurrency: 1,
  providerId: "",
  modelId: "",
  effortLevel: undefined,
};

export function PlanQueueSection({
  sessionId,
  plans,
  onOpenChatSession,
}: PlanQueueSectionProps) {
  const [queue, setQueue] = useState<PlanQueueEntry[]>([]);
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [profile, setProfile] = useState<ExecutionProfile>(DEFAULT_PROFILE);
  const [defaultModel, setDefaultModel] = useState<{
    providerId: string;
    modelId: string;
    effortLevel: string;
  } | null>(null);

  // Load queue + runs + default model when session changes.
  useEffect(() => {
    if (!sessionId) {
      setQueue([]);
      setRuns([]);
      setDefaultModel(null);
      return;
    }
    void refreshQueue(sessionId);
    void refreshRuns(sessionId);
    void loadDefaultModel(sessionId);
  }, [sessionId]);

  // Listen for plan_run:// events to refresh runs.
  useEffect(() => {
    if (!sessionId) return;
    const unlisten = onPlanRunEvent(() => {
      void refreshRuns(sessionId);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [sessionId]);

  async function refreshQueue(sid: string) {
    try {
      setQueue(await listPlanQueue(sid));
    } catch {
      setQueue([]);
    }
  }

  async function refreshRuns(sid: string) {
    try {
      setRuns(await listPlanRuns(sid));
    } catch {
      setRuns([]);
    }
  }

  async function loadDefaultModel(sid: string) {
    try {
      const dm = await nativeChatModelDefault(sid);
      if (dm) {
        setDefaultModel(dm);
        setProfile((p) => ({
          ...p,
          providerId: dm.providerId,
          modelId: dm.modelId,
          effortLevel: dm.effortLevel,
        }));
      }
    } catch {
      setDefaultModel(null);
    }
  }

  const readyPlans = plans.filter((p) => p.status === "ready");
  const queuedPlanIds = new Set(queue.map((q) => q.planId));
  const unqueuedReady = readyPlans.filter((p) => !queuedPlanIds.has(p.id));

  async function handleEnqueue(planId: string) {
    if (!sessionId) return;
    try {
      await enqueuePlan({ sessionId, planId });
      await refreshQueue(sessionId);
    } catch {
      // Non-blocking; the queue stays as-is.
    }
  }

  async function handleRemoveEntry(entryId: string) {
    try {
      await removePlanRun(entryId);
      if (sessionId) await refreshQueue(sessionId);
    } catch {
      // Non-blocking.
    }
  }

  async function handleStartQueue() {
    if (!sessionId) return;
    try {
      await startQueue({ sessionId, profile });
    } catch {
      // Non-blocking.
    }
  }

  async function handlePauseQueue() {
    if (!sessionId) return;
    try {
      await pauseQueue(sessionId);
    } catch {
      // Non-blocking.
    }
  }

  async function handleCancelRun(runId: string, cancelPlan: boolean) {
    try {
      await cancelPlanRun(runId, cancelPlan);
      if (sessionId) await refreshRuns(sessionId);
    } catch {
      // Non-blocking.
    }
  }

  async function handleStartOmp(planId: string) {
    if (!sessionId) return;
    try {
      await startOmpPlanRun(sessionId, planId);
      await refreshRuns(sessionId);
    } catch {
      // Non-blocking.
    }
  }

  if (!sessionId) return null;

  const hasQueue = queue.length > 0;
  const activeRuns = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  );

  return (
    <div className="plan-queue-section">
      <div className="plan-queue-header">
        <span className="plan-queue-title">Run Queue</span>
        <span className="plan-queue-count" title="Active runs">
          {activeRuns.length}
        </span>
      </div>

      {/* Profile selector */}
      <div className="plan-queue-profile">
        <label className="plan-queue-concurrency" title="Parallel run count (1 without worktrees)">
          <span>×</span>
          <input
            type="number"
            min={1}
            max={4}
            value={profile.concurrency}
            onChange={(e) =>
              setProfile((p) => ({
                ...p,
                concurrency: Math.max(1, Math.min(4, Number(e.target.value) || 1)),
              }))
            }
            title="Parallel run count (capped at 1 without worktrees)"
          />
        </label>
        <button
          className="btn btn-sm btn-primary plan-queue-start"
          type="button"
          onClick={handleStartQueue}
          disabled={!hasQueue || activeRuns.length > 0}
          title="Start the queue with the selected profile"
        >
          <Play size={12} /> Start
        </button>
        <button
          className="btn btn-sm plan-queue-pause"
          type="button"
          onClick={handlePauseQueue}
          disabled={activeRuns.length === 0}
          title="Pause the queue (in-flight runs continue)"
        >
          <Pause size={12} /> Pause
        </button>
      </div>

      {/* Unqueued ready plans */}
      {unqueuedReady.length > 0 ? (
        <div className="plan-queue-enqueue">
          <span className="plan-queue-enqueue-label text-muted text-xs">
            Ready to queue:
          </span>
          {unqueuedReady.map((plan) => (
            <button
              key={plan.id}
              className="btn btn-sm plan-queue-enqueue-btn"
              type="button"
              onClick={() => handleEnqueue(plan.id)}
              title={`Enqueue "${plan.title}" into the run queue`}
            >
              + {plan.title}
            </button>
          ))}
        </div>
      ) : null}

      {/* Queue entries */}
      {hasQueue ? (
        <div className="plan-queue-list">
          {queue.map((entry) => {
            const plan = plans.find((p) => p.id === entry.planId);
            const run = runs.find((r) => r.planId === entry.planId);
            return (
              <div key={entry.id} className="plan-queue-entry">
                <div className="plan-queue-entry-info">
                  <span className="plan-queue-entry-title" title={plan?.title ?? entry.planId}>
                    {plan?.title ?? entry.planId}
                  </span>
                  {run ? (
                    <span
                      className={`plan-queue-run-status plan-queue-run-status-${run.status}`}
                      title={`Run status: ${run.status}`}
                    >
                      {run.status === "running" ? (
                        <Loader2 size={11} className="spin" />
                      ) : null}
                      {run.status}
                    </span>
                  ) : (
                    <span className="plan-queue-run-status plan-queue-run-status-queued">
                      queued
                    </span>
                  )}
                </div>
                <div className="plan-queue-entry-actions">
                  {run?.chatSessionId ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => onOpenChatSession(run.chatSessionId!)}
                      title="Open the run's chat session"
                    >
                      <Play size={12} />
                    </button>
                  ) : null}
                  {plan && !run ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleStartOmp(plan.id)}
                      title="Run with OMP (opens a terminal tab seeded with plan context)"
                    >
                      <Play size={12} />
                    </button>
                  ) : null}
                  {run && (run.status === "running" || run.status === "pending") ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleCancelRun(run.id, false)}
                      title="Cancel this run (returns plan to ready)"
                    >
                      <Square size={12} />
                    </button>
                  ) : null}
                  {!run ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleRemoveEntry(entry.id)}
                      title="Remove from queue"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted text-xs pad">
          No queued plans. Enqueue a ready plan above.
        </p>
      )}
    </div>
  );
}

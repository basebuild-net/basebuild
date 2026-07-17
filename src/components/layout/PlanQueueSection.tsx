import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import type { Plan } from "../../lib/plans";
import {
  assignPlanToChat,
  cancelPlanRun,
  enqueuePlan,
  listPlanQueue,
  listPlanRuns,
  markPlanRunComplete,
  onPlanRunEvent,
  pauseQueue,
  removePlanRun,
  startQueue,
  startOmpPlanRun,
  type ExecutionProfile,
  type PlanQueueEntry,
  type PlanRun,
} from "../../lib/planRuns";
import { getLaunchProfile, type WorkspacePolicy } from "../../lib/planDependencies";

type PlanQueueSectionProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  onOpenChatSession: (chatSessionId: string) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "error") => void;
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
  projectPath,
  plans,
  onOpenChatSession,
  onShowToast,
}: PlanQueueSectionProps) {
  const [queue, setQueue] = useState<PlanQueueEntry[]>([]);
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [profile, setProfile] = useState<ExecutionProfile>(DEFAULT_PROFILE);
  const [workspacePolicy, setWorkspacePolicy] = useState<WorkspacePolicy>("isolated_worktrees");

  // Queue entries belong to the session; the coding profile belongs to the project.
  useEffect(() => {
    if (!sessionId) {
      setQueue([]);
      setRuns([]);
      return;
    }
    void refreshQueue(sessionId);
    void refreshRuns(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!projectPath) {
      setProfile(DEFAULT_PROFILE);
      return;
    }
    void getLaunchProfile(projectPath)
      .then((saved) => {
        if (!saved) return;
        setProfile({
          concurrency: Math.max(1, saved.workerCount),
          providerId: saved.providerId,
          modelId: saved.modelId,
          effortLevel: saved.effortLevel,
        });
        setWorkspacePolicy(saved.workspacePolicy === "sequential_primary" ? "sequential_primary" : "isolated_worktrees");
      })
      .catch((error) => {
        onShowToast?.("Could not load queue profile", error instanceof Error ? error.message : String(error), "error");
      });
  }, [projectPath, onShowToast]);

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


  const readyPlans = plans.filter((p) => p.status === "ready");
  const queuedPlanIds = new Set(queue.map((q) => q.planId));
  const unqueuedReady = readyPlans.filter((p) => !queuedPlanIds.has(p.id));

  async function handleEnqueue(planId: string) {
    if (!sessionId) return;
    try {
      await enqueuePlan({ sessionId, planId });
      await refreshQueue(sessionId);
    } catch (error) {
      onShowToast?.("Could not enqueue plan", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleRemoveEntry(entryId: string) {
    try {
      await removePlanRun(entryId);
      if (sessionId) await refreshQueue(sessionId);
    } catch (error) {
      onShowToast?.("Could not remove queue entry", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleStartQueue() {
    if (!sessionId) return;
    try {
      await startQueue({ sessionId, profile });
      onShowToast?.("Queue started", `${profile.concurrency} concurrent worker${profile.concurrency === 1 ? "" : "s"}`, "success");
    } catch (error) {
      onShowToast?.("Could not start queue", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handlePauseQueue() {
    if (!sessionId) return;
    try {
      await pauseQueue(sessionId);
      onShowToast?.("Queue paused", "In-flight runs will finish; no new plans will start.", "success");
    } catch (error) {
      onShowToast?.("Could not pause queue", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleCancelRun(runId: string, cancelPlan: boolean) {
    try {
      await cancelPlanRun(runId, cancelPlan);
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.("Could not cancel run", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleStartOmp(planId: string) {
    if (!sessionId) return;
    try {
      await startOmpPlanRun(sessionId, planId);
      await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.("Could not start OMP run", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleResumeRun(run: PlanRun) {
    try {
      if (run.chatSessionId) {
        await assignPlanToChat(run.planId, run.chatSessionId);
      } else if (run.runnerKind === "omp") {
        await startOmpPlanRun(run.sessionId, run.planId);
      } else {
        throw new Error("The retained execution chat is unavailable. Assign the ready plan to a new chat.");
      }
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.("Could not resume plan", error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleReviewRun(run: PlanRun) {
    try {
      await markPlanRunComplete(run.id);
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.("Could not complete review", error instanceof Error ? error.message : String(error), "error");
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
        <label className="plan-queue-concurrency" title="Requested parallel run count; capped at one when isolated worktrees are unavailable">
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
            title="Requested parallel run count"
          />
        </label>
        <div
          className="plan-queue-routing"
          title={`Coding route: ${profile.providerId || "project default"} / ${profile.modelId || "project default"} · ${workspacePolicy === "isolated_worktrees" ? "isolated worktrees" : "primary worktree"}`}
        >
          <span>{profile.providerId || "project default"} / {profile.modelId || "model default"}</span>
          <span>{workspacePolicy === "isolated_worktrees" ? "worktrees" : "primary"}</span>
        </div>
        <button
          className="btn btn-sm btn-primary plan-queue-start"
          type="button"
          onClick={handleStartQueue}
          disabled={!hasQueue || activeRuns.length > 0}
          title={`Start queued plans with ${profile.providerId || "the project provider"} / ${profile.modelId || "the project model"}`}
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
                  {run?.status === "awaiting_review" ? (
                    <>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={!run.chatSessionId && run.runnerKind === "native"}
                        onClick={() => void handleResumeRun(run)}
                        title={run.chatSessionId || run.runnerKind === "omp" ? "Resume the incomplete plan run" : "Cannot resume: the retained execution chat is unavailable; assign the ready plan to a new chat."}
                      >
                        <Play size={10} /> Resume
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => void handleReviewRun(run)}
                        title="Review retained artifacts and mark the run complete"
                      >
                        <ClipboardCheck size={10} /> Review
                      </button>
                    </>
                  ) : null}
                  {run?.status === "failed" ? (
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={!run.chatSessionId && run.runnerKind === "native"}
                      onClick={() => void handleResumeRun(run)}
                      title={run.chatSessionId || run.runnerKind === "omp" ? "Retry this failed plan run" : "Cannot retry: the retained execution chat is unavailable; assign the ready plan to a new chat."}
                    >
                      <RotateCcw size={10} /> Retry
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

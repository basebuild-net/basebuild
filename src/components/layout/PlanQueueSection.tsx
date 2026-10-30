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
import { SkeletonText } from "./Loading";
import { t } from "../../i18n";

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
  // DEFAULT_PROFILE reads as "project default / model default", which is a
  // real routing answer — don't show it before the saved profile arrives.
  const [profileLoading, setProfileLoading] = useState(true);

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
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
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
        onShowToast?.(t("planQueueSection.couldNotLoadQueueProfile"), error instanceof Error ? error.message : String(error), "error");
      })
      .finally(() => setProfileLoading(false));
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
      onShowToast?.(t("planQueueSection.couldNotEnqueuePlan"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleRemoveEntry(entryId: string) {
    try {
      await removePlanRun(entryId);
      if (sessionId) await refreshQueue(sessionId);
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotRemoveQueueEntry"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleStartQueue() {
    if (!sessionId) return;
    try {
      await startQueue({ sessionId, profile });
      onShowToast?.(t("planQueueSection.queueStarted"), profile.concurrency === 1 ? t("planQueueSection.concurrentWorkersOne", { count: profile.concurrency }) : t("planQueueSection.concurrentWorkersOther", { count: profile.concurrency }), "success");
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotStartQueue"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handlePauseQueue() {
    if (!sessionId) return;
    try {
      await pauseQueue(sessionId);
      onShowToast?.(t("planQueueSection.queuePaused"), t("planQueueSection.inFlightRunsWillFinishNo"), "success");
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotPauseQueue"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleCancelRun(runId: string, cancelPlan: boolean) {
    try {
      await cancelPlanRun(runId, cancelPlan);
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotCancelRun"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleStartOmp(planId: string) {
    if (!sessionId) return;
    try {
      await startOmpPlanRun(sessionId, planId);
      await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotStartOmpRun"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleResumeRun(run: PlanRun) {
    try {
      if (run.chatSessionId) {
        await assignPlanToChat(run.planId, run.chatSessionId);
      } else if (run.runnerKind === "omp") {
        await startOmpPlanRun(run.sessionId, run.planId);
      } else {
        throw new Error(t("planQueueSection.theRetainedExecutionChatIsUnavailable"));
      }
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotResumePlan"), error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function handleReviewRun(run: PlanRun) {
    try {
      await markPlanRunComplete(run.id);
      if (sessionId) await refreshRuns(sessionId);
    } catch (error) {
      onShowToast?.(t("planQueueSection.couldNotCompleteReview"), error instanceof Error ? error.message : String(error), "error");
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
        <span className="plan-queue-title">{t("planQueueSection.runQueue")}</span>
        <span className="plan-queue-count" title={t("planQueueSection.activeRuns")}>
          {activeRuns.length}
        </span>
      </div>

      {/* Profile selector */}
      <div className="plan-queue-profile">
        <label className="plan-queue-concurrency" title={t("planQueueSection.requestedParallelRunCountCapped")}>
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
            title={t("planQueueSection.requestedParallelRunCount")}
          />
        </label>
        <div
          className="plan-queue-routing"
          title={
            profileLoading
              ? t("planQueueSection.loadingTheCodingRouteFor")
              : t((workspacePolicy === "isolated_worktrees" ? "planQueueSection.codingRoute.isolatedWorktrees" : "planQueueSection.codingRoute.primaryWorktree"), { providerId: profile.providerId || t("planQueueSection.projectDefault"), modelId: profile.modelId || t("planQueueSection.projectDefault2") })
          }
        >
          <span>
            {profileLoading ? (
              <SkeletonText width={22} />
            ) : (
              t("planQueueSection.text", { providerId: profile.providerId || t("planQueueSection.projectDefault3"), modelId: profile.modelId || t("planQueueSection.modelDefault") })
            )}
          </span>
          <span>
            {profileLoading ? (
              <SkeletonText width={9} />
            ) : workspacePolicy === "isolated_worktrees" ? (
              t("planQueueSection.worktrees")
            ) : (
              t("planQueueSection.primary")
            )}
          </span>
        </div>
        <button
          className="btn btn-sm btn-primary plan-queue-start"
          type="button"
          onClick={handleStartQueue}
          disabled={!hasQueue || activeRuns.length > 0}
          title={t("planQueueSection.startQueuedPlansWith", { providerId: profile.providerId || t("planQueueSection.theProjectProvider"), modelId: profile.modelId || t("planQueueSection.theProjectModel") })}
        >
          <Play size={12} /> {t("planQueueSection.start")}
        </button>
        <button
          className="btn btn-sm plan-queue-pause"
          type="button"
          onClick={handlePauseQueue}
          disabled={activeRuns.length === 0}
          title={t("planQueueSection.pauseTheQueueInFlight")}
        >
          <Pause size={12} /> {t("planQueueSection.pause")}
        </button>
      </div>

      {/* Unqueued ready plans */}
      {unqueuedReady.length > 0 ? (
        <div className="plan-queue-enqueue">
          <span className="plan-queue-enqueue-label text-muted text-xs">
            {t("planQueueSection.readyToQueue")}
          </span>
          {unqueuedReady.map((plan) => (
            <button
              key={plan.id}
              className="btn btn-sm plan-queue-enqueue-btn"
              type="button"
              onClick={() => handleEnqueue(plan.id)}
              title={t("planQueueSection.enqueueIntoTheRunQueue", { title: plan.title })}
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
                      title={t("planQueueSection.runStatus", { status: run.status })}
                    >
                      {run.status === "running" ? (
                        <Loader2 size={11} className="spin" />
                      ) : null}
                      {run.status}
                    </span>
                  ) : (
                    <span className="plan-queue-run-status plan-queue-run-status-queued">
                      {t("planQueueSection.queued")}
                    </span>
                  )}
                </div>
                <div className="plan-queue-entry-actions">
                  {run?.chatSessionId ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => onOpenChatSession(run.chatSessionId!)}
                      title={t("planQueueSection.openTheRunSChat")}
                    >
                      <Play size={12} />
                    </button>
                  ) : null}
                  {plan && !run ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleStartOmp(plan.id)}
                      title={t("planQueueSection.runWithOmpOpensA")}
                    >
                      <Play size={12} />
                    </button>
                  ) : null}
                  {run && (run.status === "running" || run.status === "pending") ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleCancelRun(run.id, false)}
                      title={t("planQueueSection.cancelThisRunReturnsPlan")}
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
                        title={run.chatSessionId || run.runnerKind === "omp" ? t("planQueueSection.resumeTheIncompletePlanRun") : t("planQueueSection.cannotResumeTheRetainedExecution")}
                      >
                        <Play size={10} /> {t("planQueueSection.resume")}
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => void handleReviewRun(run)}
                        title={t("planQueueSection.reviewRetainedArtifactsAndMark")}
                      >
                        <ClipboardCheck size={10} /> {t("planQueueSection.review")}
                      </button>
                    </>
                  ) : null}
                  {run?.status === "failed" ? (
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={!run.chatSessionId && run.runnerKind === "native"}
                      onClick={() => void handleResumeRun(run)}
                      title={run.chatSessionId || run.runnerKind === "omp" ? t("planQueueSection.retryThisFailedPlanRun") : t("planQueueSection.cannotRetryTheRetainedExecution")}
                    >
                      <RotateCcw size={10} /> {t("planQueueSection.retry")}
                    </button>
                  ) : null}
                  {!run ? (
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={() => handleRemoveEntry(entry.id)}
                      title={t("planQueueSection.removeFromQueue")}
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
          {t("planQueueSection.noQueuedPlansEnqueueA")}
        </p>
      )}
    </div>
  );
}

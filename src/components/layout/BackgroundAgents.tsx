import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bot, Check, CircleHelp, ClipboardCheck, ExternalLink, Loader2, Play, RotateCcw, X, XCircle } from "lucide-react";
import {
  isTerminalRunStatus,
  pipelineCancel,
  pipelineListRuns,
  pipelineListRunsByProject,
  type PipelineRun,
} from "../../lib/pipeline";
import {
  assignPlanToChat,
  cancelPlanRun,
  derivePlanRunViewState,
  listPlanRuns,
  listPlanRunsByProject,
  markPlanRunComplete,
  type PlanRun,
} from "../../lib/planRuns";
import { usePlanningEvents } from "../../state/planningEvents";
import { getConcurrencyLimits } from "../../lib/runConcurrency";
import type { Plan } from "../../lib/plans";
import { useLogs } from "../../state/log";
import { nativeChatList, type NativeChatSession } from "../../lib/native-chat";
import { SkeletonRows, SkeletonText } from "./Loading";

const KIND_LABELS: Record<string, string> = {
  generate_categories: "Generating categories",
  generate_ideas: "Generating ideas",
  enhance_idea: "Enhancing idea",
  generate_openspec: "Turning plan into OpenSpec",
};

/** How many finished runs to keep visible under the active list. */
const RECENT_LIMIT = 6;

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** Format a duration between two unix-second timestamps as "3s" / "1m 12s". */
function formatDuration(fromSecs: number, toSecs: number): string {
  const total = Math.max(0, toSecs - fromSecs);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}


export type BackgroundAgentsProps = {
  sessionId: string | null;
  /** Project path for project-scoped pipeline run queries. */
  projectPath: string | null;
  /** Plans for resolving a run's target title from its planId. */
  plans: Plan[];
  /** Focus the chat session a run streams into (preview the chat). */
  onOpenChatSession?: (chatSessionId: string) => void;
  /** Open the planning surface for review or archive actions. */
  onOpenPlanning?: (tab: "runs" | "changes") => void;
};

export function BackgroundAgents({
  sessionId,
  projectPath,
  plans,
  onOpenChatSession,
  onOpenPlanning,
}: BackgroundAgentsProps) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [planRuns, setPlanRuns] = useState<PlanRun[]>([]);
  const [chatSessions, setChatSessions] = useState<NativeChatSession[]>([]);
  const [open, setOpen] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  // Set once the first fetch for the current session/project settles. The
  // 5s/10s polls below reuse `refresh`, and they must never flash a skeleton
  // over rows that are already on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  const { addLog } = useLogs();

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setRuns([]);
      setPlanRuns([]);
      setChatSessions([]);
      setHasLoaded(true);
      return;
    }
    // Query pipeline runs by project path (not session ID) so runs from
    // any workspace session in this project are visible. Fall back to
    // session-scoped query if projectPath is unavailable.
    const pipelineQuery = projectPath
      ? pipelineListRunsByProject(projectPath).catch(() => [] as PipelineRun[])
      : pipelineListRuns(sessionId).catch(() => [] as PipelineRun[]);
    const [pipeline, plan, limits, chats] = await Promise.all([
      pipelineQuery,
      projectPath
        ? listPlanRunsByProject(projectPath).catch(() => [] as PlanRun[])
        : listPlanRuns(sessionId).catch(() => [] as PlanRun[]),
      getConcurrencyLimits().catch(() => null),
      projectPath
        ? nativeChatList(projectPath).catch(() => [] as NativeChatSession[])
        : Promise.resolve([] as NativeChatSession[]),
    ]);
    setRuns(pipeline);
    setPlanRuns(plan);
    setChatSessions(chats);
    if (limits) setMaxConcurrent(limits.globalMax);
    setHasLoaded(true);
  }, [sessionId, projectPath]);

  useEffect(() => {
    setHasLoaded(false);
    void refresh();
  }, [refresh]);
  usePlanningEvents(refresh);

  const active = useMemo(
    () => runs.filter((r) => !isTerminalRunStatus(r.status)),
    [runs],
  );
  const activePlanRuns = useMemo(
    () => planRuns.filter((run) => {
      const chat = chatSessions.find((candidate) => candidate.id === run.chatSessionId);
      const state = derivePlanRunViewState(run, chat?.runState).state;
      return state === "queued" || state === "running" || state === "needs-input";
    }),
    [planRuns, chatSessions],
  );
  const activeCount = active.length + activePlanRuns.length;
  const recentPlanRuns = useMemo(
    () => planRuns.filter((run) => !activePlanRuns.some((activeRun) => activeRun.id === run.id)).slice(0, RECENT_LIMIT),
    [planRuns, activePlanRuns],
  );
  const recent = useMemo(
    () => runs.filter((r) => isTerminalRunStatus(r.status)).slice(0, RECENT_LIMIT),
    [runs],
  );

  // Elapsed ticker + poll while agents are active (planning events only fire
  // on stage transitions, not during a long model call). A baseline poll
  // always runs so we catch runs that started before mount or whose events
  // arrived during a webview reload.
  useEffect(() => {
    const baseline = setInterval(() => void refresh(), 10000);
    return () => clearInterval(baseline);
  }, [refresh]);
  useEffect(() => {
    if (activeCount === 0) return;
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [activeCount, refresh]);

  const planTitle = useCallback(
    (planId: string): string => {
      const plan = plans.find((p) => p.id === planId);
      return plan ? `#${plan.referenceId} ${plan.title}` : "";
    },
    [plans],
  );

  const handleCancelPlanRun = useCallback(async (runId: string) => {
    addLog("debug", "Background plan run cancellation requested", `run=${runId}`);
    try {
      await cancelPlanRun(runId, false);
    } catch {
      // Run already finished — refresh reflects the final state.
    }
    void refresh();
  }, [refresh, addLog]);
  const handleOpenChat = useCallback((chatSessionId: string, runId: string) => {
    addLog("debug", "Background agent chat opened", `run=${runId} chat=${chatSessionId}`);
    setOpen(false);
    onOpenChatSession?.(chatSessionId);
  }, [addLog, onOpenChatSession]);


  const handleResumePlanRun = useCallback(async (run: PlanRun) => {
    setActionError(null);
    if (!run.chatSessionId) {
      setOpen(false);
      onOpenPlanning?.("runs");
      return;
    }
    try {
      await assignPlanToChat(run.planId, run.chatSessionId);
      await refresh();
      handleOpenChat(run.chatSessionId, run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(`Could not resume: ${message}`);
      addLog("error", "Background plan resume failed", message);
    }
  }, [addLog, handleOpenChat, onOpenPlanning, refresh]);

  const handleReviewPlanRun = useCallback(async (run: PlanRun) => {
    setActionError(null);
    try {
      await markPlanRunComplete(run.id);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(`Could not complete review: ${message}`);
      addLog("error", "Background plan review failed", message);
    }
  }, [addLog, refresh]);

  const handleArchivePlan = useCallback(() => {
    setOpen(false);
    onOpenPlanning?.("changes");
  }, [onOpenPlanning]);

  const targetTitle = useCallback(
    (run: PipelineRun): string => {
      if (run.planId) {
        const title = planTitle(run.planId);
        if (title) return title;
      }
      return run.inputSummary || "";
    },
    [planTitle],
  );

  const handleCancel = useCallback(async (runId: string) => {
    addLog("debug", "Background pipeline cancellation requested", `run=${runId}`);
    try {
      await pipelineCancel(runId);
    } catch {
      // Run already finished — the refresh below reflects the final state.
    }
    void refresh();
  }, [refresh, addLog]);

  if (!sessionId) return null;

  return (
    <div className="bg-agents-wrap">
      <button
        className={`btn-icon bg-agents-btn${activeCount > 0 ? " is-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          activeCount > 0
            ? `${activeCount} background agent${activeCount === 1 ? "" : "s"} active`
            : "Background agents"
        }
        onClick={() => {
          addLog("debug", open ? "Background agents closed" : "Background agents opened", `active=${activeCount}`);
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
      >
        <Bot size={14} className={activeCount > 0 ? "bg-agents-icon-pulse" : undefined} />
        {activeCount > 0 ? (
          <>
            <span className="bg-agents-badge">{activeCount}</span>
            {maxConcurrent > 0 ? <span className="bg-agents-counter" title={`${activeCount} of ${maxConcurrent} concurrent slots in use`}>{activeCount}/{maxConcurrent}</span> : null}
          </>
        ) : null}
      </button>
      {open ? (
        <>
          <div className="bg-agents-overlay" onClick={() => setOpen(false)} />
          <section className="bg-agents-panel" aria-label="Background agents">
            <div className="bg-agents-header">
              <Bot size={13} className="bg-agents-header-icon" />
              <div className="bg-agents-heading">
                <span className="bg-agents-title">Background agents</span>
                <span className="bg-agents-summary">
                  {!hasLoaded ? (
                    <SkeletonText width={12} />
                  ) : activeCount > 0 ? (
                    `${activeCount} active`
                  ) : (
                    "Nothing running"
                  )}
                </span>
              </div>
              <button className="btn-icon" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="bg-agents-list">
              {actionError ? <div className="bg-agents-action-error" role="alert">{actionError}</div> : null}
              {!hasLoaded ? (
                <SkeletonRows rows={3} label="Loading background agents…" />
              ) : activeCount === 0 && recent.length === 0 && recentPlanRuns.length === 0 ? (
                <div className="bg-agents-empty">
                  No background agents yet. Generating ideas, preparing an
                  OpenSpec plan, or running an assigned plan shows up here.
                </div>
              ) : null}
              {activePlanRuns.map((run) => {
                const chat = chatSessions.find((candidate) => candidate.id === run.chatSessionId);
                const view = derivePlanRunViewState(run, chat?.runState);
                const needsInput = view.state === "needs-input";
                const queued = view.state === "queued";
                const ActivityIcon = needsInput ? CircleHelp : queued ? Play : Loader2;
                return (
                  <div
                    key={run.id}
                    className={`bg-agents-item is-${view.state}`}
                    draggable={!!run.chatSessionId}
                    onDragStart={(e) => {
                      if (!run.chatSessionId) return;
                      e.dataTransfer.setData("text/plain", run.chatSessionId);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {run.chatSessionId && onOpenChatSession ? (
                      <button
                        className="bg-agents-item-open"
                        type="button"
                        title={needsInput
                          ? "Open the pending question or approval"
                          : queued
                            ? "Open the chat reserved for this queued plan"
                            : "Open the chat where this agent is working"}
                        onClick={() => handleOpenChat(run.chatSessionId!, run.id)}
                      >
                        <ActivityIcon
                          size={12}
                          className={`bg-agents-item-icon${needsInput || queued ? "" : " is-spinning"}`}
                        />
                        <span className="bg-agents-item-body">
                          <span className="bg-agents-item-kind">{view.label}</span>
                          {planTitle(run.planId) ? (
                            <span className="bg-agents-item-target" title={planTitle(run.planId)}>
                              {planTitle(run.planId)}
                            </span>
                          ) : null}
                          <span className="bg-agents-item-meta">
                            <span className="bg-agents-model" title={`Runner: ${run.runnerKind}`}>{run.runnerKind}</span>
                            <span className="bg-agents-elapsed">
                              {formatDuration(run.startedAt ?? Math.floor(run.createdAt), now)}
                            </span>
                          </span>
                        </span>
                        <ExternalLink size={11} className="bg-agents-open-icon" />
                      </button>
                    ) : (
                      <>
                        <ActivityIcon
                          size={12}
                          className={`bg-agents-item-icon${needsInput || queued ? "" : " is-spinning"}`}
                        />
                        <div className="bg-agents-item-body">
                          <span className="bg-agents-item-kind">{view.label}</span>
                          {planTitle(run.planId) ? (
                            <span className="bg-agents-item-target" title={planTitle(run.planId)}>
                              {planTitle(run.planId)}
                            </span>
                          ) : null}
                        </div>
                      </>
                    )}
                    <button
                      className="btn-icon btn-icon-sm bg-agents-cancel"
                      type="button"
                      title="Cancel this plan run"
                      onClick={() => void handleCancelPlanRun(run.id)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
              {active.map((run) => (
                <div
                  key={run.id}
                  className={`bg-agents-item is-${run.status === "pending" ? "queued" : "running"}`}
                  draggable={!!run.sessionChatId}
                  onDragStart={(e) => {
                    if (!run.sessionChatId) return;
                    e.dataTransfer.setData("text/plain", run.sessionChatId);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  {run.sessionChatId && onOpenChatSession ? (
                    <button
                      className="bg-agents-item-open"
                      type="button"
                      title={run.status === "pending" ? "Open the chat reserved for this queued agent" : "Open the chat where this agent is working"}
                      onClick={() => handleOpenChat(run.sessionChatId!, run.id)}
                    >
                      {run.status === "pending"
                        ? <Play size={12} className="bg-agents-item-icon" />
                        : <Loader2 size={12} className="bg-agents-item-icon is-spinning" />}
                      <span className="bg-agents-item-body">
                        <span className="bg-agents-item-kind">{run.status === "pending" ? `${kindLabel(run.kind)} queued` : kindLabel(run.kind)}</span>
                        {targetTitle(run) ? (
                          <span className="bg-agents-item-target" title={targetTitle(run)}>
                            {targetTitle(run)}
                          </span>
                        ) : null}
                        <span className="bg-agents-item-meta">
                          {run.modelId ? (
                            <span className="bg-agents-model" title={`Provider: ${run.providerId ?? "unknown"}`}>
                              {run.modelId}
                            </span>
                          ) : null}
                          <span className="bg-agents-elapsed">
                            {formatDuration(run.startedAt ?? run.createdAt, now)}
                          </span>
                        </span>
                      </span>
                      <ExternalLink size={11} className="bg-agents-open-icon" />
                    </button>
                  ) : (
                    <>
                      {run.status === "pending"
                        ? <Play size={12} className="bg-agents-item-icon" />
                        : <Loader2 size={12} className="bg-agents-item-icon is-spinning" />}
                      <div className="bg-agents-item-body">
                        <span className="bg-agents-item-kind">{run.status === "pending" ? `${kindLabel(run.kind)} queued` : kindLabel(run.kind)}</span>
                        {targetTitle(run) ? (
                          <span className="bg-agents-item-target" title={targetTitle(run)}>
                            {targetTitle(run)}
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                  <button
                    className="btn-icon btn-icon-sm bg-agents-cancel"
                    type="button"
                    title="Cancel this background agent"
                    onClick={() => void handleCancel(run.id)}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {recent.length > 0 || recentPlanRuns.length > 0 ? (
                <div className="bg-agents-section-label">Recent</div>
              ) : null}
              {recentPlanRuns.map((run) => {
                const chat = chatSessions.find((candidate) => candidate.id === run.chatSessionId);
                const view = derivePlanRunViewState(run, chat?.runState);
                const plan = plans.find((candidate) => candidate.id === run.planId);
                const archiveReason = !plan
                  ? "Cannot archive: linked plan is unavailable."
                  : plan.status !== "finished"
                    ? `Cannot archive: linked plan is ${plan.status}; finish it first.`
                    : !plan.changeName
                      ? "Cannot archive: plan has no linked OpenSpec change."
                      : null;
                const StatusIcon = view.state === "complete"
                  ? Check
                  : view.state === "awaiting-review"
                    ? ClipboardCheck
                    : view.state === "interrupted"
                      ? CircleHelp
                      : XCircle;
                return (
                  <div key={run.id} className={`bg-agents-item is-${view.state}`}>
                    {run.chatSessionId && onOpenChatSession ? (
                      <button
                        className="bg-agents-item-open"
                        type="button"
                        title="Open this plan run's retained chat"
                        onClick={() => handleOpenChat(run.chatSessionId!, run.id)}
                      >
                        <StatusIcon size={12} className="bg-agents-item-icon" />
                        <span className="bg-agents-item-body">
                          <span className="bg-agents-item-kind">{view.label}</span>
                          <span className="bg-agents-item-target" title={planTitle(run.planId)}>
                            {planTitle(run.planId) || run.planId}
                          </span>
                          {run.error ? <span className="bg-agents-item-error" title={run.error}>{run.error}</span> : null}
                        </span>
                        <ExternalLink size={11} className="bg-agents-open-icon" />
                      </button>
                    ) : (
                      <>
                        <StatusIcon size={12} className="bg-agents-item-icon" />
                        <div className="bg-agents-item-body">
                          <span className="bg-agents-item-kind">{view.label}</span>
                          <span className="bg-agents-item-target">{planTitle(run.planId) || run.planId}</span>
                          {run.error ? <span className="bg-agents-item-error" title={run.error}>{run.error}</span> : null}
                        </div>
                      </>
                    )}
                    <div className="bg-agents-item-actions">
                      {view.state === "awaiting-review" || view.state === "interrupted" ? (
                        <>
                          <button className="btn btn-sm" type="button" title={run.chatSessionId ? "Resume this plan in its retained chat" : "Open Runs to choose a new execution owner"} onClick={() => void handleResumePlanRun(run)}>
                            <Play size={10} /> Resume
                          </button>
                          <button className="btn btn-sm" type="button" title="Review the retained artifacts and mark this run complete" onClick={() => void handleReviewPlanRun(run)}>
                            <ClipboardCheck size={10} /> Review
                          </button>
                        </>
                      ) : null}
                      {view.state === "failed" ? (
                        <button className="btn btn-sm" type="button" title={run.chatSessionId ? "Retry this plan in its retained chat" : "Open Runs to choose a new execution owner"} onClick={() => void handleResumePlanRun(run)}>
                          <RotateCcw size={10} /> Retry
                        </button>
                      ) : null}
                      {view.state === "complete" ? (
                        <button className="btn btn-sm" type="button" title={archiveReason ?? "Open the linked change and archive it"} disabled={archiveReason !== null} onClick={handleArchivePlan}>
                          <Archive size={10} /> Archive
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {recent.map((run) => (
                <div key={run.id} className={`bg-agents-item is-${run.status}`}>
                  {run.sessionChatId && onOpenChatSession ? (
                    <button
                      className="bg-agents-item-open"
                      type="button"
                      title="Open the chat where this agent worked"
                      onClick={() => handleOpenChat(run.sessionChatId!, run.id)}
                    >
                      {run.status === "succeeded" ? (
                        <Check size={12} className="bg-agents-item-icon is-ok" />
                      ) : (
                        <XCircle size={12} className="bg-agents-item-icon is-bad" />
                      )}
                      <span className="bg-agents-item-body">
                        <span className="bg-agents-item-kind">{kindLabel(run.kind)}</span>
                        {targetTitle(run) ? (
                          <span className="bg-agents-item-target" title={targetTitle(run)}>
                            {targetTitle(run)}
                          </span>
                        ) : null}
                        <span className="bg-agents-item-meta">
                          {run.modelId ? <span className="bg-agents-model">{run.modelId}</span> : null}
                          {run.startedAt && run.completedAt ? (
                            <span className="bg-agents-elapsed">
                              {formatDuration(run.startedAt, run.completedAt)}
                            </span>
                          ) : null}
                          <span className={`bg-agents-status is-${run.status}`}>{run.status}</span>
                        </span>
                        {run.error ? (
                          <span className="bg-agents-item-error" title={run.error}>{run.error}</span>
                        ) : null}
                      </span>
                      <ExternalLink size={11} className="bg-agents-open-icon" />
                    </button>
                  ) : (
                    <>
                      {run.status === "succeeded" ? (
                        <Check size={12} className="bg-agents-item-icon is-ok" />
                      ) : (
                        <XCircle size={12} className="bg-agents-item-icon is-bad" />
                      )}
                      <div className="bg-agents-item-body">
                        <span className="bg-agents-item-kind">{kindLabel(run.kind)}</span>
                        <span className={`bg-agents-status is-${run.status}`}>{run.status}</span>
                        {run.error ? (
                          <span className="bg-agents-item-error" title={run.error}>{run.error}</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

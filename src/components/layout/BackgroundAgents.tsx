import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import {
  isTerminalRunStatus,
  pipelineCancel,
  pipelineListRuns,
  pipelineListRunsByProject,
  type PipelineRun,
} from "../../lib/pipeline";
import { cancelPlanRun, listPlanRuns, type PlanRun } from "../../lib/planRuns";
import { usePlanningEvents } from "../../state/planningEvents";
import { getConcurrencyLimits } from "../../lib/runConcurrency";
import type { Plan } from "../../lib/plans";

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
};

export function BackgroundAgents({ sessionId, projectPath, plans, onOpenChatSession }: BackgroundAgentsProps) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [planRuns, setPlanRuns] = useState<PlanRun[]>([]);
  const [open, setOpen] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setRuns([]);
      setPlanRuns([]);
      return;
    }
    // Query pipeline runs by project path (not session ID) so runs from
    // any workspace session in this project are visible. Fall back to
    // session-scoped query if projectPath is unavailable.
    const pipelineQuery = projectPath
      ? pipelineListRunsByProject(projectPath).catch(() => [] as PipelineRun[])
      : pipelineListRuns(sessionId).catch(() => [] as PipelineRun[]);
    const [pipeline, plan, limits] = await Promise.all([
      pipelineQuery,
      listPlanRuns(sessionId).catch(() => [] as PlanRun[]),
      getConcurrencyLimits().catch(() => null),
    ]);
    setRuns(pipeline);
    setPlanRuns(plan);
    if (limits) setMaxConcurrent(limits.globalMax);
  }, [sessionId, projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePlanningEvents(refresh);

  const active = useMemo(
    () => runs.filter((r) => !isTerminalRunStatus(r.status)),
    [runs],
  );
  const activePlanRuns = useMemo(
    () => planRuns.filter((r) => r.status === "running" || r.status === "pending"),
    [planRuns],
  );
  const activeCount = active.length + activePlanRuns.length;
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
    try {
      await cancelPlanRun(runId, false);
    } catch {
      // Run already finished — refresh reflects the final state.
    }
    void refresh();
  }, [refresh]);

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
    try {
      await pipelineCancel(runId);
    } catch {
      // Run already finished — the refresh below reflects the final state.
    }
    void refresh();
  }, [refresh]);

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
            ? `${activeCount} background agent${activeCount === 1 ? "" : "s"} running`
            : "Background agents"
        }
        onClick={() => {
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
                  {activeCount > 0
                    ? `${activeCount} running`
                    : "Nothing running"}
                </span>
              </div>
              <button className="btn-icon" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="bg-agents-list">
              {activeCount === 0 && recent.length === 0 ? (
                <div className="bg-agents-empty">
                  No background agents yet. Generating ideas, preparing an
                  OpenSpec plan, or running an assigned plan shows up here.
                </div>
              ) : null}
              {activePlanRuns.map((run) => (
                <div
                  key={run.id}
                  className="bg-agents-item is-running"
                  draggable={!!run.chatSessionId}
                  onDragStart={(e) => {
                    if (!run.chatSessionId) return;
                    e.dataTransfer.setData("text/plain", run.chatSessionId);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title={run.chatSessionId ? "Drag into the panel grid to open the chat" : undefined}
                >
                  <Loader2 size={12} className="bg-agents-item-icon is-spinning" />
                  <div className="bg-agents-item-body">
                    <span className="bg-agents-item-kind">Working on plan</span>
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
                  </div>
                  {run.chatSessionId && onOpenChatSession ? (
                    <button
                      className="btn-icon btn-icon-sm"
                      type="button"
                      title="Open the chat where this agent works the plan"
                      onClick={() => {
                        setOpen(false);
                        onOpenChatSession(run.chatSessionId!);
                      }}
                    >
                      <ExternalLink size={11} />
                    </button>
                  ) : null}
                  <button
                    className="btn-icon btn-icon-sm bg-agents-cancel"
                    type="button"
                    title="Cancel this plan run"
                    onClick={() => void handleCancelPlanRun(run.id)}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {active.map((run) => (
                <div
                  key={run.id}
                  className="bg-agents-item is-running"
                  draggable={!!run.sessionChatId}
                  onDragStart={(e) => {
                    if (!run.sessionChatId) return;
                    e.dataTransfer.setData("text/plain", run.sessionChatId);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title={run.sessionChatId ? "Drag into the panel grid to open the chat" : undefined}
                >
                  <Loader2 size={12} className="bg-agents-item-icon is-spinning" />
                  <div className="bg-agents-item-body">
                    <span className="bg-agents-item-kind">{kindLabel(run.kind)}</span>
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
                  </div>
                  {run.sessionChatId && onOpenChatSession ? (
                    <button
                      className="btn-icon btn-icon-sm"
                      type="button"
                      title="Open the chat this agent streams into"
                      onClick={() => {
                        setOpen(false);
                        onOpenChatSession(run.sessionChatId!);
                      }}
                    >
                      <ExternalLink size={11} />
                    </button>
                  ) : null}
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
              {recent.length > 0 ? (
                <div className="bg-agents-section-label">Recent</div>
              ) : null}
              {recent.map((run) => (
                <div key={run.id} className={`bg-agents-item is-${run.status}`}>
                  {run.status === "succeeded" ? (
                    <Check size={12} className="bg-agents-item-icon is-ok" />
                  ) : (
                    <XCircle size={12} className="bg-agents-item-icon is-bad" />
                  )}
                  <div className="bg-agents-item-body">
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
                  </div>
                  {run.sessionChatId && onOpenChatSession ? (
                    <button
                      className="btn-icon btn-icon-sm"
                      type="button"
                      title="Open the chat this agent streamed into"
                      onClick={() => {
                        setOpen(false);
                        onOpenChatSession(run.sessionChatId!);
                      }}
                    >
                      <ExternalLink size={11} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

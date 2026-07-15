import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import {
  isTerminalRunStatus,
  pipelineCancel,
  pipelineListRuns,
  type PipelineRun,
} from "../../lib/pipeline";
import { usePlanningEvents } from "../../state/planningEvents";
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
  /** Plans for resolving a run's target title from its planId. */
  plans: Plan[];
  /** Focus the chat session a run streams into (preview the chat). */
  onOpenChatSession?: (chatSessionId: string) => void;
};

/**
 * Taskbar indicator for background AI stages (pipeline runs): shows a live
 * count while stages run, and a dropdown with what each agent is doing, the
 * model it uses, elapsed time, errors, and a jump to the run's chat.
 */
export function BackgroundAgents({ sessionId, plans, onOpenChatSession }: BackgroundAgentsProps) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setRuns([]);
      return;
    }
    try {
      setRuns(await pipelineListRuns(sessionId));
    } catch {
      // Backend without pipeline support (e.g. mocked e2e) — show nothing.
      setRuns([]);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePlanningEvents(refresh);

  const active = useMemo(
    () => runs.filter((r) => !isTerminalRunStatus(r.status)),
    [runs],
  );
  const recent = useMemo(
    () => runs.filter((r) => isTerminalRunStatus(r.status)).slice(0, RECENT_LIMIT),
    [runs],
  );

  // Elapsed ticker + poll while agents are active (planning events only fire
  // on stage transitions, not during a long model call).
  useEffect(() => {
    if (active.length === 0) return;
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [active.length, refresh]);

  const targetTitle = useCallback(
    (run: PipelineRun): string => {
      if (run.planId) {
        const plan = plans.find((p) => p.id === run.planId);
        if (plan) return `#${plan.referenceId} ${plan.title}`;
      }
      return run.inputSummary || "";
    },
    [plans],
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
        className={`btn-icon bg-agents-btn${active.length > 0 ? " is-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          active.length > 0
            ? `${active.length} background agent${active.length === 1 ? "" : "s"} running`
            : "Background agents"
        }
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
      >
        <Bot size={14} />
        {active.length > 0 ? <span className="bg-agents-badge">{active.length}</span> : null}
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
                  {active.length > 0
                    ? `${active.length} running`
                    : "Nothing running"}
                </span>
              </div>
              <button className="btn-icon" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="bg-agents-list">
              {active.length === 0 && recent.length === 0 ? (
                <div className="bg-agents-empty">
                  No background agents yet. Generating ideas or preparing an
                  OpenSpec plan shows up here.
                </div>
              ) : null}
              {active.map((run) => (
                <div key={run.id} className="bg-agents-item is-running">
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

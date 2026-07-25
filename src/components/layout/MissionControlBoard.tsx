import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, GitBranch } from "lucide-react";
import type { Plan } from "../../lib/plans";
import { listPlanRuns, type PlanRun } from "../../lib/planRuns";
import { getDependencyGraph, type DependencyGraph } from "../../lib/planDependencies";
import { openspecTaskProgress, type TaskProgress } from "../../lib/openspec";
import { estimateEta, formatElapsedMs } from "../../lib/runEta";
import { usePlanningEvents } from "../../state/planningEvents";
import { usePanelStatus } from "../panels/PanelStatusContext";
import { SkeletonRows } from "./Loading";

type MissionControlBoardProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  /** Open grid panels (panel id ↔ chat session id) — used to read the owner
   *  chat's live panel status for attention states. */
  chatPanels?: { panelId: string; chatSessionId: string | null }[];
  /** Focus the chat session hosting a run (closes the planning surface). */
  onOpenChatSession?: (chatSessionId: string) => void;
};
type CardState = "queued" | "running" | "blocked" | "attention" | "finished";

/** Wall state for one run card, derived per render. */
type RunCard = {
  run: PlanRun;
  plan: Plan | null;
  state: CardState;
  blockers: string[];
  attention: string | null;
  progress: TaskProgress | null;
};

const STATE_LABEL: Record<CardState, string> = {
  queued: "Queued",
  running: "Running",
  blocked: "Blocked",
  attention: "Needs you",
  finished: "Finished",
};

/**
 * Mission control: one live card per active/unintegrated plan run — owner
 * chat, worktree, task progress, blockers, attention states, elapsed time,
 * and a task-velocity completion estimate (display-only).
 */
export function MissionControlBoard({ sessionId, projectPath, plans, chatPanels, onOpenChatSession }: MissionControlBoardProps) {
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  // Starts true: `refresh` runs on mount, and the first commit otherwise
  // claimed "No runs yet" before either fetch had returned.
  const [loading, setLoading] = useState(true);
  const [progressByRun, setProgressByRun] = useState<Map<string, TaskProgress>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  // Task-completion tick timestamps per run — fed to the ETA estimator when a
  // run's completed count increases.
  const ticksRef = useRef<Map<string, number[]>>(new Map());
  const lastDoneRef = useRef<Map<string, number>>(new Map());
  const { statuses } = usePanelStatus();

  const refresh = useCallback(() => {
    if (!sessionId) {
      setRuns([]);
      setGraph(null);
      // Nothing to load is a settled state, not a pending one.
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      listPlanRuns(sessionId).then(setRuns, () => setRuns([])),
      getDependencyGraph(sessionId).then(setGraph, () => setGraph(null)),
    ]).then(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  usePlanningEvents(refresh);

  const visibleRuns = useMemo(
    () => runs.filter((r) => r.status !== "cancelled" && r.status !== "failed"),
    [runs],
  );
  const anyActive = visibleRuns.some((r) => r.status === "running" || r.status === "pending");

  // Elapsed ticker + task-progress poll while runs are active.
  useEffect(() => {
    if (!anyActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [anyActive]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const poll = () => {
      for (const run of visibleRuns) {
        const plan = plans.find((p) => p.id === run.planId);
        if (!plan?.changeName) continue;
        void openspecTaskProgress(projectPath, plan.changeName)
          .then((progress) => {
            if (cancelled) return;
            setProgressByRun((prev) => {
              const next = new Map(prev);
              next.set(run.id, progress);
              return next;
            });
            // Record a tick when the completed count advances.
            const last = lastDoneRef.current.get(run.id) ?? 0;
            if (progress.completed > last) {
              lastDoneRef.current.set(run.id, progress.completed);
              const ticks = ticksRef.current.get(run.id) ?? [];
              ticks.push(Date.now());
              ticksRef.current.set(run.id, ticks);
            }
          })
          .catch(() => {});
      }
    };
    poll();
    if (!anyActive) return () => { cancelled = true; };
    const interval = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectPath, visibleRuns, plans, anyActive]);

  const cards = useMemo<RunCard[]>(() => {
    return visibleRuns.map((run) => {
      const plan = plans.find((p) => p.id === run.planId) ?? null;
      const node = graph?.nodes.find((n) => n.planId === run.planId) ?? null;
      const blockers: string[] = [];
      if (node?.blockReason) blockers.push(node.blockReason);
      if (node && node.collisions.length > 0) blockers.push(`collides: ${node.collisions.join(", ")}`);
      // Attention: the run waits on the user. The owner chat's live panel
      // status comes from the panel grid mapping (statuses key by panel id).
      const ownerPanelId = run.chatSessionId
        ? chatPanels?.find((p) => p.chatSessionId === run.chatSessionId)?.panelId
        : undefined;
      const chatStatus = ownerPanelId ? statuses[ownerPanelId]?.status : undefined;
      let attention: string | null = null;
      if (run.status === "awaiting_review") attention = "Mark as complete?";
      else if (chatStatus === "asking") attention = "Waiting on your answer";
      const state: CardState = attention
        ? "attention"
        : run.status === "pending"
          ? "queued"
          : run.status === "running"
            ? (blockers.length > 0 ? "blocked" : "running")
            : "finished";
      return { run, plan, state, blockers, attention, progress: progressByRun.get(run.id) ?? null };
    });
  }, [visibleRuns, plans, graph, statuses, progressByRun, chatPanels]);

  if (!sessionId) {
    return <div className="mission-control-empty text-muted text-sm" title="No session">Open a project to see runs.</div>;
  }

  return (
    <div className="mission-control" title="Mission control — live run cards">
      {loading && cards.length === 0 ? (
        <SkeletonRows rows={3} label="Loading runs…" />
      ) : cards.length === 0 ? (
        <div className="mission-control-empty text-muted text-sm" title="No runs">
          No runs yet. Launch ready plans into chats to see them here.
        </div>
      ) : (
        <div className="mission-control-grid">
          {cards.map(({ run, plan, state, blockers, attention, progress }) => {
            const elapsedMs = run.startedAt ? (run.finishedAt ?? Math.floor(now / 1000)) * 1000 - run.startedAt * 1000 : null;
            const remaining = progress ? progress.total - progress.completed : 0;
            const eta = state === "running" && progress
              ? estimateEta(ticksRef.current.get(run.id) ?? [], remaining)
              : null;
            const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
            return (
              <div key={run.id} className={`mission-card mission-card-${state}`} title={`${plan?.referenceId ?? run.planId} — ${STATE_LABEL[state]}`}>
                <div className="mission-card-head">
                  <span className="mission-card-ref">{plan?.referenceId ?? run.planId.slice(0, 8)}</span>
                  <span className={`mission-card-state mission-card-state-${state}`} title={state === "queued" ? "Waiting on a concurrency slot" : STATE_LABEL[state]}>
                    {STATE_LABEL[state]}
                  </span>
                </div>
                <div className="mission-card-title" title={plan?.title ?? "(no linked plan)"}>{plan?.title ?? "(no linked plan)"}</div>
                <div className="mission-card-meta">
                  {run.chatSessionId && onOpenChatSession ? (
                    <button
                      className="btn btn-sm mission-card-chat"
                      type="button"
                      title="Focus the chat running this plan"
                      onClick={() => onOpenChatSession(run.chatSessionId ?? "")}
                    >
                      <ExternalLink size={10} /> Open chat
                    </button>
                  ) : (
                    <span className="text-muted text-sm" title="No owner chat">no chat</span>
                  )}
                  {run.workspacePath ? (
                    <span className="mission-card-worktree" title={`Worktree: ${run.workspacePath}`}>
                      <GitBranch size={10} /> {run.workspacePath.split(/[\\/]/).pop()}
                    </span>
                  ) : null}
                </div>
                {progress ? (
                  <div className="mission-card-progress" title={`${progress.completed}/${progress.total} tasks (${pct}%)`}>
                    <div className="mission-card-progress-bar">
                      <div className="mission-card-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="mission-card-progress-label">{progress.completed}/{progress.total}</span>
                    {progress.total > 0 ? (
                      <span className="mission-card-progress-pct" title={`${pct}% of tasks complete`}>{pct}%</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="mission-card-timing">
                  {run.startedAt ? (
                    <span
                      className="mission-card-started"
                      title={`Started ${new Date(run.startedAt * 1000).toLocaleString()}`}
                    >
                      started {new Date(run.startedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : null}
                  {elapsedMs !== null ? (
                    <span title={run.finishedAt ? "Actual duration" : "Elapsed"}>{formatElapsedMs(elapsedMs)}</span>
                  ) : null}
                  {eta ? (
                    eta.kind === "estimate" ? (
                      <span className="mission-card-eta" title="Expected time until finished — estimated from observed task velocity, display only">{eta.label}</span>
                    ) : eta.kind === "estimating" ? (
                      <span className="mission-card-eta text-muted" title="No task ticks observed yet">estimating…</span>
                    ) : null
                  ) : null}
                </div>
                {attention ? (
                  <button
                    className="mission-card-attention"
                    type="button"
                    title={`${attention} — open the chat to resolve`}
                    onClick={() => run.chatSessionId && onOpenChatSession?.(run.chatSessionId)}
                  >
                    <AlertTriangle size={10} /> {attention}
                  </button>
                ) : null}
                {blockers.length > 0 ? (
                  <div className="mission-card-blockers" title={blockers.join("; ")}>
                    {blockers.join("; ")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

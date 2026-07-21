import type { Dispatch, SetStateAction } from "react";
import { Archive, ClipboardCheck, Play, RotateCcw } from "lucide-react";
import type { Plan } from "../../../lib/plans";
import { markPlanRunComplete } from "../../../lib/planRuns";
import type { PlanRun, FinishOutcome } from "../../../lib/planRuns";
import type { SchematicReport } from "../../../lib/schematic";
import type { IdeaStateValue } from "../../../state/ideas";
import { OptionList, type OptionListOption } from "../OptionList";
import { Disclosure } from "../../Disclosure";
import { PlanningCommandCenter } from "../PlanningCommandCenter";
import { IntegrationQueue } from "../../panels/IntegrationQueue";
import { CompletionCard } from "../../panels/CompletionCard";
import {
  reviewMergeEntry,
  type LaunchProfile,
  type DependencyGraph,
  type DependencyNode,
  type MergeReviewEntry,
  type EngineKind,
  type WorkspacePolicy,
  type SchedulingMode,
  type FinishPolicy,
} from "../../../lib/planDependencies";
import type { PlanningTab } from "../PlanningInspector";

const FINISH_POLICY_LABELS: Record<FinishPolicy, string> = {
  hold: "Hold for review",
  auto_commit: "Auto-commit",
  auto_commit_pr: "Auto-commit + PR",
  queue_merge_review: "Queue merge review",
};
const ENGINE_OPTION_ITEMS: OptionListOption<EngineKind>[] = [
  { id: "openspec", label: "OpenSpec", title: "Use the OpenSpec planning engine" },
  { id: "native", label: "Native", title: "Use the native planning engine" },
];
const WORKSPACE_OPTION_ITEMS: OptionListOption<WorkspacePolicy>[] = [
  { id: "isolated_worktrees", label: "Isolated worktrees", title: "Each run uses its own isolated worktree" },
  { id: "sequential_primary", label: "Sequential primary", title: "Run sequentially in the primary worktree" },
];
const SCHEDULING_OPTION_ITEMS: OptionListOption<SchedulingMode>[] = [
  { id: "safe", label: "Safe", title: "Safe scheduling — conservative dependency ordering" },
  { id: "yolo", label: "Yolo", title: "Eager scheduling — run as soon as possible" },
];
const FINISH_OPTION_ITEMS: OptionListOption<FinishPolicy>[] = [
  { id: "hold", label: "Hold for review", title: "Hold finished runs for manual review" },
  { id: "auto_commit", label: "Auto-commit", title: "Automatically commit changes when a run finishes" },
  { id: "auto_commit_pr", label: "Auto-commit + PR", title: "Commit changes and open a pull request" },
  { id: "queue_merge_review", label: "Queue merge review", title: "Queue finished runs for merge review" },
];

export type LaunchFormState = {
  workerCount: number;
  workspacePolicy: WorkspacePolicy;
  schedulingMode: SchedulingMode;
  engine: EngineKind;
  finishPolicy: FinishPolicy;
};

export type LaunchSummary = {
  workerCount: number;
  providerCap: number;
  startCount: number;
  queueCount: number;
  worktrees: number;
  branches: number;
  prerequisites: number;
  collisions: number;
  policy: WorkspacePolicy;
  schedulingMode: SchedulingMode;
  finishPolicy: FinishPolicy;
};

export type MergeSessionState = {
  active: boolean;
  currentEntryId: string | null;
  total: number;
  results: { entryId: string; action: "merged" | "skipped" | "conflicted"; detail?: string }[];
};

type FlowTabProps = {
  ideaState: IdeaStateValue;
  plans: Plan[];
  planRuns: PlanRun[];
  setPlanRuns: Dispatch<SetStateAction<PlanRun[]>>;
  onStartIdeaRound?: () => void;
  setTab: Dispatch<SetStateAction<PlanningTab>>;
  launchForm: LaunchFormState;
  setLaunchForm: Dispatch<SetStateAction<LaunchFormState>>;
  handleSaveLaunchProfile: () => void;
  launchSaving: boolean;
  projectPath: string | null;
  schematicReport: SchematicReport | null;
  launchConfirmOpen: boolean;
  setLaunchConfirmOpen: Dispatch<SetStateAction<boolean>>;
  launchSummary: LaunchSummary | null;
  runtimeReady: boolean;
  runtimeState: string | undefined;
  handleLaunchClick: () => void;
  handleLaunchConfirm: () => void;
  completionDismissed: Set<string>;
  setCompletionDismissed: Dispatch<SetStateAction<Set<string>>>;
  finishOutcomes: Map<string, FinishOutcome>;
  sessionId: string | null;
  onOpenChatSession: (chatSessionId: string) => void;
  launchProfile: LaunchProfile | null;
  runBoardLoading: boolean;
  dependencyGraph: DependencyGraph | null;
  mergeQueueLoading: boolean;
  mergeQueue: MergeReviewEntry[];
  setMergeQueue: Dispatch<SetStateAction<MergeReviewEntry[]>>;
  mergeSelected: Set<string>;
  setMergeSelected: Dispatch<SetStateAction<Set<string>>>;
  mergeSession: MergeSessionState;
  setMergeSession: Dispatch<SetStateAction<MergeSessionState>>;
  handleResumePlanRun: (run: PlanRun) => void;
  handleReviewMergeEntry: (entryId: string, decision: "approved" | "rejected" | "merged") => void;
};

export function FlowTab({
  ideaState,
  plans,
  planRuns,
  setPlanRuns,
  onStartIdeaRound,
  setTab,
  launchForm,
  setLaunchForm,
  handleSaveLaunchProfile,
  launchSaving,
  projectPath,
  schematicReport,
  launchConfirmOpen,
  setLaunchConfirmOpen,
  launchSummary,
  runtimeReady,
  runtimeState,
  handleLaunchClick,
  handleLaunchConfirm,
  completionDismissed,
  setCompletionDismissed,
  finishOutcomes,
  sessionId,
  onOpenChatSession,
  launchProfile,
  runBoardLoading,
  dependencyGraph,
  mergeQueueLoading,
  mergeQueue,
  setMergeQueue,
  mergeSelected,
  setMergeSelected,
  mergeSession,
  setMergeSession,
  handleResumePlanRun,
  handleReviewMergeEntry,
}: FlowTabProps) {
  function RunBoardRow({ node }: { node: DependencyNode }) {
    const plan = plans.find((p) => p.id === node.planId);
    const run = planRuns.find((r) => r.planId === node.planId);
    const ownerChat = run?.chatSessionId ? `#${run.chatSessionId.slice(0, 8)}` : "unassigned";
    const engine = launchProfile?.engine === "native" ? "native" : "openspec";
    const provider = launchProfile?.providerId || "—";
    const model = launchProfile?.modelId || "—";
    const worktree = run?.workspacePath ?? "—";
    const branch = run?.workspacePath ? run.workspacePath.split(/[\\/]/).pop() ?? run.workspacePath : "—";
    const tooltip = [
      `Plan: ${node.title} (#${node.referenceId})`,
      `Status: ${node.status}`,
      `Priority: ${node.priority}`,
      `Readiness: ${node.readiness}`,
      `Prerequisites: ${node.prerequisites.join(", ") || "none"}`,
      `Affected paths: ${node.affectedPaths.join(", ") || "none"}`,
      `Collisions: ${node.collisions.join(", ") || "none"}`,
      `Owner chat: ${ownerChat}`,
      `Engine: ${engine}`,
      `Provider: ${provider}`,
      `Model: ${model}`,
      `Branch: ${branch}`,
      `Worktree: ${worktree}`,
      node.blockReason ? `Blocked: ${node.blockReason}` : null,
      `Dispatchable: ${node.dispatchable ? "yes" : "no"}`,
      `YOLO confirmed: ${node.yoloConfirmed ? "yes" : "no"}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const resumeBlockedReason = !run
      ? "Cannot resume: no plan run exists."
      : !run.chatSessionId
        ? "Cannot resume: this run has no retained chat owner."
        : null;
    const archiveBlockedReason = !plan
      ? "Cannot archive: linked plan is unavailable."
      : plan.status !== "finished"
        ? `Cannot archive: linked plan is ${plan.status}; finish it first.`
        : !plan.changeName
          ? "Cannot archive: plan has no linked OpenSpec change."
          : null;
    return (
      <div className="run-board-row" title={tooltip}>
        <div className="run-board-cell run-board-cell-title">{node.title}</div>
        <div className="run-board-cell" title={`Priority: ${node.priority}`}>{node.priority}</div>
        <div className="run-board-cell run-board-cell-badges">
          {node.prerequisites.length > 0
            ? node.prerequisites.map((prereq) => (
                <span key={prereq} className="run-board-badge" title={`Prerequisite: ${prereq}`}>
                  {prereq}
                </span>
              ))
            : <span className="run-board-badge run-board-badge-empty" title="No prerequisites">—</span>}
        </div>
        <div className="run-board-cell" title={`Owner chat: ${ownerChat}`}>{ownerChat}</div>
        <div className="run-board-cell" title={`Engine: ${engine} | Provider: ${provider} | Model: ${model}`}>
          {engine}/{provider}/{model}
        </div>
        <div className="run-board-cell" title={`Branch: ${branch} | Worktree: ${worktree}`}>
          {branch}
        </div>
        <div className="run-board-cell run-board-cell-badges">
          {node.affectedPaths.length > 0
            ? node.affectedPaths.map((path) => (
                <span key={path} className="run-board-badge" title={`Claimed path: ${path}`}>
                  {path.split(/[\\/]/).pop() ?? path}
                </span>
              ))
            : <span className="run-board-badge run-board-badge-empty" title="No affected paths">—</span>}
        </div>
        <div className="run-board-cell" title="Progress: not tracked">—</div>
        <div className="run-board-cell" title={node.blockReason || "No blockers"}>
          {node.blockReason ? "blocked" : "—"}
        </div>
        <div className="run-board-cell" title={`Collisions: ${node.collisions.join(", ") || "none"}`}>
          {node.collisions.length}
        </div>
        <div className="run-board-cell" title={`Merge readiness: ${node.readiness}`}>
          {node.readiness}
        </div>
        <div className="run-board-cell run-board-cell-actions">
          {!run ? (
            <span className="text-muted" title="No plan run exists yet">Not started</span>
          ) : run.status === "pending" || run.status === "running" ? (
            <button
              className="btn btn-sm"
              type="button"
              title={run.chatSessionId ? "Open this run's retained chat" : "Cannot open: this run has no retained chat owner."}
              disabled={!run.chatSessionId}
              onClick={() => onOpenChatSession(run.chatSessionId!)}
            >
              <Play size={10} /> Open
            </button>
          ) : run.status === "awaiting_review" ? (
            <>
              <button className="btn btn-sm" type="button" title={resumeBlockedReason ?? "Resume this plan in its retained chat"} disabled={resumeBlockedReason !== null} onClick={() => run && void handleResumePlanRun(run)}>
                <Play size={10} /> Resume
              </button>
              <button className="btn btn-sm" type="button" title="Review the linked OpenSpec tasks and retained artifacts" onClick={() => setTab("changes")}>
                <ClipboardCheck size={10} /> Review
              </button>
            </>
          ) : run.status === "failed" || run.status === "cancelled" ? (
            <button className="btn btn-sm" type="button" title={resumeBlockedReason ?? "Retry this plan in its retained chat"} disabled={resumeBlockedReason !== null} onClick={() => run && void handleResumePlanRun(run)}>
              <RotateCcw size={10} /> Retry
            </button>
          ) : (
            <button className="btn btn-sm" type="button" title={archiveBlockedReason ?? "Open the linked completed change to archive it"} disabled={archiveBlockedReason !== null} onClick={() => setTab("changes")}>
              <Archive size={10} /> Archive
            </button>
          )}
        </div>
      </div>
    );
  }

  function RunBoard() {
    if (!sessionId) {
      return (
        <div className="run-board">
          <div className="run-board-empty" title="No session selected">No session selected</div>
        </div>
      );
    }
    if (runBoardLoading) {
      return (
        <div className="run-board">
          <div className="run-board-empty" title="Loading dependency graph">Loading run board…</div>
        </div>
      );
    }
    if (!dependencyGraph?.nodes.length) {
      return (
        <div className="run-board">
          <div className="run-board-empty" title="No dependency graph nodes available">No run board entries</div>
        </div>
      );
    }
    return (
      <div className="run-board" title={`Dependency graph for session ${sessionId.slice(0, 8)}`}>
        <div className="run-board-header">
          <span className="run-board-header-title">Run board</span>
          <span className="text-muted text-sm" title={`${dependencyGraph.nodes.length} node(s)`}>
            {dependencyGraph.nodes.length} node(s)
          </span>
        </div>
        <div className="run-board-row run-board-row-header" title="Run board column headers">
          <div className="run-board-cell">Plan</div>
          <div className="run-board-cell">Prio</div>
          <div className="run-board-cell">Prereqs</div>
          <div className="run-board-cell">Chat</div>
          <div className="run-board-cell">Engine/Provider/Model</div>
          <div className="run-board-cell">Branch</div>
          <div className="run-board-cell">Claims</div>
          <div className="run-board-cell">%</div>
          <div className="run-board-cell">Blockers</div>
          <div className="run-board-cell">Collisions</div>
          <div className="run-board-cell">Readiness</div>
          <div className="run-board-cell">Next</div>
        </div>
        {dependencyGraph.nodes.map((node) => (
          <RunBoardRow key={node.planId} node={node} />
        ))}
      </div>
    );
  }

  function MergeQueue() {
    if (mergeQueueLoading) {
      return (
        <div className="merge-queue">
          <div className="run-board-empty" title="Loading merge-review queue">Loading merge queue…</div>
        </div>
      );
    }
    if (mergeQueue.length === 0) {
      return (
        <div className="merge-queue">
          <div className="run-board-empty" title="No merge-review entries">No merge-review entries</div>
        </div>
      );
    }
    const pendingEntries = mergeQueue.filter((e) => e.status === "pending");
    const reviewedEntries = mergeQueue.filter((e) => e.status !== "pending");
    // Dependency-aware ordering: use the dependency graph to sort entries by
    // their plan's prerequisites (prerequisites come first).
    const ordered = [...pendingEntries].sort((a, b) => {
      const aDeps = dependencyGraph?.nodes.find((n) => n.planId === a.planId)?.prerequisites ?? [];
      const bDeps = dependencyGraph?.nodes.find((n) => n.planId === b.planId)?.prerequisites ?? [];
      if (aDeps.includes(b.planId)) return 1; // a depends on b → b first
      if (bDeps.includes(a.planId)) return -1; // b depends on a → a first
      return 0;
    });
    const allSelected = pendingEntries.length > 0 && pendingEntries.every((e) => mergeSelected.has(e.id));
    const handleToggleSelect = (entryId: string) => {
      setMergeSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entryId)) next.delete(entryId);
        else next.add(entryId);
        return next;
      });
    };
    const handleToggleAll = () => {
      if (allSelected) {
        setMergeSelected(new Set());
      } else {
        setMergeSelected(new Set(pendingEntries.map((e) => e.id)));
      }
    };
    const handleStartSession = () => {
      const selected = ordered.filter((e) => mergeSelected.has(e.id));
      if (selected.length === 0) return;
      setMergeSession({ active: true, currentEntryId: selected[0].id, total: selected.length, results: [] });
    };
    const handleSessionAction = async (action: "merged" | "skipped" | "stop") => {
      if (!mergeSession.currentEntryId) return;
      const entryId = mergeSession.currentEntryId;
      if (action === "stop") {
        setMergeSession((prev) => ({ ...prev, active: false, currentEntryId: null }));
        return;
      }
      if (action === "merged") {
        try {
          await reviewMergeEntry(entryId, "merged");
          setMergeQueue((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "merged", reviewedAt: Date.now() } : e)));
        } catch (e) {
          setMergeSession((prev) => ({
            ...prev,
            results: [...prev.results, { entryId, action: "conflicted", detail: e instanceof Error ? e.message : String(e) }],
          }));
          advanceSession();
          return;
        }
      }
      setMergeSession((prev) => ({
        ...prev,
        results: [...prev.results, { entryId, action }],
      }));
      advanceSession();
    };
    const advanceSession = () => {
      // Use the full mergeQueue (not just pending) to maintain stable ordering
      // after entries are merged/skipped. Filter by selection and sort by
      // dependency order.
      const selectedOrdered = mergeQueue
        .filter((e) => mergeSelected.has(e.id))
        .sort((a, b) => {
          const aDeps = dependencyGraph?.nodes.find((n) => n.planId === a.planId)?.prerequisites ?? [];
          const bDeps = dependencyGraph?.nodes.find((n) => n.planId === b.planId)?.prerequisites ?? [];
          if (aDeps.includes(b.planId)) return 1;
          if (bDeps.includes(a.planId)) return -1;
          return 0;
        });
      const currentIdx = selectedOrdered.findIndex((e) => e.id === mergeSession.currentEntryId);
      const next = selectedOrdered[currentIdx + 1];
      if (next) {
        setMergeSession((prev) => ({ ...prev, currentEntryId: next.id }));
      } else {
        setMergeSession((prev) => ({ ...prev, active: false, currentEntryId: null }));
      }
    };
    const handleCleanupMerged = () => {
      const merged = mergeSession.results.filter((r) => r.action === "merged");
      setMergeQueue((prev) => prev.filter((e) => !merged.some((r) => r.entryId === e.id)));
      setMergeSession({ active: false, currentEntryId: null, total: 0, results: [] });
      setMergeSelected(new Set());
    };
    // Session summary when inactive but has results.
    const showSummary = !mergeSession.active && mergeSession.results.length > 0;
    const mergedCount = mergeSession.results.filter((r) => r.action === "merged").length;
    const skippedCount = mergeSession.results.filter((r) => r.action === "skipped").length;
    const conflictedCount = mergeSession.results.filter((r) => r.action === "conflicted").length;
    return (
      <div className="merge-queue">
        <div className="run-board-header">
          <span className="run-board-header-title">Merge review</span>
          <span className="text-muted text-sm" title={`${mergeQueue.length} entry(ies)`}>
            {mergeQueue.length} entry(ies)
          </span>
        </div>
        {mergeSession.active ? (
          <div className="merge-session-active" title="Review session in progress">
            <span className="merge-session-label">
              {mergeSession.results.length + 1}/{mergeSession.total}
            </span>
            <div className="merge-session-actions">
              <button className="btn btn-sm btn-primary" type="button" title="Merge this entry" onClick={() => void handleSessionAction("merged")}>Merge</button>
              <button className="btn btn-sm" type="button" title="Skip this entry" onClick={() => void handleSessionAction("skipped")}>Skip</button>
              <button className="btn btn-sm" type="button" title="Stop the review session" onClick={() => void handleSessionAction("stop")}>Stop</button>
            </div>
          </div>
        ) : null}
        {showSummary ? (
          <div className="merge-session-summary" title="Session summary">
            <span className="merge-session-summary-title">Session summary</span>
            <span className="merge-session-summary-row">Merged: {mergedCount}</span>
            <span className="merge-session-summary-row">Skipped: {skippedCount}</span>
            {conflictedCount > 0 ? <span className="merge-session-summary-row merge-session-conflict">Conflicted: {conflictedCount}</span> : null}
            {mergedCount > 0 ? (
              <button className="btn btn-sm" type="button" title="Clean up merged entries from the queue" onClick={handleCleanupMerged}>Clean up merged</button>
            ) : null}
          </div>
        ) : null}
        {!mergeSession.active ? (
          <div className="merge-queue-batch-actions">
            <label className="merge-queue-select-all" title="Select all pending entries">
              <input type="checkbox" checked={allSelected} onChange={handleToggleAll} title="Select all" />
              <span>Select all</span>
            </label>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title="Start a guided review session for selected entries"
              disabled={mergeSelected.size === 0}
              onClick={handleStartSession}
            >
              Review &amp; merge ({mergeSelected.size})
            </button>
          </div>
        ) : null}
        {[...ordered, ...reviewedEntries].map((entry) => {
          const plan = plans.find((p) => p.id === entry.planId);
          const title = plan?.title ?? `Plan ${entry.planId.slice(0, 8)}`;
          const isSelected = mergeSelected.has(entry.id);
          const isCurrent = mergeSession.currentEntryId === entry.id;
          const sessionResult = mergeSession.results.find((r) => r.entryId === entry.id);
          const tooltip = [
            `Plan: ${title}`,
            `Status: ${entry.status}`,
            `Collision review required: ${entry.collisionReviewRequired ? "yes" : "no"}`,
            `Overlapping plans: ${entry.overlappingPlans.join(", ") || "none"}`,
            `Created: ${new Date(entry.createdAt).toLocaleString()}`,
            entry.reviewedAt ? `Reviewed: ${new Date(entry.reviewedAt).toLocaleString()}` : null,
            sessionResult ? `Session: ${sessionResult.action}` : null,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n");
          return (
            <div key={entry.id} className={`merge-queue-entry${isCurrent ? " merge-queue-entry-current" : ""}`} title={tooltip}>
              <div className="merge-queue-entry-main">
                {!mergeSession.active && entry.status === "pending" ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(entry.id)}
                    title={`Select ${title}`}
                  />
                ) : null}
                <span className="merge-queue-entry-title" title={title}>{title}</span>
                <span className="merge-queue-entry-status" title={`Status: ${entry.status}`}>{entry.status}</span>
                {sessionResult ? (
                  <span className="merge-queue-entry-session-result" title={`Session result: ${sessionResult.action}`}>
                    {sessionResult.action}
                  </span>
                ) : null}
              </div>
              {!mergeSession.active ? (
                <div className="merge-queue-entry-actions">
                  <button className="btn btn-sm" type="button" title={`Approve merge entry ${entry.id.slice(0, 8)}`} onClick={() => void handleReviewMergeEntry(entry.id, "approved")}>Approve</button>
                  <button className="btn btn-sm" type="button" title={`Reject merge entry ${entry.id.slice(0, 8)}`} onClick={() => void handleReviewMergeEntry(entry.id, "rejected")}>Reject</button>
                  <button className="btn btn-sm btn-primary" type="button" title={`Merge entry ${entry.id.slice(0, 8)}`} onClick={() => void handleReviewMergeEntry(entry.id, "merged")}>Merge</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flow-board stack">
      {/* Visual command center — stage cards with counts and actions */}
      <PlanningCommandCenter
        ideas={ideaState.ideas.length}
        openspec={plans.filter((p) => p.status === "openspec").length}
        ready={plans.filter((p) => p.status === "ready").length}
        queued={planRuns.filter((r) => r.status === "pending").length}
        running={planRuns.filter((r) => r.status === "running").length}
        blocked={planRuns.filter((r) => r.status === "failed").length}
        review={planRuns.filter((r) => r.status === "awaiting_review").length}
        finished={plans.filter((p) => p.status === "finished").length}
        onGenerateIdeas={() => {
          if (onStartIdeaRound) onStartIdeaRound();
          else setTab("ideas");
        }}
        onReviewIdeas={() => { setTab("ideas"); }}
        onReview={() => { setTab("runs"); }}
        onMerge={() => { setTab("runs"); }}
        onArchiveSync={() => { setTab("changes"); }}
        onStageClick={(stage) => {
          if (stage === "queued" || stage === "running" || stage === "blocked" || stage === "review") setTab("runs");
          else if (stage === "ideas") setTab("ideas");
          else if (stage === "finished") setTab("changes");
          else setTab("plans");
        }}
      />
      {/* Launch profile */}
      <div className="launch-profile-form" title="Configure how ready plans are launched">
        <Disclosure
          label="Launch profile"
          summary={`${launchForm.workerCount} worker${launchForm.workerCount === 1 ? "" : "s"} · ${launchForm.workspacePolicy.replace(/_/g, " ")} · ${launchForm.schedulingMode} · ${FINISH_POLICY_LABELS[launchForm.finishPolicy]}`}
          title="Workers, workspace, scheduling, engine, and finish policy for launched plans"
        >
        <div className="launch-profile-row">
          <label className="launch-profile-field" title="Number of workers that may run simultaneously (1–8)">
            <span>Workers</span>
            <input
              type="number"
              min={1}
              max={8}
              value={launchForm.workerCount}
              onChange={(e) => {
                const value = Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 8);
                setLaunchForm((prev) => ({ ...prev, workerCount: value }));
              }}
              title="Worker count"
            />
          </label>
          <label className="launch-profile-field" title="Effective concurrent provider call cap derived from worker count">
            <span>Provider cap</span>
            <span className="launch-profile-summary">{launchForm.workerCount}</span>
          </label>
          <label className="launch-profile-field" title="Workspace isolation policy for launched runs">
            <span>Workspace</span>
            <OptionList
              value={launchForm.workspacePolicy}
              options={WORKSPACE_OPTION_ITEMS}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, workspacePolicy: id }))}
              label="Workspace policy"
            />
          </label>
          <label className="launch-profile-field" title="Scheduling safety mode">
            <span>Scheduling</span>
            <OptionList
              value={launchForm.schedulingMode}
              options={SCHEDULING_OPTION_ITEMS}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, schedulingMode: id }))}
              label="Scheduling mode"
            />
          </label>
          <label className="launch-profile-field" title="Execution engine for launched plans">
            <span>Engine</span>
            <OptionList
              value={launchForm.engine}
              options={ENGINE_OPTION_ITEMS}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, engine: id }))}
              label="Engine kind"
            />
          </label>
          <label className="launch-profile-field" title="What happens when a plan run finishes — hold for manual review, auto-commit to the worktree, commit + push a PR, or queue for merge review">
            <span>On finish</span>
            <OptionList
              value={launchForm.finishPolicy}
              options={FINISH_OPTION_ITEMS}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, finishPolicy: id }))}
              label="Finish policy"
            />
          </label>
        </div>
        <div className="launch-profile-confirm-actions">
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title="Save launch profile for this project"
            onClick={() => void handleSaveLaunchProfile()}
            disabled={launchSaving || !projectPath}
          >
            {launchSaving ? "Saving…" : "Save launch profile"}
          </button>
        </div>
        </Disclosure>
      </div>
      {/* Schematic stage */}
      <div className="flow-stage" title="Project schematic — the steering document">
        <div className="flow-stage-header">
          <span className="flow-stage-name">Schematic</span>
          <span className={`flow-stage-count flow-count-${schematicReport ? (schematicReport.health === "complete" ? "ok" : "warn") : "empty"}`}>
            {schematicReport ? (schematicReport.health === "complete" ? "✓" : "!") : "0"}
          </span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {schematicReport ? `${schematicReport.sections.filter((s) => s.state === "filled").length}/${schematicReport.sections.length} sections` : "No schematic"}
        </span>
      </div>

      {/* Ideas stage */}
      <div className="flow-stage" title="Generated ideas across all categories">
        <div className="flow-stage-header">
          <span className="flow-stage-name">Ideas</span>
          <span className="flow-stage-count">{ideaState.ideas.length}</span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {ideaState.ideas.filter((i) => i.status === "concept").length} concept, {ideaState.ideas.filter((i) => i.status === "picked").length} picked
        </span>
      </div>

      {/* Plans stage */}
      <div className="flow-stage" title="Plans promoted from ideas">
        <div className="flow-stage-header">
          <span className="flow-stage-name">Plans</span>
          <span className="flow-stage-count">{plans.length}</span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {plans.filter((p) => p.status === "draft" || p.status === "openspec").length} draft, {plans.filter((p) => p.status === "ready").length} ready
        </span>
        {plans.filter((p) => p.status === "ready").length > 0 ? (
          launchConfirmOpen && launchSummary ? (
            <div className="launch-profile-confirm" title="Review launch summary before dispatching">
              <span className="launch-profile-confirm-title">Launch summary</span>
              <ul className="launch-profile-confirm-list">
                <li><span className="label">Workers</span><span className="value">{launchSummary.workerCount}</span></li>
                <li><span className="label">Provider cap</span><span className="value">{launchSummary.providerCap}</span></li>
                <li><span className="label">Start / queue</span><span className="value">{launchSummary.startCount} / {launchSummary.queueCount}</span></li>
                <li><span className="label">Worktrees</span><span className="value">{launchSummary.worktrees}</span></li>
                <li><span className="label">Branches</span><span className="value">{launchSummary.branches}</span></li>
                <li><span className="label">Prerequisites</span><span className="value">{launchSummary.prerequisites}</span></li>
                <li><span className="label">Collisions</span><span className="value">{launchSummary.collisions}</span></li>
                <li><span className="label">Policy</span><span className="value">{launchSummary.policy}</span></li>
                <li><span className="label">Scheduling</span><span className="value">{launchSummary.schedulingMode}</span></li>
                <li><span className="label">On finish</span><span className="value">{FINISH_POLICY_LABELS[launchSummary.finishPolicy]}</span></li>
              </ul>
              <div className="launch-profile-confirm-actions">
                <button
                  className="btn btn-sm"
                  type="button"
                  title="Cancel launch"
                  onClick={() => setLaunchConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title={`Launch ${launchSummary.startCount + launchSummary.queueCount} ready plan(s)`}
                  onClick={() => void handleLaunchConfirm()}
                >
                  Confirm launch
                </button>
              </div>
            </div>
          ) : runtimeReady ? (
            <button
              className="btn btn-sm btn-primary flow-stage-action"
              type="button"
              title={`Launch ${plans.filter((p) => p.status === "ready").length} ready plan(s) — review summary before dispatch`}
              onClick={() => void handleLaunchClick()}
            >
              Launch {plans.filter((p) => p.status === "ready").length} ready
            </button>
          ) : (
            <div className="flow-runtime-blocked" title="OpenSpec runtime not configured">
              <span className="text-sm text-muted">
                OpenSpec runtime {runtimeState ?? "missing"}. Configure in Settings → OpenSpec.
              </span>
            </div>
          )
        ) : null}
      </div>

      {/* Running stage */}
      <div className="flow-stage" title="Plans currently running in worktrees">
        <div className="flow-stage-header">
          <span className="flow-stage-name">Running</span>
          <span className={`flow-stage-count flow-count-${planRuns.some((r) => r.status === "running") ? "active" : "empty"}`}>
            {planRuns.filter((r) => r.status === "running").length}
          </span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {planRuns.filter((r) => r.status === "running").length} active run(s)
        </span>
      </div>

      {/* Finished stage */}
      <div className="flow-stage" title="Finished and cancelled plans">
        <div className="flow-stage-header">
          <span className="flow-stage-name">Finished</span>
          <span className="flow-stage-count flow-count-ok">{plans.filter((p) => p.status === "finished").length}</span>
        </div>

        <span className="flow-stage-detail text-muted text-sm">
          {plans.filter((p) => p.status === "finished").length} done, {plans.filter((p) => p.status === "cancelled").length} cancelled
        </span>
        {plans.filter((p) => p.status === "finished").length > 0 ? (
          <IntegrationQueue sessionId={sessionId} projectPath={projectPath} />
        ) : null}
        {planRuns
          .filter((r) => (r.status === "awaiting_review" || r.status === "succeeded") && !completionDismissed.has(r.id))
          .map((run) => (
            <CompletionCard
              key={run.id}
              run={run}
              projectPath={projectPath ?? ""}
              finishOutcome={finishOutcomes.get(run.id) ?? null}
              changeName={plans.find((plan) => plan.id === run.planId)?.changeName}
              onReviewTasks={() => setTab("changes")}
              onResume={() => run.chatSessionId ? onOpenChatSession(run.chatSessionId) : setTab("runs")}
              onMarkComplete={async (runId) => {
                await markPlanRunComplete(runId);
                setPlanRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status: "succeeded" } : r)));
              }}
              onDismiss={() => {
                setCompletionDismissed((prev) => new Set(prev).add(run.id));
              }}
            />
          ))}
      </div>

      {/* Run board — dependency graph nodes */}
      <RunBoard />

      {/* Merge-review queue */}
      <MergeQueue />
    </div>
  );
}

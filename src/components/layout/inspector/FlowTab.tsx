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
import { t } from "../../../i18n";
import { formatDateTime } from "../../../i18n/format";

function finishPolicyLabels(): Record<FinishPolicy, string> {
  return {
    hold: t("flowTab.holdForReview"),
    auto_commit: t("flowTab.autoCommit"),
    auto_commit_pr: t("flowTab.autoCommitPr"),
    queue_merge_review: t("flowTab.queueMergeReview"),
  };
}
const ENGINE_OPTION_ITEMS = (): OptionListOption<EngineKind>[] => [
  { id: "openspec", label: t("flowTab.openspec"), title: t("flowTab.useTheOpenspecPlanningEngine") },
  { id: "native", label: t("flowTab.native"), title: t("flowTab.useTheNativePlanningEngine") },
];
const WORKSPACE_OPTION_ITEMS = (): OptionListOption<WorkspacePolicy>[] => [
  { id: "isolated_worktrees", label: t("flowTab.isolatedWorktrees"), title: t("flowTab.eachRunUsesItsOwnIsolated") },
  { id: "sequential_primary", label: t("flowTab.sequentialPrimary"), title: t("flowTab.runSequentiallyInThePrimaryWorktree") },
];
const SCHEDULING_OPTION_ITEMS = (): OptionListOption<SchedulingMode>[] => [
  { id: "safe", label: t("flowTab.safe"), title: t("flowTab.safeSchedulingConservativeDependencyOrdering") },
  { id: "yolo", label: t("flowTab.yolo"), title: t("flowTab.eagerSchedulingRunAsSoonAs") },
];
const FINISH_OPTION_ITEMS = (): OptionListOption<FinishPolicy>[] => [
  { id: "hold", label: t("flowTab.holdForReview"), title: t("flowTab.holdFinishedRunsForManualReview") },
  { id: "auto_commit", label: t("flowTab.autoCommit"), title: t("flowTab.automaticallyCommitChangesWhenARun") },
  { id: "auto_commit_pr", label: t("flowTab.autoCommitPr"), title: t("flowTab.commitChangesAndOpenAPull") },
  { id: "queue_merge_review", label: t("flowTab.queueMergeReview"), title: t("flowTab.queueFinishedRunsForMergeReview") },
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
      t("flowTab.plan2", { title: node.title, referenceId: node.referenceId }),
      t("flowTab.status", { status: node.status }),
      t("flowTab.priority", { priority: node.priority }),
      t("flowTab.readiness2", { readiness: node.readiness }),
      t("flowTab.tooltipPrerequisites", { value: node.prerequisites.join(", ") || t("flowTab.none") }),
      t("flowTab.tooltipAffectedPaths", { value: node.affectedPaths.join(", ") || t("flowTab.none") }),
      t("flowTab.tooltipCollisions", { value: node.collisions.join(", ") || t("flowTab.none") }),
      t("flowTab.ownerChat", { ownerChat }),
      t("flowTab.engine2", { engine }),
      t("flowTab.provider", { provider }),
      t("flowTab.model", { model }),
      t("flowTab.branch2", { branch }),
      t("flowTab.worktree", { worktree }),
      node.blockReason ? t("flowTab.blocked2", { blockReason: node.blockReason }) : null,
      t("flowTab.tooltipDispatchable", { value: node.dispatchable ? t("flowTab.yes") : t("flowTab.no") }),
      t("flowTab.tooltipYoloConfirmed", { value: node.yoloConfirmed ? t("flowTab.yes") : t("flowTab.no") }),
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const resumeBlockedReason = !run
      ? t("flowTab.cannotResumeNoPlanRunExists")
      : !run.chatSessionId
        ? t("flowTab.cannotResumeThisRunHasNo")
        : null;
    const archiveBlockedReason = !plan
      ? t("flowTab.cannotArchiveLinkedPlanIsUnavailable")
      : plan.status !== "finished"
        ? t("flowTab.cannotArchiveLinkedPlanIsFinish", { status: plan.status })
        : !plan.changeName
          ? t("flowTab.cannotArchivePlanHasNoLinked")
          : null;
    return (
      <div className="run-board-row" title={tooltip}>
        <div className="run-board-cell run-board-cell-title">{node.title}</div>
        <div className="run-board-cell" title={t("flowTab.priority", { priority: node.priority })}>{node.priority}</div>
        <div className="run-board-cell run-board-cell-badges">
          {node.prerequisites.length > 0
            ? node.prerequisites.map((prereq) => (
                <span key={prereq} className="run-board-badge" title={t("flowTab.prerequisite", { prereq: prereq })}>
                  {prereq}
                </span>
              ))
            : <span className="run-board-badge run-board-badge-empty" title={t("flowTab.noPrerequisites")}>—</span>}
        </div>
        <div className="run-board-cell" title={t("flowTab.ownerChat", { ownerChat: ownerChat })}>{ownerChat}</div>
        <div className="run-board-cell" title={t("flowTab.engineProviderModel2", { engine: engine, provider: provider, model: model })}>
          {engine}/{provider}/{model}
        </div>
        <div className="run-board-cell" title={t("flowTab.branchWorktree", { branch: branch, worktree: worktree })}>
          {branch}
        </div>
        <div className="run-board-cell run-board-cell-badges">
          {node.affectedPaths.length > 0
            ? node.affectedPaths.map((path) => (
                <span key={path} className="run-board-badge" title={t("flowTab.claimedPath", { path: path })}>
                  {path.split(/[\\/]/).pop() ?? path}
                </span>
              ))
            : <span className="run-board-badge run-board-badge-empty" title={t("flowTab.noAffectedPaths")}>—</span>}
        </div>
        <div className="run-board-cell" title={t("flowTab.progressNotTracked")}>—</div>
        <div className="run-board-cell" title={node.blockReason || t("flowTab.noBlockers")}>
          {node.blockReason ? t("flowTab.blocked") : "—"}
        </div>
        <div className="run-board-cell" title={t("flowTab.collisions2", { value: node.collisions.join(", ") || "none" })}>
          {node.collisions.length}
        </div>
        <div className="run-board-cell" title={t("flowTab.mergeReadiness", { readiness: node.readiness })}>
          {node.readiness}
        </div>
        <div className="run-board-cell run-board-cell-actions">
          {!run ? (
            <span className="text-muted" title={t("flowTab.noPlanRunExistsYet")}>{t("flowTab.notStarted")}</span>
          ) : run.status === "pending" || run.status === "running" ? (
            <button
              className="btn btn-sm"
              type="button"
              title={run.chatSessionId ? t("flowTab.openThisRunSRetained") : t("flowTab.cannotOpenThisRunHas")}
              disabled={!run.chatSessionId}
              onClick={() => onOpenChatSession(run.chatSessionId!)}
            >
              <Play size={10} /> {t("flowTab.open")}
            </button>
          ) : run.status === "awaiting_review" ? (
            <>
              <button className="btn btn-sm" type="button" title={resumeBlockedReason ?? t("flowTab.resumeThisPlanInIts")} disabled={resumeBlockedReason !== null} onClick={() => run && void handleResumePlanRun(run)}>
                <Play size={10} /> {t("flowTab.resume")}
              </button>
              <button className="btn btn-sm" type="button" title={t("flowTab.reviewTheLinkedOpenspecTasks")} onClick={() => setTab("changes")}>
                <ClipboardCheck size={10} /> {t("flowTab.review")}
              </button>
            </>
          ) : run.status === "failed" || run.status === "cancelled" ? (
            <button className="btn btn-sm" type="button" title={resumeBlockedReason ?? t("flowTab.retryThisPlanInIts")} disabled={resumeBlockedReason !== null} onClick={() => run && void handleResumePlanRun(run)}>
              <RotateCcw size={10} /> {t("flowTab.retry")}
            </button>
          ) : (
            <button className="btn btn-sm" type="button" title={archiveBlockedReason ?? t("flowTab.openTheLinkedCompletedChange")} disabled={archiveBlockedReason !== null} onClick={() => setTab("changes")}>
              <Archive size={10} /> {t("flowTab.archive")}
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
          <div className="run-board-empty" title={t("flowTab.noSessionSelected")}>{t("flowTab.noSessionSelected")}</div>
        </div>
      );
    }
    if (runBoardLoading) {
      return (
        <div className="run-board">
          <div className="run-board-empty" title={t("flowTab.loadingDependencyGraph")}>{t("flowTab.loadingRunBoard")}</div>
        </div>
      );
    }
    if (!dependencyGraph?.nodes.length) {
      return (
        <div className="run-board">
          <div className="run-board-empty" title={t("flowTab.noDependencyGraphNodesAvailable")}>{t("flowTab.noRunBoardEntries")}</div>
        </div>
      );
    }
    return (
      <div className="run-board" title={t("flowTab.dependencyGraphForSession", { value: sessionId.slice(0, 8) })}>
        <div className="run-board-header">
          <span className="run-board-header-title">{t("flowTab.runBoard")}</span>
          <span className="text-muted text-sm" title={t("flowTab.nodeS2", { nodesCount: dependencyGraph.nodes.length })}>
            {t("flowTab.nodeS", { nodesCount: dependencyGraph.nodes.length })}
          </span>
        </div>
        <div className="run-board-row run-board-row-header" title={t("flowTab.runBoardColumnHeaders")}>
          <div className="run-board-cell">{t("flowTab.plan")}</div>
          <div className="run-board-cell">{t("flowTab.prio")}</div>
          <div className="run-board-cell">{t("flowTab.prereqs")}</div>
          <div className="run-board-cell">{t("flowTab.chat")}</div>
          <div className="run-board-cell">{t("flowTab.engineProviderModel")}</div>
          <div className="run-board-cell">{t("flowTab.branch")}</div>
          <div className="run-board-cell">{t("flowTab.claims")}</div>
          <div className="run-board-cell">%</div>
          <div className="run-board-cell">{t("flowTab.blockers")}</div>
          <div className="run-board-cell">{t("flowTab.collisions")}</div>
          <div className="run-board-cell">{t("flowTab.readiness")}</div>
          <div className="run-board-cell">{t("flowTab.next")}</div>
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
          <div className="run-board-empty" title={t("flowTab.loadingMergeReviewQueue")}>{t("flowTab.loadingMergeQueue")}</div>
        </div>
      );
    }
    if (mergeQueue.length === 0) {
      return (
        <div className="merge-queue">
          <div className="run-board-empty" title={t("flowTab.noMergeReviewEntries")}>{t("flowTab.noMergeReviewEntries")}</div>
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
          <span className="run-board-header-title">{t("flowTab.mergeReview")}</span>
          <span className="text-muted text-sm" title={t("flowTab.entryIes2", { mergeQueueCount: mergeQueue.length })}>
            {t("flowTab.entryIes", { mergeQueueCount: mergeQueue.length })}
          </span>
        </div>
        {mergeSession.active ? (
          <div className="merge-session-active" title={t("flowTab.reviewSessionInProgress")}>
            <span className="merge-session-label">
              {mergeSession.results.length + 1}/{mergeSession.total}
            </span>
            <div className="merge-session-actions">
              <button className="btn btn-sm btn-primary" type="button" title={t("flowTab.mergeThisEntry")} onClick={() => void handleSessionAction("merged")}>{t("flowTab.merge")}</button>
              <button className="btn btn-sm" type="button" title={t("flowTab.skipThisEntry")} onClick={() => void handleSessionAction("skipped")}>{t("flowTab.skip")}</button>
              <button className="btn btn-sm" type="button" title={t("flowTab.stopTheReviewSession")} onClick={() => void handleSessionAction("stop")}>{t("flowTab.stop")}</button>
            </div>
          </div>
        ) : null}
        {showSummary ? (
          <div className="merge-session-summary" title={t("flowTab.sessionSummary")}>
            <span className="merge-session-summary-title">{t("flowTab.sessionSummary")}</span>
            <span className="merge-session-summary-row">{t("flowTab.merged", { mergedCount: mergedCount })}</span>
            <span className="merge-session-summary-row">{t("flowTab.skipped", { skippedCount: skippedCount })}</span>
            {conflictedCount > 0 ? <span className="merge-session-summary-row merge-session-conflict">{t("flowTab.conflicted", { conflictedCount: conflictedCount })}</span> : null}
            {mergedCount > 0 ? (
              <button className="btn btn-sm" type="button" title={t("flowTab.cleanUpMergedEntriesFrom")} onClick={handleCleanupMerged}>{t("flowTab.cleanUpMerged")}</button>
            ) : null}
          </div>
        ) : null}
        {!mergeSession.active ? (
          <div className="merge-queue-batch-actions">
            <label className="merge-queue-select-all" title={t("flowTab.selectAllPendingEntries")}>
              <input type="checkbox" checked={allSelected} onChange={handleToggleAll} title={t("flowTab.selectAll")} />
              <span>{t("flowTab.selectAll")}</span>
            </label>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title={t("flowTab.startAGuidedReviewSession")}
              disabled={mergeSelected.size === 0}
              onClick={handleStartSession}
            >
              {t("flowTab.reviewMerge", { size: mergeSelected.size })}
            </button>
          </div>
        ) : null}
        {[...ordered, ...reviewedEntries].map((entry) => {
          const plan = plans.find((p) => p.id === entry.planId);
          const title = plan?.title ?? t("flowTab.plan22", { v1: entry.planId.slice(0, 8) });
          const isSelected = mergeSelected.has(entry.id);
          const isCurrent = mergeSession.currentEntryId === entry.id;
          const sessionResult = mergeSession.results.find((r) => r.entryId === entry.id);
          const tooltip = [
            t("flowTab.plan3", { title }),
            t("flowTab.status2", { status: entry.status }),
            t("flowTab.tooltipCollisionReview", { value: entry.collisionReviewRequired ? t("flowTab.yes") : t("flowTab.no") }),
            t("flowTab.tooltipOverlappingPlans", { value: entry.overlappingPlans.join(", ") || t("flowTab.none") }),
            t("flowTab.created", { v1: formatDateTime(new Date(entry.createdAt)) }),
            entry.reviewedAt ? t("flowTab.reviewed", { v1: formatDateTime(new Date(entry.reviewedAt)) }) : null,
            sessionResult ? t("flowTab.session", { action: sessionResult.action }) : null,
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
                    title={t("flowTab.select", { title: title })}
                  />
                ) : null}
                <span className="merge-queue-entry-title" title={title}>{title}</span>
                <span className="merge-queue-entry-status" title={t("flowTab.status", { status: entry.status })}>{entry.status}</span>
                {sessionResult ? (
                  <span className="merge-queue-entry-session-result" title={t("flowTab.sessionResult", { action: sessionResult.action })}>
                    {sessionResult.action}
                  </span>
                ) : null}
              </div>
              {!mergeSession.active ? (
                <div className="merge-queue-entry-actions">
                  <button className="btn btn-sm" type="button" title={t("flowTab.approveMergeEntry", { value: entry.id.slice(0, 8) })} onClick={() => void handleReviewMergeEntry(entry.id, "approved")}>{t("flowTab.approve")}</button>
                  <button className="btn btn-sm" type="button" title={t("flowTab.rejectMergeEntry", { value: entry.id.slice(0, 8) })} onClick={() => void handleReviewMergeEntry(entry.id, "rejected")}>{t("flowTab.reject")}</button>
                  <button className="btn btn-sm btn-primary" type="button" title={t("flowTab.mergeEntry", { value: entry.id.slice(0, 8) })} onClick={() => void handleReviewMergeEntry(entry.id, "merged")}>{t("flowTab.merge")}</button>
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
      <div className="launch-profile-form" title={t("flowTab.configureHowReadyPlansAre")}>
        <Disclosure
          label={t("flowTab.launchProfile")}
          summary={t("flowTab.launchSummaryLine", { workers: launchForm.workerCount === 1 ? t("flowTab.workerCountOne") : t("flowTab.workerCountOther", { count: launchForm.workerCount }), workspace: launchForm.workspacePolicy.replace(/_/g, " "), scheduling: launchForm.schedulingMode, finish: finishPolicyLabels()[launchForm.finishPolicy] })}
          title={t("flowTab.workersWorkspaceSchedulingEngineAnd")}
        >
        <div className="launch-profile-row">
          <label className="launch-profile-field" title={t("flowTab.numberOfWorkersThatMay")}>
            <span>{t("flowTab.workers")}</span>
            <input
              type="number"
              min={1}
              max={8}
              value={launchForm.workerCount}
              onChange={(e) => {
                const value = Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 8);
                setLaunchForm((prev) => ({ ...prev, workerCount: value }));
              }}
              title={t("flowTab.workerCount")}
            />
          </label>
          <label className="launch-profile-field" title={t("flowTab.effectiveConcurrentProviderCallCap")}>
            <span>{t("flowTab.providerCap")}</span>
            <span className="launch-profile-summary">{launchForm.workerCount}</span>
          </label>
          <label className="launch-profile-field" title={t("flowTab.workspaceIsolationPolicyForLaunched")}>
            <span>{t("flowTab.workspace")}</span>
            <OptionList
              value={launchForm.workspacePolicy}
              options={WORKSPACE_OPTION_ITEMS()}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, workspacePolicy: id }))}
              label={t("flowTab.workspacePolicy")}
            />
          </label>
          <label className="launch-profile-field" title={t("flowTab.schedulingSafetyMode")}>
            <span>{t("flowTab.scheduling")}</span>
            <OptionList
              value={launchForm.schedulingMode}
              options={SCHEDULING_OPTION_ITEMS()}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, schedulingMode: id }))}
              label={t("flowTab.schedulingMode")}
            />
          </label>
          <label className="launch-profile-field" title={t("flowTab.executionEngineForLaunchedPlans")}>
            <span>{t("flowTab.engine")}</span>
            <OptionList
              value={launchForm.engine}
              options={ENGINE_OPTION_ITEMS()}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, engine: id }))}
              label={t("flowTab.engineKind")}
            />
          </label>
          <label className="launch-profile-field" title={t("flowTab.whatHappensWhenAPlan")}>
            <span>{t("flowTab.onFinish")}</span>
            <OptionList
              value={launchForm.finishPolicy}
              options={FINISH_OPTION_ITEMS()}
              onChange={(id) => setLaunchForm((prev) => ({ ...prev, finishPolicy: id }))}
              label={t("flowTab.finishPolicy")}
            />
          </label>
        </div>
        <div className="launch-profile-confirm-actions">
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title={t("flowTab.saveLaunchProfileForThis")}
            onClick={() => void handleSaveLaunchProfile()}
            disabled={launchSaving || !projectPath}
          >
            {launchSaving ? t("flowTab.saving") : t("flowTab.saveLaunchProfile")}
          </button>
        </div>
        </Disclosure>
      </div>
      {/* Schematic stage */}
      <div className="flow-stage" title={t("flowTab.projectSchematicTheSteeringDocument")}>
        <div className="flow-stage-header">
          <span className="flow-stage-name">{t("flowTab.schematic")}</span>
          <span className={`flow-stage-count flow-count-${schematicReport ? (schematicReport.health === "complete" ? "ok" : "warn") : "empty"}`}>
            {schematicReport ? (schematicReport.health === "complete" ? "✓" : "!") : "0"}
          </span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {schematicReport ? t("flowTab.sections", { valueCount: schematicReport.sections.filter((s) => s.state === "filled").length, sectionsCount: schematicReport.sections.length }) : t("flowTab.noSchematic")}
        </span>
      </div>

      {/* Ideas stage */}
      <div className="flow-stage" title={t("flowTab.generatedIdeasAcrossAllCategories")}>
        <div className="flow-stage-header">
          <span className="flow-stage-name">{t("flowTab.ideas")}</span>
          <span className="flow-stage-count">{ideaState.ideas.length}</span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {t("flowTab.conceptPicked", { conceptCount: ideaState.ideas.filter((i) => i.status === "concept").length, pickedCount: ideaState.ideas.filter((i) => i.status === "picked").length })}
        </span>
      </div>

      {/* Plans stage */}
      <div className="flow-stage" title={t("flowTab.plansPromotedFromIdeas")}>
        <div className="flow-stage-header">
          <span className="flow-stage-name">{t("flowTab.plans")}</span>
          <span className="flow-stage-count">{plans.length}</span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {t("flowTab.draftReady", { draftCount: plans.filter((p) => p.status === "draft" || p.status === "openspec").length, readyCount: plans.filter((p) => p.status === "ready").length })}
        </span>
        {plans.filter((p) => p.status === "ready").length > 0 ? (
          launchConfirmOpen && launchSummary ? (
            <div className="launch-profile-confirm" title={t("flowTab.reviewLaunchSummaryBeforeDispatching")}>
              <span className="launch-profile-confirm-title">{t("flowTab.launchSummary")}</span>
              <ul className="launch-profile-confirm-list">
                <li><span className="label">{t("flowTab.workers")}</span><span className="value">{launchSummary.workerCount}</span></li>
                <li><span className="label">{t("flowTab.providerCap")}</span><span className="value">{launchSummary.providerCap}</span></li>
                <li><span className="label">{t("flowTab.startQueue")}</span><span className="value">{launchSummary.startCount} / {launchSummary.queueCount}</span></li>
                <li><span className="label">{t("flowTab.worktrees")}</span><span className="value">{launchSummary.worktrees}</span></li>
                <li><span className="label">{t("flowTab.branches")}</span><span className="value">{launchSummary.branches}</span></li>
                <li><span className="label">{t("flowTab.prerequisites")}</span><span className="value">{launchSummary.prerequisites}</span></li>
                <li><span className="label">{t("flowTab.collisions")}</span><span className="value">{launchSummary.collisions}</span></li>
                <li><span className="label">{t("flowTab.policy")}</span><span className="value">{launchSummary.policy}</span></li>
                <li><span className="label">{t("flowTab.scheduling")}</span><span className="value">{launchSummary.schedulingMode}</span></li>
                <li><span className="label">{t("flowTab.onFinish")}</span><span className="value">{finishPolicyLabels()[launchSummary.finishPolicy]}</span></li>
              </ul>
              <div className="launch-profile-confirm-actions">
                <button
                  className="btn btn-sm"
                  type="button"
                  title={t("flowTab.cancelLaunch")}
                  onClick={() => setLaunchConfirmOpen(false)}
                >
                  {t("flowTab.cancel")}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title={t("flowTab.launchTitle", { count: launchSummary.startCount + launchSummary.queueCount })}
                  onClick={() => void handleLaunchConfirm()}
                >
                  {t("flowTab.confirmLaunch")}
                </button>
              </div>
            </div>
          ) : runtimeReady ? (
            <button
              className="btn btn-sm btn-primary flow-stage-action"
              type="button"
              title={t("flowTab.launchReviewTitle", { count: plans.filter((p) => p.status === "ready").length })}
              onClick={() => void handleLaunchClick()}
            >
              {t("flowTab.launchReady", { count: plans.filter((p) => p.status === "ready").length })}
            </button>
          ) : (
            <div className="flow-runtime-blocked" title={t("flowTab.openSpecRuntimeNotConfigured")}>
              <span className="text-sm text-muted">
                {t("flowTab.openSpecRuntimeState", { state: runtimeState ?? t("flowTab.missing") })}
              </span>
            </div>
          )
        ) : null}
      </div>

      {/* Running stage */}
      <div className="flow-stage" title={t("flowTab.plansCurrentlyRunningInWorktrees")}>
        <div className="flow-stage-header">
          <span className="flow-stage-name">{t("flowTab.running")}</span>
          <span className={`flow-stage-count flow-count-${planRuns.some((r) => r.status === "running") ? "active" : "empty"}`}>
            {planRuns.filter((r) => r.status === "running").length}
          </span>
        </div>
        <span className="flow-stage-detail text-muted text-sm">
          {t(planRuns.filter((r) => r.status === "running").length === 1 ? "flowTab.activeRunOne" : "flowTab.activeRunMany", { count: planRuns.filter((r) => r.status === "running").length })}
        </span>
      </div>

      {/* Finished stage */}
      <div className="flow-stage" title={t("flowTab.finishedAndCancelledPlans")}>
        <div className="flow-stage-header">
          <span className="flow-stage-name">{t("flowTab.finished")}</span>
          <span className="flow-stage-count flow-count-ok">{plans.filter((p) => p.status === "finished").length}</span>
        </div>

        <span className="flow-stage-detail text-muted text-sm">
          {t("flowTab.doneCancelled", { doneCount: plans.filter((p) => p.status === "finished").length, cancelledCount: plans.filter((p) => p.status === "cancelled").length })}
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

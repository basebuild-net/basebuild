import { useCallback, useEffect, useState } from "react";
import { FolderTree, LayoutGrid, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { Plan, PlanStatus } from "../../lib/plans";
import { isTerminalStatus } from "../../lib/plans";
import { batchPromoteIdeas } from "../../lib/plans";
import { enqueuePlan, listPlanRuns, markPlanRunComplete, startQueue, applyFinishPolicy } from "../../lib/planRuns";
import { useOpenSpecRuntime } from "../../state/useOpenSpecRuntime";
import { PlanPanel } from "./PlanPanel";
import { PlanningCommandCenter } from "./PlanningCommandCenter";
import { IntegrationQueue } from "../panels/IntegrationQueue";
import { ChangesPanel } from "../panels/ChangesPanel";
import { CompletionCard } from "../panels/CompletionCard";
import { IdeaRoundsSection } from "./IdeaRoundsSection";
import { MissionControlBoard } from "./MissionControlBoard";
import type { PlanRun, FinishOutcome } from "../../lib/planRuns";
import { useIdeaState } from "../../state/ideas";
import type { IdeaCategory, IdeaStatus } from "../../lib/ideas";
import { useProjectSchematic } from "../../state/schematic";
import { useLogs } from "../../state/log";
import { subscribeGrounding, getLastGrounding } from "../../state/grounding";
import type { GroundingMetadata } from "../../lib/native-chat";
import {
  getLaunchProfile,
  setLaunchProfile as saveLaunchProfile,
  getDependencyGraph,
  listMergeQueue,
  reviewMergeEntry,
  type LaunchProfile,
  type DependencyGraph,
  type DependencyNode,
  type MergeReviewEntry,
  type EngineKind,
  type WorkspacePolicy,
  type SchedulingMode,
  type FinishPolicy,
} from "../../lib/planDependencies";

export type PlanningTab = "plans" | "ideas" | "categories" | "flow" | "runs" | "changes";

const FINISH_POLICIES: readonly FinishPolicy[] = ["hold", "auto_commit", "auto_commit_pr", "queue_merge_review"];
function normalizeFinishPolicy(value: string | undefined): FinishPolicy {
  return FINISH_POLICIES.find((p) => p === value) ?? "hold";
}
const FINISH_POLICY_LABELS: Record<FinishPolicy, string> = {
  hold: "Hold for review",
  auto_commit: "Auto-commit",
  auto_commit_pr: "Auto-commit + PR",
  queue_merge_review: "Queue merge review",
};

type PlanningInspectorProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;

  onEditPlan: (plan: Plan) => void;
  onFocusPlan: (plan: Plan) => void;
  onSetPlanStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onOpenChatSession: (chatSessionId: string) => void;
  onPromoteIdea?: (title: string, description: string, chatSessionId: string | null) => Promise<void> | void;
  onSuggestForCategory?: (category: IdeaCategory | null) => void;
  onGenerateFromFinishedPlans?: () => void;
  onStartIdeaRound?: () => void;
  onGenerateCategories?: () => void;
  /** Open grid panels (panel id ↔ chat session id) for mission control. */
  chatPanels?: { panelId: string; chatSessionId: string | null }[];
  activeChatSessionId?: string | null;
  showHeader?: boolean;
  hostContext?: "dock" | "modal";
  onAssignPlan?: (plan: Plan, profile: LaunchProfile) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
  initialTab?: PlanningTab;
};

const STATUS_FILTERS: { value: IdeaStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "concept", label: "Concept" },
  { value: "picked", label: "Picked" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];
export function PlanningInspector({
  sessionId,
  projectPath,
  plans,
  loading,
  collapsed,
  onToggleCollapse,

  onEditPlan,
  onFocusPlan,
  onSetPlanStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onOpenChatSession,
  onPromoteIdea,
  onSuggestForCategory,
  onGenerateFromFinishedPlans,
  onStartIdeaRound,
  onGenerateCategories,
  chatPanels,
  activeChatSessionId,
  showHeader = true,
  hostContext = "dock",
  onAssignPlan,
  onShowToast,
  initialTab = "plans",
}: PlanningInspectorProps) {
  const runtime = useOpenSpecRuntime(projectPath);
  const runtimeReady = runtime.status?.state === "ready";
  const [tab, setTab] = useState<PlanningTab>(initialTab);
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<IdeaCategory | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDesc, setNewCategoryDesc] = useState("");
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(new Set());
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [planRuns, setPlanRuns] = useState<PlanRun[]>([]);
  const [completionDismissed, setCompletionDismissed] = useState<Set<string>>(new Set());
  const [finishOutcomes, setFinishOutcomes] = useState<Map<string, FinishOutcome>>(new Map());
  const [grounding, setGrounding] = useState<GroundingMetadata | null>(getLastGrounding());
  useEffect(() => {
    return subscribeGrounding(setGrounding);
  }, []);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [launchProfile, setLaunchProfile] = useState<LaunchProfile | null>(null);
  const [launchForm, setLaunchForm] = useState<{
    workerCount: number;
    workspacePolicy: WorkspacePolicy;
    schedulingMode: SchedulingMode;
    engine: EngineKind;
    finishPolicy: FinishPolicy;
  }>({
    workerCount: 2,
    workspacePolicy: "isolated_worktrees",
    schedulingMode: "safe",
    engine: "openspec",
    finishPolicy: "hold",
  });
  const [launchConfirmOpen, setLaunchConfirmOpen] = useState(false);
  const [launchSummary, setLaunchSummary] = useState<{
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
  } | null>(null);
  const [launchSaving, setLaunchSaving] = useState(false);
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null);
  const [mergeQueue, setMergeQueue] = useState<MergeReviewEntry[]>([]);
  const [runBoardLoading, setRunBoardLoading] = useState(false);
  const [mergeQueueLoading, setMergeQueueLoading] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeSession, setMergeSession] = useState<{
    active: boolean;
    currentEntryId: string | null;
    total: number;
    results: { entryId: string; action: "merged" | "skipped" | "conflicted"; detail?: string }[];
  }>({ active: false, currentEntryId: null, total: 0, results: [] });
  const ideaState = useIdeaState(sessionId);
  const schematic = useProjectSchematic(projectPath);
  const { addLog } = useLogs();
  // Categories tab: no auto-seeding (schematic-grounded-planning). The empty
  // state offers "Generate categories from project" and manual add.
  useEffect(() => {
    if (tab === "categories" && sessionId) {
      void ideaState.refresh();
    }
  }, [tab, sessionId, ideaState.refresh]);

  // Fetch plan runs for completion cards.
  useEffect(() => {
    if (!sessionId) {
      setPlanRuns([]);
      return;
    }
    void listPlanRuns(sessionId)
      .then(setPlanRuns)
      .catch(() => setPlanRuns([]));
  }, [sessionId, plans]);
  // Fetch finish-policy outcomes for succeeded runs (for completion cards).
  useEffect(() => {
    const succeeded = planRuns.filter((r) => r.status === "succeeded");
    if (succeeded.length === 0) return;
    const missing = succeeded.filter((r) => !finishOutcomes.has(r.id));
    if (missing.length === 0) return;
    void (async () => {
      const newOutcomes = new Map(finishOutcomes);
      for (const run of missing) {
        try {
          const result = await applyFinishPolicy(run.id);
          if (result.kind === "applied") {
            newOutcomes.set(run.id, result.outcome);
          }
        } catch {
          // ignore — outcome not available
        }
      }
      setFinishOutcomes(newOutcomes);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRuns]);
  // Load dependency graph for the run board.
  useEffect(() => {
    if (!sessionId) {
      setDependencyGraph(null);
      return;
    }
    setRunBoardLoading(true);
    void getDependencyGraph(sessionId)
      .then(setDependencyGraph)
      .catch((e) => {
        addLog("error", "Failed to load dependency graph", e instanceof Error ? e.message : String(e));
        setDependencyGraph(null);
      })
      .finally(() => setRunBoardLoading(false));
  }, [sessionId, addLog, plans]);
  // Load merge-review queue for finished worktree runs.
  useEffect(() => {
    if (!sessionId) {
      setMergeQueue([]);
      return;
    }
    setMergeQueueLoading(true);
    void listMergeQueue(sessionId)
      .then(setMergeQueue)
      .catch((e) => {
        addLog("error", "Failed to load merge queue", e instanceof Error ? e.message : String(e));
        setMergeQueue([]);
      })
      .finally(() => setMergeQueueLoading(false));
  }, [sessionId, addLog, plans]);
  // Load saved launch profile for this project.
  useEffect(() => {
    if (!projectPath) {
      setLaunchProfile(null);
      return;
    }
    void getLaunchProfile(projectPath)
      .then((profile) => {
        setLaunchProfile(profile);
        if (profile) {
          setLaunchForm({
            workerCount: Math.min(Math.max(profile.workerCount, 1), 8),
            workspacePolicy: profile.workspacePolicy === "sequential_primary" ? "sequential_primary" : "isolated_worktrees",
            schedulingMode: profile.schedulingMode === "yolo" ? "yolo" : "safe",
            engine: profile.engine === "native" ? "native" : "openspec",
            finishPolicy: normalizeFinishPolicy(profile.finishPolicy),
          });
        }
      })
      .catch(() => setLaunchProfile(null));
  }, [projectPath]);
  // Close launch confirmation when the plan list changes so the summary stays in sync.
  useEffect(() => {
    setLaunchConfirmOpen(false);
  }, [plans]);

  const handlePromoteIdea = useCallback(
    async (idea: { id: string; title: string; description: string }) => {
      try {
        await onPromoteIdea?.(idea.title, idea.description, activeChatSessionId ?? null);
        await ideaState.updateIdeaStatus(idea.id, "picked");
      } catch (e) {
        addLog("error", "Failed to promote idea", e instanceof Error ? e.message : String(e));
      }
    },
    [onPromoteIdea, ideaState, addLog, activeChatSessionId],
  );

  const handleBatchPromote = useCallback(async () => {
    if (!sessionId || selectedIdeaIds.size === 0) return;
    setBatchResult(null);
    try {
      const ideaIds = Array.from(selectedIdeaIds);
      const result = await batchPromoteIdeas(sessionId, ideaIds);
      const createdCount = result.created.length;
      const errorCount = result.errors.length;
      if (errorCount > 0) {
        setBatchResult(`Promoted ${createdCount} plan(s); ${errorCount} failed.`);
        addLog("warn", "Batch promote partial failure", `${createdCount} ok, ${errorCount} failed`);
      } else {
        setBatchResult(`Promoted ${createdCount} plan(s).`);
      }
      // Mark successfully promoted ideas as picked so counts refresh.
      const pickedIds = new Set(result.created.map((p) => p.ideaId).filter((id): id is string => !!id));
      await Promise.all(
        Array.from(pickedIds).map((id) => ideaState.updateIdeaStatus(id, "picked")),
      );
      setSelectedIdeaIds(new Set());
      void ideaState.refresh();
    } catch (e) {
      addLog("error", "Batch promote failed", e instanceof Error ? e.message : String(e));
      setBatchResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, selectedIdeaIds, ideaState, addLog]);

  const handleRejectSelected = useCallback(async () => {
    if (selectedIdeaIds.size === 0) return;
    const ids = Array.from(selectedIdeaIds);
    await Promise.all(ids.map((id) => ideaState.rejectIdea(id)));
    setSelectedIdeaIds(new Set());
    void ideaState.refresh();
  }, [selectedIdeaIds, ideaState]);
  const handleCreateCategory = useCallback(() => {
    if (!sessionId || !newCategoryName.trim()) return;
    void (async () => {
      await ideaState.createCategory(newCategoryName.trim(), newCategoryDesc.trim());
      setNewCategoryName("");
      setNewCategoryDesc("");
    })();
  }, [sessionId, newCategoryName, newCategoryDesc, ideaState]);
  const handleSaveLaunchProfile = useCallback(async () => {
    if (!projectPath) return;
    setLaunchSaving(true);
    try {
      const profile: LaunchProfile = {
        projectPath,
        engine: launchForm.engine,
        providerId: launchProfile?.providerId ?? "",
        modelId: launchProfile?.modelId ?? "",
        workerCount: launchForm.workerCount,
        workspacePolicy: launchForm.workspacePolicy,
        schedulingMode: launchForm.schedulingMode,
        finishPolicy: launchForm.finishPolicy,
        updatedAt: Date.now(),
      };
      await saveLaunchProfile(profile);
      setLaunchProfile(profile);
    } catch (e) {
      addLog("error", "Failed to save launch profile", e instanceof Error ? e.message : String(e));
    } finally {
      setLaunchSaving(false);
    }
  }, [projectPath, launchForm, launchProfile, addLog]);

  const handleLaunchClick = useCallback(async () => {
    const readyPlans = plans.filter((p) => p.status === "ready");
    let graphData: DependencyGraph | null = null;
    if (sessionId) {
      try {
        graphData = await getDependencyGraph(sessionId);
      } catch (e) {
        addLog("warn", "Failed to load dependency graph for launch summary", e instanceof Error ? e.message : String(e));
      }
    }
    const readyIds = new Set(readyPlans.map((p) => p.id));
    const readyNodes = graphData?.nodes.filter((n) => readyIds.has(n.planId)) ?? [];
    const startCount = Math.min(launchForm.workerCount, readyPlans.length);
    const queueCount = Math.max(0, readyPlans.length - launchForm.workerCount);
    const worktrees = launchForm.workspacePolicy === "isolated_worktrees" ? startCount : 0;
    const branches = launchForm.workspacePolicy === "isolated_worktrees" ? startCount : 1;
    const prerequisites = readyNodes.reduce((sum, n) => sum + n.prerequisites.length, 0);
    const collisions = readyNodes.reduce((sum, n) => sum + n.collisions.length, 0);
    setLaunchSummary({
      workerCount: launchForm.workerCount,
      providerCap: launchForm.workerCount,
      startCount,
      queueCount,
      worktrees,
      branches,
      prerequisites,
      collisions,
      policy: launchForm.workspacePolicy,
      schedulingMode: launchForm.schedulingMode,
      finishPolicy: launchForm.finishPolicy,
    });
    setLaunchConfirmOpen(true);
  }, [plans, sessionId, launchForm, addLog]);

  const handleLaunchConfirm = useCallback(async () => {
    setLaunchConfirmOpen(false);
    const readyPlans = plans.filter((p) => p.status === "ready");
    if (!sessionId) return;
    for (const plan of readyPlans) {
      try {
        await enqueuePlan({ sessionId, planId: plan.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", `Failed to enqueue plan ${plan.referenceId}`, msg);
      }
    }
    try {
      await startQueue({
        sessionId,
        profile: {
          concurrency: launchForm.workerCount,
          providerId: launchProfile?.providerId ?? "",
          modelId: launchProfile?.modelId ?? "",
          effortLevel: launchProfile?.effortLevel,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to start plan queue", msg);
    }
  }, [plans, sessionId, launchForm, launchProfile, addLog]);

  const handleReviewMergeEntry = useCallback(
    async (entryId: string, decision: "approved" | "rejected" | "merged") => {
      try {
        const updated = await reviewMergeEntry(entryId, decision);
        setMergeQueue((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
        onShowToast?.(
          `Merge ${decision}`,
          `Entry ${updated.planId.slice(0, 8)} reviewed as ${decision}`,
          "success",
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to review merge entry", msg);
        onShowToast?.("Review failed", msg, "error");
      }
    },
    [addLog, onShowToast],
  );

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
  const filteredIdeas = statusFilter === "all"
    ? ideaState.ideas
    : ideaState.ideas.filter((i) => i.status === statusFilter);

  const categoryIdeas = selectedCategory
    ? ideaState.ideas.filter((i) => i.categoryId === selectedCategory.id)
    : [];

  if (collapsed) {
    return (
      <div className="side-section planning-inspector" data-collapsed="true">
        <button
          className="btn-icon side-section-action"
          title="Expand planning inspector"
          type="button"
          onClick={onToggleCollapse}
        >
          <LayoutGrid size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className={`side-section planning-inspector${hostContext === "modal" ? " planning-inspector-modal" : ""}`}>
      <div className="side-section-header">
        {showHeader ? (
          <>
            <span className="side-section-title">Planning</span>
            {schematic.report && schematic.report.health !== "complete" && (
              <span
                className={`schematic-health-badge is-${schematic.report.health}`}
                title={`Schematic ${schematic.report.health}: ${schematic.report.sections
                  .filter((s) => s.state !== "filled")
                  .map((s) => s.name)
                  .join(", ")} — open the wizard to fix`}
              >
                {schematic.report.health}
              </span>
            )}
          </>
        ) : null}
        <div className="side-section-actions">
          <button
            className={`inspector-tab${tab === "plans" ? " is-active" : ""}`}
            type="button"
            title="Plans"
            onClick={() => setTab("plans")}
          >
            Plans
          </button>
          <button
            className={`inspector-tab${tab === "ideas" ? " is-active" : ""}`}
            type="button"
            title="Ideas history"
            onClick={() => setTab("ideas")}
          >
            Ideas
          </button>
          <button
            className={`inspector-tab${tab === "categories" ? " is-active" : ""}`}
            type="button"
            title="Categories"
            onClick={() => setTab("categories")}
          >
            Categories
          </button>
          <button
            className={`inspector-tab${tab === "flow" ? " is-active" : ""}`}
            type="button"
            title="Flow board — live stage counts across the planning pipeline"
            onClick={() => setTab("flow")}
          >
            Flow
          </button>
          <button
            className={`inspector-tab${tab === "runs" ? " is-active" : ""}`}
            type="button"
            title="Mission control — live run cards with progress and estimates"
            onClick={() => setTab("runs")}
          >
            Runs
          </button>
          <button
            className={`inspector-tab${tab === "changes" ? " is-active" : ""}`}
            type="button"
            title="OpenSpec change catalog — browse and toggle tasks"
            onClick={() => setTab("changes")}
          >
            Changes
          </button>
          {hostContext === "dock" ? (
            <button
              className="btn-icon btn-icon-sm"
              title="Collapse planning inspector"
              type="button"
              onClick={onToggleCollapse}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
      </div>

      {tab === "plans" ? (
        <PlanPanel
          sessionId={sessionId}
          projectPath={projectPath}
          plans={plans}
          loading={loading}
          collapsed={false}
          onToggleCollapse={() => setTab("ideas")}
          onEditPlan={onEditPlan}
          onFocusPlan={onFocusPlan}
          onSetPlanStatus={onSetPlanStatus}
          onDeletePlan={onDeletePlan}
          onCopyReference={onCopyReference}
          onOpenInTerminal={onOpenInTerminal}
          onOpenChatSession={onOpenChatSession}
          onAssignPlan={onAssignPlan}
          onShowToast={onShowToast}
        />
      ) : null}

      {tab === "ideas" ? (
        <div className="inspector-ideas stack">
          <div className="inspector-ideas-filter">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`inspector-filter-chip${statusFilter === f.value ? " is-active" : ""}`}
                type="button"
                title={`Filter: ${f.label}`}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {grounding ? (
            <div
              className="idea-batch-header"
              title={
                grounding.finishedPlans.length > 0
                  ? `Finished plans: ${grounding.finishedPlans.join(", ")}`
                  : "No finished plans since last schematic update"
              }
            >
              <span className="idea-batch-header-label">Grounded in:</span>
              {grounding.schematicSections.length > 0 ? (
                <span className="idea-batch-header-sections">
                  {grounding.schematicSections.join(" · ")}
                </span>
              ) : (
                <span className="idea-batch-header-sections text-muted">no schematic sections</span>
              )}
              <span className="idea-batch-header-counts">
                {grounding.finishedPlanCount > 0
                  ? ` · ${grounding.finishedPlanCount} finished plan${grounding.finishedPlanCount > 1 ? "s" : ""}`
                  : " · no finished plans"}
                {grounding.pickedCount > 0 ? ` · ${grounding.pickedCount} picked` : ""}
                {grounding.rejectedCount > 0 ? ` · ${grounding.rejectedCount} rejected` : ""}
              </span>
              {grounding.digestEmpty ? (
                <span className="idea-batch-header-empty text-muted">
                  {" "}— no decisions since schematic update
                </span>
              ) : null}
            </div>
          ) : null}
          {onGenerateFromFinishedPlans ? (
            <button
              className="btn btn-sm"
              type="button"
              disabled={!grounding || grounding.finishedPlanCount === 0}
              title={
                grounding && grounding.finishedPlanCount > 0
                  ? `Generate ideas weighted by ${grounding.finishedPlanCount} finished plan${grounding.finishedPlanCount > 1 ? "s" : ""} since last schematic update`
                  : "No finished plans since last schematic update — generate ideas freely instead"
              }
              onClick={() => onGenerateFromFinishedPlans()}
            >
              <Sparkles size={11} /> Generate from finished plans
            </button>
          ) : null}
          {selectedIdeaIds.size > 0 ? (
            <div className="inspector-batch-bar" title="Batch actions for selected concept ideas">
              <span className="text-sm">{selectedIdeaIds.size} selected</span>
              <button
                className="btn btn-sm btn-primary"
                type="button"
                title="Promote selected ideas into plans"
                onClick={() => void handleBatchPromote()}
              >
                Approve selected
              </button>
              <button
                className="btn btn-sm"
                type="button"
                title="Reject all selected ideas"
                onClick={() => void handleRejectSelected()}
              >
                Reject all
              </button>
              <button
                className="btn btn-sm"
                type="button"
                title="Clear selection"
                onClick={() => setSelectedIdeaIds(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}
          {batchResult ? <p className="text-sm text-muted">{batchResult}</p> : null}
          <IdeaRoundsSection
            sessionId={sessionId}
            ideas={ideaState.ideas}
            onStartRound={() => onStartIdeaRound?.()}
            onDeployed={(createdCount, failed) => {
              void ideaState.refresh();
              setTab("plans");
              if (failed.length > 0) {
                onShowToast?.(
                  `${createdCount} plan(s) created, ${failed.length} failed`,
                  failed.map((f) => `${f.ideaId}: ${f.error}`).join("; "),
                  "warning",
                );
              } else {
                onShowToast?.(`${createdCount} plan(s) created`, "Run them through OpenSpec to reach ready, then launch into chats.", "success");
              }
            }}
            onShowToast={onShowToast}
          />
          <div className="inspector-ideas-list">
            {filteredIdeas.length === 0 ? (
              <div className="inspector-ideas-empty">
                <p className="text-muted text-sm">No ideas {statusFilter === "all" ? "yet" : `in ${statusFilter}`}.</p>
                {onStartIdeaRound && statusFilter === "all" ? (
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title="Generate ideas — one-click round grounded in the schematic, decision history, and preferences"
                    onClick={() => onStartIdeaRound()}
                  >
                    <Sparkles size={11} /> Generate ideas
                  </button>
                ) : null}
              </div>
            ) : null}
            {filteredIdeas.map((idea) => (
              <div key={idea.id} className={`chat-idea-card chat-idea-status-${idea.status}`}>
                <div className="chat-idea-card-top">
                  {idea.status === "concept" ? (
                    <input
                      type="checkbox"
                      className="idea-select-checkbox"
                      title="Select for batch promote"
                      checked={selectedIdeaIds.has(idea.id)}
                      onChange={(e) => {
                        setSelectedIdeaIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(idea.id);
                          else next.delete(idea.id);
                          return next;
                        });
                      }}
                    />
                  ) : null}
                  <span className="chat-idea-title">{idea.title}</span>
                  {idea.status === "concept" ? (
                    <div className="chat-idea-card-actions">
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Promote this idea into the plan pipeline"
                        onClick={() => void handlePromoteIdea(idea)}
                      >
                        Promote
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        title="Reject this idea"
                        onClick={() => void ideaState.rejectIdea(idea.id)}
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                      {idea.status === "picked" ? "Planned" : idea.status === "rejected" ? "Rejected" : idea.status}
                    </span>
                  )}
                </div>
                {idea.description ? <p className="chat-idea-desc">{idea.description}</p> : null}
                {idea.grounding ? (
                  <p className="idea-card-desc idea-grounding" title="Concrete evidence justifying this idea">
                    <strong>Grounding:</strong> {idea.grounding}
                  </p>
                ) : null}
                {idea.anchor ? (
                  <p className="idea-card-desc idea-anchor" title="Schematic element this idea serves">
                    <strong>Anchor:</strong> {idea.anchor}
                  </p>
                ) : (
                  <p className="idea-card-desc idea-outside-focus" title="No schematic anchor — outside current focus">
                    outside current focus
                  </p>
                )}
                <button
                  className="btn-icon btn-icon-sm"
                  title="Delete this idea"
                  type="button"
                  onClick={() => void ideaState.removeIdea(idea.id)}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "categories" ? (
        <div className="inspector-categories stack">
          {selectedCategory ? (
            <div className="inspector-category-detail stack">
              <button
                className="btn btn-sm"
                type="button"
                title="Back to categories"
                onClick={() => setSelectedCategory(null)}
              >
                ← Back
              </button>
              <div className="inspector-category-header">
                <span className="inspector-category-name">{selectedCategory.name}</span>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title={`Suggest more ideas for ${selectedCategory.name}`}
                  onClick={() => onSuggestForCategory?.(selectedCategory)}
                >
                  <Sparkles size={11} /> Suggest more ideas
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  title={`Regenerate ideas for ${selectedCategory.name}`}
                  onClick={() => onSuggestForCategory?.(selectedCategory)}
                >
                  <RefreshCw size={11} /> Regenerate
                </button>
              </div>
              {categoryIdeas.length === 0 ? (
                <p className="text-muted text-sm">No ideas in this category yet.</p>
              ) : (
                categoryIdeas.map((idea) => (
                  <div key={idea.id} className={`chat-idea-card chat-idea-status-${idea.status}`}>
                    <div className="chat-idea-card-top">
                      <span className="chat-idea-title">{idea.title}</span>
                      <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                        {idea.status === "picked" ? "Planned" : idea.status === "rejected" ? "Rejected" : idea.status}
                      </span>
                    </div>
                    {idea.description ? <p className="chat-idea-desc">{idea.description}</p> : null}
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="inspector-category-add stack">
                <input
                  className="input"
                  type="text"
                  placeholder="Category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <input
                  className="input"
                  type="text"
                  placeholder="Description (optional)"
                  value={newCategoryDesc}
                  onChange={(e) => setNewCategoryDesc(e.target.value)}
                />
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  title="Add a category manually"
                  onClick={handleCreateCategory}
                >
                  <Plus size={11} /> Add category
                </button>
              </div>
              {ideaState.categories.length === 0 ? (
                <div className="empty-state empty-state-compact">
                  <FolderTree size={24} />
                  <p className="text-muted text-sm">No categories yet.</p>
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title="Generate categories from the project schematic"
                    onClick={() => onGenerateCategories?.() ?? onSuggestForCategory?.(null)}
                  >
                    <Sparkles size={11} /> Generate categories from project
                  </button>
                </div>
              ) : (
                <div className="inspector-category-list">
                  {ideaState.categories.map((cat) => (
                    <button
                      key={cat.id}
                      className="inspector-category-card"
                      type="button"
                      title={`Open ${cat.name}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      <div className="inspector-category-card-top">
                        <span className="inspector-category-card-name">{cat.name}</span>
                        <span className="inspector-category-card-count">
                          {ideaState.ideas.filter((i) => i.categoryId === cat.id).length}
                        </span>
                      </div>
                      {cat.description ? <p className="inspector-category-card-desc text-muted text-sm">{cat.description}</p> : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {tab === "flow" ? (
        <div className="flow-board stack">
          {/* Visual command center — stage cards with counts and actions */}
          <PlanningCommandCenter
            ideas={ideaState.ideas.length}
            openspec={plans.filter((p) => p.status === "openspec").length}
            ready={plans.filter((p) => p.status === "ready").length}
            queued={planRuns.filter((r) => r.status === "pending").length}
            running={plans.filter((p) => p.status === "running").length}
            blocked={planRuns.filter((r) => r.status === "failed").length}
            review={planRuns.filter((r) => r.status === "awaiting_review").length}
            finished={plans.filter((p) => p.status === "finished").length}
            onGenerateIdeas={() => {
              if (onStartIdeaRound) onStartIdeaRound();
              else setTab("ideas");
            }}
            onRunThroughOpenSpec={() => { setTab("plans"); }}
            onAddWorker={() => { /* Future: create a new chat panel */ }}
            onReview={() => { /* Future: focus review queue */ }}
            onMerge={() => { /* Future: open merge queue */ }}
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
                <select
                  value={launchForm.workspacePolicy}
                  onChange={(e) => setLaunchForm((prev) => ({ ...prev, workspacePolicy: e.target.value as WorkspacePolicy }))}
                  title="Workspace policy"
                >
                  <option value="isolated_worktrees">Isolated worktrees</option>
                  <option value="sequential_primary">Sequential primary</option>
                </select>
              </label>
              <label className="launch-profile-field" title="Scheduling safety mode">
                <span>Scheduling</span>
                <select
                  value={launchForm.schedulingMode}
                  onChange={(e) => setLaunchForm((prev) => ({ ...prev, schedulingMode: e.target.value as SchedulingMode }))}
                  title="Scheduling mode"
                >
                  <option value="safe">Safe</option>
                  <option value="yolo">Yolo</option>
                </select>
              </label>
              <label className="launch-profile-field" title="Execution engine for launched plans">
                <span>Engine</span>
                <select
                  value={launchForm.engine}
                  onChange={(e) => setLaunchForm((prev) => ({ ...prev, engine: e.target.value as EngineKind }))}
                  title="Engine kind"
                >
                  <option value="openspec">OpenSpec</option>
                  <option value="native">Native</option>
                </select>
              </label>
              <label className="launch-profile-field" title="What happens when a plan run finishes — hold for manual review, auto-commit to the worktree, commit + push a PR, or queue for merge review">
                <span>On finish</span>
                <select
                  value={launchForm.finishPolicy}
                  onChange={(e) => setLaunchForm((prev) => ({ ...prev, finishPolicy: e.target.value as FinishPolicy }))}
                  title="Finish policy"
                >
                  <option value="hold">Hold for review</option>
                  <option value="auto_commit">Auto-commit</option>
                  <option value="auto_commit_pr">Auto-commit + PR</option>
                  <option value="queue_merge_review">Queue merge review</option>
                </select>
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
          </div>
          {/* Schematic stage */}
          <div className="flow-stage" title="Project schematic — the steering document">
            <div className="flow-stage-header">
              <span className="flow-stage-name">Schematic</span>
              <span className={`flow-stage-count flow-count-${schematic.report ? (schematic.report.health === "complete" ? "ok" : "warn") : "empty"}`}>
                {schematic.report ? (schematic.report.health === "complete" ? "✓" : "!") : "0"}
              </span>
            </div>
            <span className="flow-stage-detail text-muted text-sm">
              {schematic.report ? `${schematic.report.sections.filter((s) => s.state === "filled").length}/${schematic.report.sections.length} sections` : "No schematic"}
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
                    OpenSpec runtime {runtime.status?.state ?? "missing"}. Configure in Settings → OpenSpec.
                  </span>
                </div>
              )
            ) : null}
          </div>

          {/* Running stage */}
          <div className="flow-stage" title="Plans currently running in worktrees">
            <div className="flow-stage-header">
              <span className="flow-stage-name">Running</span>
              <span className={`flow-stage-count flow-count-${plans.some((p) => p.status === "running") ? "active" : "empty"}`}>
                {plans.filter((p) => p.status === "running").length}
              </span>
            </div>
            <span className="flow-stage-detail text-muted text-sm">
              {plans.filter((p) => p.status === "running").length} active run(s)
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
                  onMarkComplete={async (runId) => {
                    await markPlanRunComplete(runId);
                    setPlanRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status: "succeeded" } : r)));
                  }}
                  onCommit={async (_runId, _message) => {
                    // Commit is handled by the source control panel; this is a placeholder for future wiring.
                    addLog("info", "Commit requested", _message);
                  }}
                  onCreatePR={async (_runId, _title, _body) => {
                    addLog("info", "PR requested", _title);
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
      ) : null}

      {tab === "runs" ? (
        <MissionControlBoard
          sessionId={sessionId}
          projectPath={projectPath}
          plans={plans}
          chatPanels={chatPanels}
          onOpenChatSession={onOpenChatSession}
        />
      ) : null}

      {tab === "changes" ? (
        <ChangesPanel
          projectPath={projectPath}
          onFocusPlan={(refId) => {
            const plan = plans.find((p) => p.referenceId === refId);
            if (plan) onFocusPlan(plan);
          }}
          linkablePlans={plans.map((p) => ({ id: p.id, referenceId: p.referenceId, title: p.title }))}
        />
      ) : null}
    </div>
  );
}

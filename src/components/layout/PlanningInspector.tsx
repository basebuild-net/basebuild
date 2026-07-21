import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, LayoutGrid, X } from "lucide-react";
import type { Plan, PlanStatus } from "../../lib/plans";
import { isTerminalStatus } from "../../lib/plans";
import { batchPromoteIdeas, planningIntegrityCheck, type PlanningIntegrityIssue } from "../../lib/plans";
import { assignPlanToChat, enqueuePlan, listPlanRuns, listPlanRunsByProject, startQueue, getFinishOutcome } from "../../lib/planRuns";
import { useOpenSpecRuntime } from "../../state/useOpenSpecRuntime";
import { PlanPanel } from "./PlanPanel";
import { ChangesPanel } from "../panels/ChangesPanel";
import { MissionControlBoard } from "./MissionControlBoard";
import type { PlanRun, FinishOutcome } from "../../lib/planRuns";
import { useIdeaState } from "../../state/ideas";
import type { Idea, IdeaCategory, IdeaStatus } from "../../lib/ideas";
import { type ParsedIdeaBatch } from "../panels/IdeaReviewWorkbench";
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
  type MergeReviewEntry,
  type FinishPolicy,
} from "../../lib/planDependencies";
import { IdeasTab } from "./inspector/IdeasTab";
import { CategoriesTab } from "./inspector/CategoriesTab";
import { FlowTab, type LaunchFormState, type LaunchSummary, type MergeSessionState } from "./inspector/FlowTab";

export type PlanningTab = "plans" | "ideas" | "categories" | "flow" | "runs" | "changes";

const FINISH_POLICIES: readonly FinishPolicy[] = ["hold", "auto_commit", "auto_commit_pr", "queue_merge_review"];
function normalizeFinishPolicy(value: string | undefined): FinishPolicy {
  return FINISH_POLICIES.find((p) => p === value) ?? "hold";
}

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
  onSuggestForCategory?: (category: IdeaCategory | null) => void;
  onGenerateFromFinishedPlans?: () => void;
  onStartIdeaRound?: () => void;
  onGenerateCategories?: () => void;
  /** Open grid panels (panel id ↔ chat session id) for mission control. */
  chatPanels?: { panelId: string; chatSessionId: string | null }[];
  showHeader?: boolean;
  hostContext?: "dock" | "modal";
  onAssignPlan?: (plan: Plan, profile: LaunchProfile) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
  initialTab?: PlanningTab;
};

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
  onSuggestForCategory,
  onGenerateFromFinishedPlans,
  onStartIdeaRound,
  onGenerateCategories,
  chatPanels,
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
  const [promotingIdeaId, setPromotingIdeaId] = useState<string | null>(null);
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const [integrityIssues, setIntegrityIssues] = useState<PlanningIntegrityIssue[]>([]);
  const [openIdeaHistoryKey, setOpenIdeaHistoryKey] = useState<string | null>(null);
  const [openIdeaHistoryIndex, setOpenIdeaHistoryIndex] = useState(0);
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
  const [launchForm, setLaunchForm] = useState<LaunchFormState>({
    workerCount: 2,
    workspacePolicy: "isolated_worktrees",
    schedulingMode: "safe",
    engine: "openspec",
    finishPolicy: "hold",
  });
  const [launchConfirmOpen, setLaunchConfirmOpen] = useState(false);
  const [launchSummary, setLaunchSummary] = useState<LaunchSummary | null>(null);
  const [launchSaving, setLaunchSaving] = useState(false);
  const [dependencyGraph, setDependencyGraph] = useState<DependencyGraph | null>(null);
  const [mergeQueue, setMergeQueue] = useState<MergeReviewEntry[]>([]);
  const [runBoardLoading, setRunBoardLoading] = useState(false);
  const [mergeQueueLoading, setMergeQueueLoading] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeSession, setMergeSession] = useState<MergeSessionState>({ active: false, currentEntryId: null, total: 0, results: [] });
  const ideaState = useIdeaState(sessionId, projectPath);
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
    void (projectPath ? listPlanRunsByProject(projectPath) : listPlanRuns(sessionId))
      .then(setPlanRuns)
      .catch(() => setPlanRuns([]));
  }, [projectPath, sessionId, plans]);
  // Planning-data self check: runs on load and whenever plans/ideas change,
  // surfacing desyncs (deleted source ideas, orphaned rows, dangling
  // categories) as a visible warning instead of letting actions fail with
  // opaque "not found" errors.
  useEffect(() => {
    if (!projectPath) {
      setIntegrityIssues([]);
      return;
    }
    let cancelled = false;
    void planningIntegrityCheck(projectPath)
      .then((issues) => {
        if (cancelled) return;
        setIntegrityIssues(issues);
        if (issues.length > 0) {
          addLog(
            "warn",
            "Planning data desync detected",
            issues.map((issue) => `${issue.kind}: ${issue.detail}`).join(" | "),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setIntegrityIssues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, plans, ideaState.ideas, addLog]);
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
          const result = await getFinishOutcome(run.id);
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

  const prepareOpenSpecPlans = useCallback(
    (createdPlans: Plan[]) => {
      if (createdPlans.length === 0) return;
      setTab("plans");
      onShowToast?.(
        createdPlans.length === 1 ? "Getting plan ready" : `Getting ${createdPlans.length} plans ready`,
        "OpenSpec is generating the proposal, specs, design, and tasks.",
        "info",
      );
      const preparations = createdPlans.map((plan) => (
        Promise.resolve()
          .then(() => onSetPlanStatus(plan.id, "openspec"))
      ));
      void Promise.allSettled(preparations).then((results) => {
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length > 0) {
          const first = failed[0] as PromiseRejectedResult;
          const message = first.reason instanceof Error ? first.reason.message : String(first.reason);
          onShowToast?.(
            `${failed.length} plan${failed.length === 1 ? "" : "s"} could not be prepared`,
            message,
            "error",
          );
        } else {
          onShowToast?.(
            createdPlans.length === 1 ? "OpenSpec plan ready" : `${createdPlans.length} OpenSpec plans ready`,
            "Review the generated artifacts, then approve the plans for execution.",
            "success",
          );
        }
      });
    },
    [onSetPlanStatus, onShowToast],
  );

  const handlePromoteIdea = useCallback(
    async (idea: { id: string; title: string; description: string }) => {
      if (!sessionId) return;
      setPromotingIdeaId(idea.id);
      try {
        const result = await batchPromoteIdeas(sessionId, [idea.id]);
        const created = result.created[0];
        if (!created) {
          throw new Error(result.errors[0]?.error ?? "The idea could not be promoted.");
        }
        await ideaState.refresh();
        setTab("plans");
        prepareOpenSpecPlans([created]);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to promote idea", message);
        onShowToast?.("Could not prepare plan", message, "error");
      } finally {
        setPromotingIdeaId(null);
      }
    },
    [sessionId, ideaState, prepareOpenSpecPlans, addLog, onShowToast],
  );

  const handleBatchPromote = useCallback(async () => {
    if (!sessionId || selectedIdeaIds.size === 0) return;
    setBatchResult(null);
    try {
      const ideaIds = Array.from(selectedIdeaIds);
      const result = await batchPromoteIdeas(sessionId, ideaIds);
      const createdCount = result.created.length;
      const errorCount = result.errors.length;
      setBatchResult(
        errorCount > 0
          ? `${createdCount} plan${createdCount === 1 ? "" : "s"} preparing; ${errorCount} failed.`
          : `Preparing ${createdCount} OpenSpec plan${createdCount === 1 ? "" : "s"}…`,
      );
      if (errorCount > 0) {
        addLog("warn", "Batch promote partial failure", `${createdCount} ok, ${errorCount} failed`);
      }
      setSelectedIdeaIds(new Set());
      await ideaState.refresh();
      if (result.created.length > 0) setTab("plans");
      prepareOpenSpecPlans(result.created);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addLog("error", "Batch promote failed", message);
      setBatchResult(`Error: ${message}`);
    }
  }, [sessionId, selectedIdeaIds, ideaState, addLog, prepareOpenSpecPlans]);

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

  const handleResumePlanRun = useCallback(async (run: PlanRun) => {
    if (!run.chatSessionId) {
      onShowToast?.("Resume blocked", "This run has no retained chat owner.", "error");
      return;
    }
    try {
      await assignPlanToChat(run.planId, run.chatSessionId);
      onOpenChatSession(run.chatSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog("error", "Failed to resume plan run", message);
      onShowToast?.("Resume failed", message, "error");
    }
  }, [addLog, onOpenChatSession, onShowToast]);

  // "Active" hides picked ideas — they have been promoted to the plan stage —
  // and archived ones. Explicit status chips still surface them.
  const filteredIdeas = statusFilter === "all"
    ? ideaState.ideas.filter((i) => i.status !== "picked" && i.status !== "archived")
    : ideaState.ideas.filter((i) => i.status === statusFilter);

  const categoryIdeas = selectedCategory
    ? ideaState.ideas.filter((i) => i.categoryId === selectedCategory.id)
    : [];

  const ideaHistoryBatches = statusFilter === "all"
    ? Array.from(ideaState.ideas.reduce((groups, idea) => {
      if (idea.status === "concept") return groups;
      const key = idea.batchId ?? `idea:${idea.id}`;
      const existing = groups.get(key);
      if (existing) existing.push(idea);
      else groups.set(key, [idea]);
      return groups;
    }, new Map<string, Idea[]>())).map(([key, ideas]) => ({
      key,
      ideas,
      batch: {
        proposals: ideas.map((idea) => ({
          title: idea.title,
          description: idea.description,
          grounding: idea.grounding ?? undefined,
          anchor: idea.anchor ?? undefined,
          assessment: idea.assessment,
        })),
        categoryId: ideas[0]?.categoryId ?? null,
      } satisfies ParsedIdeaBatch,
    }))
    : [];
  const openIdeaHistory = ideaHistoryBatches.find(({ key }) => key === openIdeaHistoryKey) ?? null;
  const displayedIdeas = statusFilter === "all"
    ? filteredIdeas.filter((idea) => idea.status === "concept")
    : filteredIdeas;

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
      {integrityIssues.length > 0 ? (
        <div
          className="planning-integrity-warning"
          role="status"
          title={integrityIssues.map((issue) => issue.detail).join("\n")}
        >
          <AlertTriangle size={12} />
          <span>
            Planning data desync: {integrityIssues.length} issue{integrityIssues.length === 1 ? "" : "s"} found — some actions may fail. Hover for details.
          </span>
        </div>
      ) : null}

      {tab === "plans" ? (
        <PlanPanel
          sessionId={sessionId}
          projectPath={projectPath}
          plans={plans}
          ideas={ideaState.ideas}
          planRuns={planRuns}
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
          onArchivePlan={() => setTab("changes")}
          onResumeRun={handleResumePlanRun}
          onReviewRun={() => setTab("changes")}
        />
      ) : null}

      {tab === "ideas" ? (
        <IdeasTab
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          grounding={grounding}
          onGenerateFromFinishedPlans={onGenerateFromFinishedPlans}
          selectedIdeaIds={selectedIdeaIds}
          setSelectedIdeaIds={setSelectedIdeaIds}
          handleBatchPromote={handleBatchPromote}
          handleRejectSelected={handleRejectSelected}
          batchResult={batchResult}
          openIdeaHistory={openIdeaHistory}
          projectPath={projectPath}
          openIdeaHistoryIndex={openIdeaHistoryIndex}
          setOpenIdeaHistoryIndex={setOpenIdeaHistoryIndex}
          setOpenIdeaHistoryKey={setOpenIdeaHistoryKey}
          ideaHistoryBatches={ideaHistoryBatches}
          displayedIdeas={displayedIdeas}
          onStartIdeaRound={onStartIdeaRound}
          expandedIdeaId={expandedIdeaId}
          setExpandedIdeaId={setExpandedIdeaId}
          promotingIdeaId={promotingIdeaId}
          handlePromoteIdea={handlePromoteIdea}
          ideaState={ideaState}
        />
      ) : null}

      {tab === "categories" ? (
        <CategoriesTab
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          onSuggestForCategory={onSuggestForCategory}
          categoryIdeas={categoryIdeas}
          newCategoryName={newCategoryName}
          setNewCategoryName={setNewCategoryName}
          newCategoryDesc={newCategoryDesc}
          setNewCategoryDesc={setNewCategoryDesc}
          handleCreateCategory={handleCreateCategory}
          onGenerateCategories={onGenerateCategories}
          ideaState={ideaState}
        />
      ) : null}

      {tab === "flow" ? (
        <FlowTab
          ideaState={ideaState}
          plans={plans}
          planRuns={planRuns}
          setPlanRuns={setPlanRuns}
          onStartIdeaRound={onStartIdeaRound}
          setTab={setTab}
          launchForm={launchForm}
          setLaunchForm={setLaunchForm}
          handleSaveLaunchProfile={handleSaveLaunchProfile}
          launchSaving={launchSaving}
          projectPath={projectPath}
          schematicReport={schematic.report}
          launchConfirmOpen={launchConfirmOpen}
          setLaunchConfirmOpen={setLaunchConfirmOpen}
          launchSummary={launchSummary}
          runtimeReady={runtimeReady}
          runtimeState={runtime.status?.state}
          handleLaunchClick={handleLaunchClick}
          handleLaunchConfirm={handleLaunchConfirm}
          completionDismissed={completionDismissed}
          setCompletionDismissed={setCompletionDismissed}
          finishOutcomes={finishOutcomes}
          sessionId={sessionId}
          onOpenChatSession={onOpenChatSession}
          launchProfile={launchProfile}
          runBoardLoading={runBoardLoading}
          dependencyGraph={dependencyGraph}
          mergeQueueLoading={mergeQueueLoading}
          mergeQueue={mergeQueue}
          setMergeQueue={setMergeQueue}
          mergeSelected={mergeSelected}
          setMergeSelected={setMergeSelected}
          mergeSession={mergeSession}
          setMergeSession={setMergeSession}
          handleResumePlanRun={handleResumePlanRun}
          handleReviewMergeEntry={handleReviewMergeEntry}
        />
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
          linkablePlans={plans.map((p) => ({
            id: p.id,
            referenceId: p.referenceId,
            title: p.title,
            status: p.status,
          }))}
        />
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Edit3,
  FolderTree,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Plus,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Idea, IdeaCategory, IdeaStatus } from "../../lib/ideas";
import type { Plan } from "../../lib/plans";
import { PLAN_STATUS_LABEL, sortPlansForDisplay } from "../../lib/plans";
import {
  derivePlanRunViewState,
  listPlanRuns,
  listPlanRunsByProject,
  type PlanRun,
} from "../../lib/planRuns";
import { nativeChatList, type NativeChatSession } from "../../lib/native-chat";
import { usePlanningEvents } from "../../state/planningEvents";

export type StageKey = "schematic" | "ideas" | "plans" | "running" | "finished";

type StageMeta = {
  label: string;
  icon: LucideIcon;
  /** CSS color variable name from --bb-* palette. */
  color: string;
};

const STAGE_META: Record<StageKey, StageMeta> = {
  schematic: { label: "Schematic", icon: FolderTree, color: "var(--bb-cta)" },
  ideas: { label: "Ideas", icon: Lightbulb, color: "var(--bb-text)" },
  plans: { label: "Plans", icon: ListChecks, color: "var(--bb-warning, #f59e0b)" },
  running: { label: "Running", icon: Play, color: "var(--bb-status-running, #f97316)" },
  finished: { label: "Done", icon: Check, color: "var(--bb-positive, #4ade80)" },
};

type PlanningIndicatorsProps = {
  plans: Plan[];
  sessionId: string | null;
  projectPath: string | null;
  ideas: Idea[];
  categories: IdeaCategory[];
  schematicHealth: "complete" | "incomplete" | "none";
  onOpenStage: (stage: StageKey) => void;
  onOpenFullUI: (stage: StageKey) => void;
  onGenerateMoreIdeas: () => void;
  onCreateIdea: (title: string, description: string, categoryId: string | null) => Promise<void>;
  onUpdateIdea: (
    id: string,
    title: string,
    description: string,
    categoryId: string | null,
  ) => Promise<void>;
  onSetIdeaStatus: (id: string, status: IdeaStatus) => Promise<void>;
  onDeleteIdea: (id: string) => Promise<void>;
  onPromoteIdeas: (ids: string[]) => Promise<void>;
  /** Open a plan's focus/detail view. */
  onOpenPlan: (plan: Plan) => void;
  /** Open the chat where an agent is working this (running) plan. */
  onOpenRunChat: (plan: Plan) => void;
  /** Apply a ready plan to a chat session. */
  onAssignPlan: (plan: Plan) => void;
  /** Approve an openspec plan (validate, then mark ready). May return a
   *  promise — the item shows a busy spinner until it settles. */
  onApprovePlan: (plan: Plan) => void | Promise<unknown>;
  /** Generate (draft) or regenerate (openspec) the plan's OpenSpec artifacts. */
  onRedoPlan: (plan: Plan) => void | Promise<unknown>;
  onDeletePlan: (planId: string) => void | Promise<unknown>;
};

type DropdownState = { stage: StageKey; rect: DOMRect } | null;

export function PlanningIndicators({
  plans,
  sessionId,
  projectPath,
  ideas,
  categories,
  schematicHealth,
  onOpenStage,
  onOpenFullUI,
  onGenerateMoreIdeas,
  onCreateIdea,
  onUpdateIdea,
  onSetIdeaStatus,
  onDeleteIdea,
  onPromoteIdeas,
  onOpenPlan,
  onOpenRunChat,
  onAssignPlan,
  onApprovePlan,
  onRedoPlan,
  onDeletePlan,
}: PlanningIndicatorsProps) {
  const [dropdown, setDropdown] = useState<DropdownState>(null);
  const [pulse, setPulse] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef(0);

  const [planRuns, setPlanRuns] = useState<PlanRun[]>([]);
  const [chatSessions, setChatSessions] = useState<NativeChatSession[]>([]);
  const refreshRunSnapshots = useCallback(async () => {
    if (!sessionId) {
      setPlanRuns([]);
      setChatSessions([]);
      return;
    }
    const [nextRuns, nextChats] = await Promise.all([
      projectPath
        ? listPlanRunsByProject(projectPath).catch(() => [] as PlanRun[])
        : listPlanRuns(sessionId).catch(() => [] as PlanRun[]),
      projectPath
        ? nativeChatList(projectPath).catch(() => [] as NativeChatSession[])
        : Promise.resolve([] as NativeChatSession[]),
    ]);
    setPlanRuns(nextRuns);
    setChatSessions(nextChats);
  }, [projectPath, sessionId]);
  useEffect(() => {
    void refreshRunSnapshots();
  }, [refreshRunSnapshots]);
  usePlanningEvents(refreshRunSnapshots);

  const activePlanRuns = useMemo(
    () => planRuns.filter((run) => {
      const chat = chatSessions.find((candidate) => candidate.id === run.chatSessionId);
      const state = derivePlanRunViewState(run, chat?.runState).state;
      return state === "queued" || state === "running" || state === "needs-input";
    }),
    [chatSessions, planRuns],
  );
  const activePlanIds = useMemo(
    () => new Set(activePlanRuns.map((run) => run.planId)),
    [activePlanRuns],
  );
  const runningCount = activePlanRuns.length;
  const finishedCount = plans.filter((p) => p.status === "finished").length;
  const ideaCount = ideas.filter((i) => i.status === "concept").length;

  useEffect(() => {
    if (runningCount !== prevRunningRef.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1000);
      prevRunningRef.current = runningCount;
      return () => clearTimeout(t);
    }
  }, [runningCount]);

  const stages: { key: StageKey; count: number }[] = [
    { key: "schematic", count: schematicHealth === "complete" ? 1 : 0 },
    { key: "ideas", count: ideaCount },
    { key: "plans", count: plans.length },
    { key: "running", count: runningCount },
    { key: "finished", count: finishedCount },
  ];

  const closeDropdown = useCallback(() => setDropdown(null), []);

  useEffect(() => {
    if (!dropdown) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el && containerRef.current?.contains(el)) return;
      closeDropdown();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeDropdown(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [dropdown, closeDropdown]);

  const toggleDropdown = useCallback((stage: StageKey, e: React.MouseEvent) => {
    const btn = e.currentTarget as HTMLElement;
    setDropdown((prev) =>
      prev?.stage === stage ? null : { stage, rect: btn.getBoundingClientRect() },
    );
  }, []);

  return (
    <div className="planning-indicators" ref={containerRef}>
      {stages.map((stage) => {
        const meta = STAGE_META[stage.key];
        const Icon = meta.icon;
        const isPulsing = stage.key === "running" && pulse && stage.count > 0;
        const isOpen = dropdown?.stage === stage.key;
        return (
          <button
            key={stage.key}
            type="button"
            className={`planning-indicator${isOpen ? " is-open" : ""}${isPulsing ? " is-pulsing" : ""}`}
            data-stage={stage.key}
            title={`${meta.label}: ${stage.count}${stage.key === "running" ? " running" : ""}${stage.key === "schematic" ? (schematicHealth === "complete" ? " (complete)" : schematicHealth === "incomplete" ? " (partial)" : " (missing)") : ""}`}
            onClick={(e) => toggleDropdown(stage.key, e)}
          >
            <Icon size={12} className="planning-indicator-icon" />
            <span className="planning-indicator-count">{stage.count}</span>
          </button>
        );
      })}
      {dropdown ? (
        <NotificationDropdown
          stage={dropdown.stage}
          rect={dropdown.rect}
          plans={plans}
          activePlanIds={activePlanIds}
          ideas={ideas}
          categories={categories}
          schematicHealth={schematicHealth}
          onGenerateMoreIdeas={() => { onGenerateMoreIdeas(); closeDropdown(); }}
          onCreateIdea={onCreateIdea}
          onUpdateIdea={onUpdateIdea}
          onSetIdeaStatus={onSetIdeaStatus}
          onDeleteIdea={onDeleteIdea}
          onPromoteIdeas={onPromoteIdeas}
          onOpenPlan={(plan) => { onOpenPlan(plan); closeDropdown(); }}
          onOpenRunChat={(plan) => { onOpenRunChat(plan); closeDropdown(); }}
          onAssignPlan={(plan) => { onAssignPlan(plan); closeDropdown(); }}
          onApprovePlan={onApprovePlan}
          onRedoPlan={onRedoPlan}
          onDeletePlan={onDeletePlan}
          onOpenFullUI={() => { onOpenFullUI(dropdown.stage); closeDropdown(); }}
          onOpenStage={(stage) => { onOpenStage(stage); closeDropdown(); }}
        />
      ) : null}
    </div>
  );
}

// ─── Notification Dropdown ──────────────────────────────────────────────────

type DropdownProps = {
  stage: StageKey;
  rect: DOMRect;
  plans: Plan[];
  activePlanIds: ReadonlySet<string>;
  ideas: Idea[];
  categories: IdeaCategory[];
  schematicHealth: "complete" | "incomplete" | "none";
  onOpenFullUI: () => void;
  onOpenStage: (stage: StageKey) => void;
  onGenerateMoreIdeas: () => void;
  onCreateIdea: (title: string, description: string, categoryId: string | null) => Promise<void>;
  onUpdateIdea: (
    id: string,
    title: string,
    description: string,
    categoryId: string | null,
  ) => Promise<void>;
  onSetIdeaStatus: (id: string, status: IdeaStatus) => Promise<void>;
  onDeleteIdea: (id: string) => Promise<void>;
  onPromoteIdeas: (ids: string[]) => Promise<void>;
  onOpenPlan: (plan: Plan) => void;
  onOpenRunChat: (plan: Plan) => void;
  onAssignPlan: (plan: Plan) => void;
  onApprovePlan: (plan: Plan) => void | Promise<unknown>;
  onRedoPlan: (plan: Plan) => void | Promise<unknown>;
  onDeletePlan: (planId: string) => void | Promise<unknown>;
};

function NotificationDropdown({
  stage,
  rect,
  plans,
  activePlanIds,
  ideas,
  categories,
  schematicHealth,
  onOpenFullUI,
  onOpenStage,
  onGenerateMoreIdeas,
  onCreateIdea,
  onUpdateIdea,
  onSetIdeaStatus,
  onDeleteIdea,
  onPromoteIdeas,
  onOpenPlan,
  onOpenRunChat,
  onAssignPlan,
  onApprovePlan,
  onRedoPlan,
  onDeletePlan,
}: DropdownProps) {
  const meta = STAGE_META[stage];
  const Icon = meta.icon;

  // Position dropdown below the button, clamped to viewport.
  const top = rect.bottom + 4;
  const dropdownWidth = stage === "ideas" ? 380 : 280;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8));

  return (
    <div
      className="planning-notification-dropdown"
      data-stage={stage}
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <div className="planning-notification-header">
        <Icon size={11} className="planning-notification-header-icon" />
        <span className="planning-notification-title">{meta.label}</span>
        <button
          type="button"
          className="planning-notification-full-btn"
          title={`Open full ${meta.label} UI`}
          onClick={onOpenFullUI}
        >
          Full UI
          <ChevronRight size={10} />
        </button>
      </div>
      <div className="planning-notification-list">
        {stage === "schematic" ? (
          <SchematicItems health={schematicHealth} onOpen={onOpenStage} />
        ) : stage === "ideas" ? (
          <IdeaQuickMenu
            ideas={ideas}
            categories={categories}
            onGenerateMore={onGenerateMoreIdeas}
            onCreate={onCreateIdea}
            onUpdate={onUpdateIdea}
            onSetStatus={onSetIdeaStatus}
            onDelete={onDeleteIdea}
            onPromote={onPromoteIdeas}
          />
        ) : stage === "plans" ? (
          <PlanItems
            plans={plans}
            filter={(p) => !activePlanIds.has(p.id) && p.status !== "finished" && p.status !== "cancelled"}
            openRunIds={activePlanIds}
            onOpenPlan={onOpenPlan}
            onOpenRunChat={onOpenRunChat}
            onAssignPlan={onAssignPlan}
            onApprovePlan={onApprovePlan}
            onRedoPlan={onRedoPlan}
            onDeletePlan={onDeletePlan}
          />
        ) : stage === "running" ? (
          <PlanItems
            plans={plans}
            filter={(p) => activePlanIds.has(p.id)}
            openRunIds={activePlanIds}
            onOpenPlan={onOpenPlan}
            onOpenRunChat={onOpenRunChat}
            onAssignPlan={onAssignPlan}
            onApprovePlan={onApprovePlan}
            onRedoPlan={onRedoPlan}
            onDeletePlan={onDeletePlan}
          />
        ) : stage === "finished" ? (
          <FinishedItems plans={plans} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Schematic items ────────────────────────────────────────────────────────

function SchematicItems({
  health,
  onOpen,
}: {
  health: "complete" | "incomplete" | "none";
  onOpen: (stage: StageKey) => void;
}) {
  const label = health === "complete" ? "Schematic complete" : health === "incomplete" ? "Schematic partial" : "No schematic";
  return (
    <button
      type="button"
      className="planning-notification-item"
      data-health={health}
      title="Open schematic editor"
      onClick={() => onOpen("schematic")}
    >
      <span className="planning-notification-item-dot" />
      <span className="planning-notification-item-text">{label}</span>
    </button>
  );
}

// ─── Idea items ─────────────────────────────────────────────────────────────

type IdeaFilter = "active" | "all" | IdeaStatus;

type IdeaDraft = {
  title: string;
  description: string;
  categoryId: string | null;
};

type IdeaEditorState = {
  mode: "create" | "edit";
  ideaId: string | null;
  draft: IdeaDraft;
};

function IdeaQuickMenu({
  ideas,
  categories,
  onGenerateMore,
  onCreate,
  onUpdate,
  onSetStatus,
  onDelete,
  onPromote,
}: {
  ideas: Idea[];
  categories: IdeaCategory[];
  onGenerateMore: () => void;
  onCreate: (title: string, description: string, categoryId: string | null) => Promise<void>;
  onUpdate: (
    id: string,
    title: string,
    description: string,
    categoryId: string | null,
  ) => Promise<void>;
  onSetStatus: (id: string, status: IdeaStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPromote: (ids: string[]) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<IdeaFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<IdeaEditorState | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredIdeas = ideas.filter((idea) => {
    const matchesStatus =
      statusFilter === "all"
      || (statusFilter === "active"
        ? idea.status === "concept" || idea.status === "picked"
        : idea.status === statusFilter);
    const matchesCategory =
      categoryFilter === "all"
      || (categoryFilter === "uncategorized"
        ? idea.categoryId === null
        : idea.categoryId === categoryFilter);
    return matchesStatus && matchesCategory;
  });
  const selectedConceptIds = ideas
    .filter((idea) => idea.status === "concept" && selectedIds.has(idea.id))
    .map((idea) => idea.id);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>): Promise<boolean> => {
      setBusyKey(key);
      setError(null);
      try {
        await action();
        return true;
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const beginCreate = () => {
    setError(null);
    setDeletePendingId(null);
    setEditor({
      mode: "create",
      ideaId: null,
      draft: { title: "", description: "", categoryId: null },
    });
  };

  const beginEdit = (idea: Idea) => {
    setError(null);
    setDeletePendingId(null);
    setEditor({
      mode: "edit",
      ideaId: idea.id,
      draft: {
        title: idea.title,
        description: idea.description,
        categoryId: idea.categoryId,
      },
    });
  };

  const saveEditor = async () => {
    if (!editor) return;
    const title = editor.draft.title.trim();
    if (!title) {
      setError("Idea title is required.");
      return;
    }
    const saved = await runAction("save", async () => {
      if (editor.mode === "create") {
        await onCreate(title, editor.draft.description, editor.draft.categoryId);
      } else if (editor.ideaId) {
        await onUpdate(
          editor.ideaId,
          title,
          editor.draft.description,
          editor.draft.categoryId,
        );
      }
    });
    if (saved) setEditor(null);
  };

  const promoteSelected = async () => {
    if (selectedConceptIds.length === 0) return;
    const promoted = await runAction("promote-selected", () => onPromote(selectedConceptIds));
    if (promoted) setSelectedIds(new Set());
  };

  const renderEditor = () => {
    if (!editor) return null;
    const label = editor.mode === "create" ? "Create idea" : "Edit idea";
    return (
      <div className="planning-quick-editor" aria-label={label}>
        <label className="planning-quick-field">
          <span>Title</span>
          <input
            className="input"
            value={editor.draft.title}
            maxLength={240}
            autoFocus
            title={`${label} title`}
            onChange={(event) => {
              const title = event.target.value;
              setEditor((current) => current
                ? { ...current, draft: { ...current.draft, title } }
                : current);
            }}
          />
        </label>
        <label className="planning-quick-field">
          <span>Description</span>
          <textarea
            className="input planning-quick-description"
            value={editor.draft.description}
            maxLength={20_000}
            rows={3}
            title={`${label} description`}
            onChange={(event) => {
              const description = event.target.value;
              setEditor((current) => current
                ? { ...current, draft: { ...current.draft, description } }
                : current);
            }}
          />
        </label>
        <label className="planning-quick-field">
          <span>Category</span>
          <select
            className="input planning-quick-select"
            value={editor.draft.categoryId ?? ""}
            title={`${label} category`}
            onChange={(event) => {
              const categoryId = event.target.value || null;
              setEditor((current) => current
                ? { ...current, draft: { ...current.draft, categoryId } }
                : current);
            }}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <div className="planning-quick-editor-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            title={editor.mode === "create" ? "Create idea" : "Save idea changes"}
            disabled={busyKey === "save" || !editor.draft.title.trim()}
            onClick={() => void saveEditor()}
          >
            {busyKey === "save"
              ? <LoaderCircle size={11} className="spin" />
              : <Save size={11} />}
            {editor.mode === "create" ? "Create" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Cancel idea editing"
            disabled={busyKey === "save"}
            onClick={() => setEditor(null)}
          >
            <X size={11} />
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="planning-quick-menu">
      <div className="planning-quick-primary-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          title="Generate another guided round of ideas"
          onClick={onGenerateMore}
        >
          <RefreshCw size={11} />
          Generate more ideas
        </button>
        <button
          type="button"
          className="btn btn-sm"
          title="Create an idea manually"
          onClick={beginCreate}
        >
          <Plus size={11} />
          New idea
        </button>
      </div>

      {editor?.mode === "create" ? renderEditor() : null}

      <div className="planning-quick-filters">
        <select
          className="input planning-quick-select"
          value={statusFilter}
          title="Filter ideas by status"
          onChange={(event) => setStatusFilter(event.target.value as IdeaFilter)}
        >
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          <option value="concept">Concept</option>
          <option value="picked">Picked</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
        <select
          className="input planning-quick-select"
          value={categoryFilter}
          title="Filter ideas by category"
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>

      {selectedConceptIds.length > 0 ? (
        <button
          type="button"
          className="planning-quick-bulk-action"
          title={`Upgrade ${selectedConceptIds.length} selected idea${selectedConceptIds.length === 1 ? "" : "s"} to plans`}
          disabled={busyKey === "promote-selected"}
          onClick={() => void promoteSelected()}
        >
          {busyKey === "promote-selected"
            ? <LoaderCircle size={11} className="spin" />
            : <Rocket size={11} />}
          Upgrade selected ({selectedConceptIds.length})
        </button>
      ) : null}

      {error ? <div className="planning-quick-error" role="alert">{error}</div> : null}

      <div className="planning-quick-idea-list">
        {filteredIdeas.length === 0 ? (
          <div className="planning-notification-empty">No ideas match these filters</div>
        ) : filteredIdeas.map((idea) => {
          const isBusy = busyKey?.endsWith(idea.id) ?? false;
          const category = categories.find((item) => item.id === idea.categoryId);
          const isEditing = editor?.mode === "edit" && editor.ideaId === idea.id;
          const isDeletePending = deletePendingId === idea.id;
          return (
            <div key={idea.id} className="planning-quick-idea" data-status={idea.status}>
              <div className="planning-quick-idea-row">
                {idea.status === "concept" ? (
                  <input
                    type="checkbox"
                    className="planning-quick-checkbox"
                    checked={selectedIds.has(idea.id)}
                    title={`Select ${idea.title} for upgrade`}
                    aria-label={`Select ${idea.title} for upgrade`}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (checked) next.add(idea.id);
                        else next.delete(idea.id);
                        return next;
                      });
                    }}
                  />
                ) : <span className="planning-quick-checkbox-spacer" />}
                <button
                  type="button"
                  className="planning-quick-idea-main"
                  title={`Edit ${idea.title}`}
                  onClick={() => beginEdit(idea)}
                >
                  <span className="planning-quick-idea-title">{idea.title}</span>
                  <span className="planning-quick-idea-description">
                    {idea.description || "No description"}
                    {category ? ` · ${category.name}` : ""}
                  </span>
                </button>
                <select
                  className="planning-quick-status"
                  value={idea.status}
                  title={`Change status for ${idea.title}`}
                  aria-label={`Status for ${idea.title}`}
                  disabled={isBusy}
                  onChange={(event) => {
                    const status = event.target.value as IdeaStatus;
                    void runAction(`status-${idea.id}`, () => onSetStatus(idea.id, status));
                  }}
                >
                  <option value="concept">Concept</option>
                  <option value="picked">Picked</option>
                  <option value="rejected">Rejected</option>
                  <option value="archived">Archived</option>
                </select>
                {isDeletePending ? (
                  <div className="planning-quick-delete-confirm">
                    <span>Delete?</span>
                    <button
                      type="button"
                      className="planning-notification-action is-danger"
                      title={`Confirm deletion of ${idea.title}`}
                      aria-label={`Confirm deletion of ${idea.title}`}
                      disabled={isBusy}
                      onClick={() => {
                        void runAction(`delete-${idea.id}`, () => onDelete(idea.id))
                          .then((deleted) => {
                            if (deleted) {
                              setDeletePendingId(null);
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                next.delete(idea.id);
                                return next;
                              });
                            }
                          });
                      }}
                    >
                      <Check size={11} />
                    </button>
                    <button
                      type="button"
                      className="planning-notification-action"
                      title="Cancel deletion"
                      aria-label="Cancel deletion"
                      disabled={isBusy}
                      onClick={() => setDeletePendingId(null)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <div className="planning-quick-row-actions">
                    <button
                      type="button"
                      className="planning-notification-action"
                      title={`Edit ${idea.title}`}
                      aria-label={`Edit ${idea.title}`}
                      onClick={() => beginEdit(idea)}
                    >
                      <Edit3 size={11} />
                    </button>
                    {idea.status === "concept" ? (
                      <button
                        type="button"
                        className="planning-notification-action is-primary"
                        title={`Upgrade ${idea.title} to a plan`}
                        aria-label={`Upgrade ${idea.title} to a plan`}
                        disabled={isBusy}
                        onClick={() => {
                          void runAction(`promote-${idea.id}`, () => onPromote([idea.id]));
                        }}
                      >
                        {busyKey === `promote-${idea.id}`
                          ? <LoaderCircle size={11} className="spin" />
                          : <Rocket size={11} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="planning-notification-action is-danger"
                      title={`Delete ${idea.title}`}
                      aria-label={`Delete ${idea.title}`}
                      onClick={() => {
                        setEditor(null);
                        setDeletePendingId(idea.id);
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
              {isEditing ? renderEditor() : null}
            </div>
          );
        })}
      </div>

      <div className="planning-quick-summary">
        Showing {filteredIdeas.length} of {ideas.length} ideas
      </div>
    </div>
  );
}

// ─── Plan items (generic) ───────────────────────────────────────────────────

function PlanItems({
  plans,
  filter,
  openRunIds,
  onOpenPlan,
  onOpenRunChat,
  onAssignPlan,
  onApprovePlan,
  onRedoPlan,
  onDeletePlan,
}: {
  plans: Plan[];
  filter: (p: Plan) => boolean;
  openRunIds: ReadonlySet<string>;
  onOpenPlan: (plan: Plan) => void;
  onOpenRunChat: (plan: Plan) => void;
  onAssignPlan: (plan: Plan) => void;
  onApprovePlan: (plan: Plan) => void | Promise<unknown>;
  onRedoPlan: (plan: Plan) => void | Promise<unknown>;
  onDeletePlan: (planId: string) => void | Promise<unknown>;
}) {
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  // "<planId>:<action>" while that action's callback is settling.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const runAction = (key: string, action: () => void | Promise<unknown>) => {
    const result = action();
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      setBusyKey(key);
      void (result as Promise<unknown>).finally(() => setBusyKey((v) => (v === key ? null : v)));
    }
  };
  const filtered = sortPlansForDisplay(plans.filter(filter));
  if (filtered.length === 0) {
    return <div className="planning-notification-empty">No items</div>;
  }
  return (
    <>
      {filtered.slice(0, 12).map((plan) => (
        <div
          key={plan.id}
          className="planning-notification-item planning-notification-item-plan"
          data-status={openRunIds.has(plan.id) ? "running" : plan.status}
          title={plan.description || plan.goal || ""}
        >
          <button
            type="button"
            className="planning-notification-item-open"
            title={
              openRunIds.has(plan.id)
                ? `Open the chat where the agent is working #${plan.referenceId}`
                : `View plan #${plan.referenceId} ${plan.title}`
            }
            onClick={() => (openRunIds.has(plan.id) ? onOpenRunChat(plan) : onOpenPlan(plan))}
          >
            <span className="planning-notification-item-dot" />
            <span className="planning-notification-item-text">#{plan.referenceId} {plan.title}</span>
            <span className="planning-notification-item-meta planning-notification-item-status">
              {openRunIds.has(plan.id) ? PLAN_STATUS_LABEL.running : PLAN_STATUS_LABEL[plan.status]}
            </span>
          </button>
          <span className="planning-notification-item-actions">
            {plan.status === "ready" ? (
              <button
                type="button"
                className="planning-notification-action"
                title="Apply this plan to a chat"
                onClick={(e) => { e.stopPropagation(); onAssignPlan(plan); }}
              >
                <Send size={10} />
              </button>
            ) : null}
            {plan.status === "openspec" ? (
              <button
                type="button"
                className="planning-notification-action"
                title="Approve plan — mark ready to apply to a chat"
                disabled={busyKey === `${plan.id}:approve`}
                onClick={(e) => { e.stopPropagation(); runAction(`${plan.id}:approve`, () => onApprovePlan(plan)); }}
              >
                {busyKey === `${plan.id}:approve` ? <LoaderCircle size={10} className="spin" /> : <Check size={10} />}
              </button>
            ) : null}
            {plan.status === "openspec" || plan.status === "draft" ? (
              <button
                type="button"
                className="planning-notification-action"
                title={plan.status === "draft" ? "Generate OpenSpec artifacts" : "Redo — regenerate OpenSpec artifacts"}
                disabled={busyKey === `${plan.id}:redo`}
                onClick={(e) => { e.stopPropagation(); runAction(`${plan.id}:redo`, () => onRedoPlan(plan)); }}
              >
                {busyKey === `${plan.id}:redo`
                  ? <LoaderCircle size={10} className="spin" />
                  : plan.status === "draft" ? <Rocket size={10} /> : <RefreshCw size={10} />}
              </button>
            ) : null}
            <button
              type="button"
              className={`planning-notification-action planning-notification-action-danger${deletePendingId === plan.id ? " is-pending" : ""}`}
              title={deletePendingId === plan.id ? "Click again to delete this plan" : "Delete plan"}
              disabled={busyKey === `${plan.id}:delete`}
              onClick={(e) => {
                e.stopPropagation();
                if (deletePendingId === plan.id) {
                  setDeletePendingId(null);
                  runAction(`${plan.id}:delete`, () => onDeletePlan(plan.id));
                } else {
                  setDeletePendingId(plan.id);
                }
              }}
            >
              {busyKey === `${plan.id}:delete` ? <LoaderCircle size={10} className="spin" /> : <Trash2 size={10} />}
            </button>
          </span>
        </div>
      ))}
      {filtered.length > 12 ? (
        <div className="planning-notification-more">+{filtered.length - 12} more</div>
      ) : null}
    </>
  );
}

// ─── Finished items ─────────────────────────────────────────────────────────

function FinishedItems({ plans }: { plans: Plan[] }) {
  const finished = plans.filter((plan) => plan.status === "finished");
  if (finished.length === 0) {
    return <div className="planning-notification-empty">No finished plans</div>;
  }
  return (
    <>
      {finished.map((plan) => (
        <div key={plan.id} className="planning-notification-item planning-notification-item-done" title={plan.description || plan.goal || ""}>
          <span className="planning-notification-item-dot" />
          <span className="planning-notification-item-text">#{plan.referenceId} {plan.title}</span>
          <span className="planning-notification-item-meta">done</span>
        </div>
      ))}
    </>
  );
}

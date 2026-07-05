import { useCallback, useEffect, useState } from "react";
import { FolderTree, LayoutGrid, Lightbulb, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Plan, PlanStatus } from "../../lib/plans";
import { isTerminalStatus, PLAN_STATUSES, PLAN_STATUS_LABEL } from "../../lib/plans";
import { PlanPanel } from "./PlanPanel";
import { useIdeaState } from "../../state/ideas";
import type { IdeaCategory, IdeaStatus } from "../../lib/ideas";
import { useProjectSchematic } from "../../state/schematic";
import { useLogs } from "../../state/log";

type Tab = "plans" | "ideas" | "categories";

type PlanningInspectorProps = {
  sessionId: string | null;
  projectPath: string | null;
  plans: Plan[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreatePlan: () => void;
  onEditPlan: (plan: Plan) => void;
  onFocusPlan: (plan: Plan) => void;
  onSetPlanStatus: (id: string, status: PlanStatus) => void;
  onDeletePlan: (id: string) => void;
  onCopyReference: (refId: string) => void;
  onOpenInTerminal: (plan: Plan) => void;
  onOpenChatSession: (chatSessionId: string) => void;
  onPromoteIdea?: (title: string, description: string, chatSessionId: string | null) => Promise<void> | void;
  onSuggestForCategory?: (category: IdeaCategory | null) => void;
  activeChatSessionId?: string | null;
  showHeader?: boolean;
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
  onCreatePlan,
  onEditPlan,
  onFocusPlan,
  onSetPlanStatus,
  onDeletePlan,
  onCopyReference,
  onOpenInTerminal,
  onOpenChatSession,
  onPromoteIdea,
  onSuggestForCategory,
  activeChatSessionId,
  showHeader = true,
}: PlanningInspectorProps) {
  const [tab, setTab] = useState<Tab>("plans");
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<IdeaCategory | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDesc, setNewCategoryDesc] = useState("");
  const ideaState = useIdeaState(sessionId);
  const schematic = useProjectSchematic(projectPath);
  const { addLog } = useLogs();

  // Categories tab: no auto-seeding (schematic-grounded-planning). The empty
  // state offers "Generate categories from project" and manual add.
  useEffect(() => {
    if (tab === "categories" && sessionId) {
      void ideaState.refresh();
    }
  }, [tab, sessionId, ideaState]);

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

  const handleCreateCategory = useCallback(() => {
    if (!sessionId || !newCategoryName.trim()) return;
    void (async () => {
      await ideaState.createCategory(newCategoryName.trim(), newCategoryDesc.trim());
      setNewCategoryName("");
      setNewCategoryDesc("");
    })();
  }, [sessionId, newCategoryName, newCategoryDesc, ideaState]);

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
    <div className="side-section planning-inspector">
      <div className="side-section-header">
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
            className="btn-icon btn-icon-sm"
            title="Collapse planning inspector"
            type="button"
            onClick={onToggleCollapse}
          >
            <X size={11} />
          </button>
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
          onCreatePlan={onCreatePlan}
          onEditPlan={onEditPlan}
          onFocusPlan={onFocusPlan}
          onSetPlanStatus={onSetPlanStatus}
          onDeletePlan={onDeletePlan}
          onCopyReference={onCopyReference}
          onOpenInTerminal={onOpenInTerminal}
          onOpenChatSession={onOpenChatSession}
          showHeader={false}
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
          <div className="inspector-ideas-list">
            {filteredIdeas.length === 0 ? (
              <p className="text-muted text-sm">No ideas {statusFilter === "all" ? "yet" : `in ${statusFilter}`}.</p>
            ) : null}
            {filteredIdeas.map((idea) => (
              <div key={idea.id} className={`chat-idea-card chat-idea-status-${idea.status}`}>
                <div className="chat-idea-card-top">
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
                <div className="empty-state" style={{ padding: "16px" }}>
                  <FolderTree size={24} />
                  <p className="text-muted text-sm">No categories yet.</p>
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title="Generate categories from the project schematic"
                    onClick={() => onSuggestForCategory?.(null)}
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
    </div>
  );
}

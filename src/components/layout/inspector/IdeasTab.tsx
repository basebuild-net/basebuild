import type { Dispatch, SetStateAction } from "react";
import { Archive, Loader2, Rocket, Sparkles, Trash2, X } from "lucide-react";
import type { Idea, IdeaStatus } from "../../../lib/ideas";
import type { GroundingMetadata } from "../../../lib/native-chat";
import type { ParsedIdeaBatch } from "../../panels/IdeaReviewWorkbench";
import { IdeaBatchPreview, IdeaReviewWorkbench } from "../../panels/IdeaReviewWorkbench";
import { IdeaAssessmentSummary } from "../../planning/IdeaAssessmentSummary";
import { ActionMenu } from "../../ActionMenu";
import { formatRelativeTime } from "../../../lib/timing";
import type { IdeaStateValue } from "../../../state/ideas";
import { SkeletonRows } from "../Loading";

/** Epoch seconds (Rust) or milliseconds (JS) → milliseconds. */
const toMs = (ts: number) => (ts < 1_000_000_000_000 ? ts * 1000 : ts);

const STATUS_FILTERS: { value: IdeaStatus | "all"; label: string }[] = [
  { value: "all", label: "Active" },
  { value: "concept", label: "Concept" },
  { value: "picked", label: "Picked" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Deferred" },
];
export type IdeaHistoryBatch = { key: string; ideas: Idea[]; batch: ParsedIdeaBatch };

type IdeasTabProps = {
  statusFilter: IdeaStatus | "all";
  setStatusFilter: Dispatch<SetStateAction<IdeaStatus | "all">>;
  grounding: GroundingMetadata | null;
  onGenerateFromFinishedPlans?: () => void;
  selectedIdeaIds: Set<string>;
  setSelectedIdeaIds: Dispatch<SetStateAction<Set<string>>>;
  handleBatchPromote: () => void;
  handleRejectSelected: () => void;
  batchResult: string | null;
  openIdeaHistory: IdeaHistoryBatch | null;
  projectPath: string | null;
  openIdeaHistoryIndex: number;
  setOpenIdeaHistoryIndex: Dispatch<SetStateAction<number>>;
  setOpenIdeaHistoryKey: Dispatch<SetStateAction<string | null>>;
  ideaHistoryBatches: IdeaHistoryBatch[];
  displayedIdeas: Idea[];
  onStartIdeaRound?: () => void;
  expandedIdeaId: string | null;
  setExpandedIdeaId: Dispatch<SetStateAction<string | null>>;
  promotingIdeaId: string | null;
  handlePromoteIdea: (idea: { id: string; title: string; description: string }) => void;
  ideaState: IdeaStateValue;
};

export function IdeasTab({
  statusFilter,
  setStatusFilter,
  grounding,
  onGenerateFromFinishedPlans,
  selectedIdeaIds,
  setSelectedIdeaIds,
  handleBatchPromote,
  handleRejectSelected,
  batchResult,
  openIdeaHistory,
  projectPath,
  openIdeaHistoryIndex,
  setOpenIdeaHistoryIndex,
  setOpenIdeaHistoryKey,
  ideaHistoryBatches,
  displayedIdeas,
  onStartIdeaRound,
  expandedIdeaId,
  setExpandedIdeaId,
  promotingIdeaId,
  handlePromoteIdea,
  ideaState,
}: IdeasTabProps) {
  return (
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
      {openIdeaHistory ? (
        <IdeaReviewWorkbench
          {...openIdeaHistory.batch}
          toolId={openIdeaHistory.key}
          status="success"
          ideas={openIdeaHistory.ideas}
          projectPath={projectPath ?? undefined}
          currentIndex={openIdeaHistoryIndex}
          showContinue={false}
          readOnly
          onCurrentIndexChange={setOpenIdeaHistoryIndex}
          onMinimize={() => setOpenIdeaHistoryKey(null)}
        />
      ) : (
      <div className="inspector-ideas-list">
        {ideaHistoryBatches.map(({ key, ideas, batch }) => (
          <IdeaBatchPreview
            key={key}
            {...batch}
            status="success"
            ideas={ideas}
            onOpen={() => {
              setOpenIdeaHistoryIndex(0);
              setOpenIdeaHistoryKey(key);
            }}
          />
        ))}
        {ideaState.loading && displayedIdeas.length === 0 && ideaHistoryBatches.length === 0 ? (
          <SkeletonRows rows={3} label="Loading ideas…" />
        ) : displayedIdeas.length === 0 && ideaHistoryBatches.length === 0 ? (
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
        {displayedIdeas.map((idea) => (
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
              <button
                className="chat-idea-title chat-idea-title-toggle"
                type="button"
                title={expandedIdeaId === idea.id ? "Collapse assessment and evidence" : "Show assessment and evidence"}
                onClick={() => setExpandedIdeaId((current) => (current === idea.id ? null : idea.id))}
              >
                {idea.title}
              </button>
              <span className="chat-idea-date text-muted" title={`Captured ${new Date(toMs(idea.createdAt)).toLocaleString()}`}>
                {formatRelativeTime(idea.createdAt)}
              </span>
              {idea.status === "concept" ? (
                <div className="chat-idea-card-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title={`Create and prepare an OpenSpec plan for ${idea.title}`}
                    disabled={promotingIdeaId === idea.id}
                    onClick={() => void handlePromoteIdea(idea)}
                  >
                    {promotingIdeaId === idea.id ? <Loader2 size={11} className="is-spinning" /> : <Rocket size={11} />}
                    {promotingIdeaId === idea.id ? "Getting plan ready…" : "Make plan"}
                  </button>
                </div>
              ) : (
                <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                  {idea.status === "picked" ? "Planned" : idea.status === "rejected" ? "Rejected" : idea.status}
                </span>
              )}
              <ActionMenu
                triggerTitle="More idea actions"
                items={[
                  ...(idea.status === "concept" ? [
                    {
                      key: "pass",
                      label: "Pass",
                      title: `Pass on ${idea.title}`,
                      icon: <X size={12} />,
                      disabled: promotingIdeaId === idea.id,
                      onSelect: () => void ideaState.rejectIdea(idea.id),
                    },
                    {
                      key: "defer",
                      label: "Defer",
                      title: `Defer ${idea.title} for later`,
                      icon: <Archive size={12} />,
                      disabled: promotingIdeaId === idea.id,
                      onSelect: () => void ideaState.updateIdeaStatus(idea.id, "archived"),
                    },
                  ] : []),
                  {
                    key: "delete",
                    label: "Delete",
                    title: "Delete this idea",
                    icon: <Trash2 size={12} />,
                    danger: true,
                    onSelect: () => void ideaState.removeIdea(idea.id),
                  },
                ]}
              />
            </div>
            {idea.description ? (
              <p className={`chat-idea-desc${expandedIdeaId === idea.id ? " is-expanded" : ""}`}>{idea.description}</p>
            ) : null}
            {expandedIdeaId === idea.id ? (
              <>
                <IdeaAssessmentSummary
                  assessment={idea.assessment}
                  grounding={idea.grounding}
                  anchor={idea.anchor}
                  compact
                />
                {(idea.anchor || idea.grounding) ? (
                  <span
                    className="idea-card-evidence"
                    title={idea.grounding || "Grounded in the project schematic"}
                  >
                    {idea.anchor || "Project grounded"}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

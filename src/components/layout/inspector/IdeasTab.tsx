import type { Dispatch, SetStateAction } from "react";
import { Archive, Loader2, Rocket, Sparkles, Trash2, X } from "lucide-react";
import type { Idea, IdeaStatus } from "../../../lib/ideas";
import type { GroundingMetadata } from "../../../lib/native-chat";
import type { ParsedIdeaBatch } from "../../panels/IdeaReviewWorkbench";
import { IdeaBatchPreview, IdeaReviewWorkbench } from "../../panels/IdeaReviewWorkbench";
import { IdeaAssessmentSummary } from "../../planning/IdeaAssessmentSummary";
import { ActionMenu } from "../../ActionMenu";
import type { IdeaStateValue } from "../../../state/ideas";
import { SkeletonRows } from "../Loading";
import { t } from "../../../i18n";
import { formatDateTime, formatRelativeTime } from "../../../i18n/format";

/** Epoch seconds (Rust) or milliseconds (JS) → milliseconds. */
const toMs = (ts: number) => (ts < 1_000_000_000_000 ? ts * 1000 : ts);

const STATUS_FILTERS = (): { value: IdeaStatus | "all"; label: string }[] => [
  { value: "all", label: t("ideasTab.active") },
  { value: "concept", label: t("ideasTab.concept") },
  { value: "picked", label: t("ideasTab.picked2") },
  { value: "rejected", label: t("ideasTab.rejected3") },
  { value: "archived", label: t("ideasTab.deferred") },
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
        {STATUS_FILTERS().map((f) => (
          <button
            key={f.value}
            className={`inspector-filter-chip${statusFilter === f.value ? " is-active" : ""}`}
            type="button"
            title={t("ideasTab.filter", { label: f.label })}
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
              ? t("ideasTab.finishedPlans", { value: grounding.finishedPlans.join(", ") })
              : t("ideasTab.noFinishedPlansSinceLast")
          }
        >
          <span className="idea-batch-header-label">{t("ideasTab.groundedIn")}</span>
          {grounding.schematicSections.length > 0 ? (
            <span className="idea-batch-header-sections">
              {grounding.schematicSections.join(" · ")}
            </span>
          ) : (
            <span className="idea-batch-header-sections text-muted">{t("ideasTab.noSchematicSections")}</span>
          )}
          <span className="idea-batch-header-counts">
            {grounding.finishedPlanCount > 0
              ? t((grounding.finishedPlanCount > 1 ? "ideasTab.finishedPlan.s" : "ideasTab.finishedPlan.none"), { finishedPlanCount: grounding.finishedPlanCount })
              : t("ideasTab.noFinishedPlans")}
            {grounding.pickedCount > 0 ? t("ideasTab.picked", { pickedCount: grounding.pickedCount }) : ""}
            {grounding.rejectedCount > 0 ? t("ideasTab.rejected2", { rejectedCount: grounding.rejectedCount }) : ""}
          </span>
          {grounding.digestEmpty ? (
            <span className="idea-batch-header-empty text-muted">
              {t("ideasTab.noDecisionsSinceSchematicUpdate")}
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
              ? t((grounding.finishedPlanCount > 1 ? "ideasTab.generateIdeasWeightedByFinishedPlan.s" : "ideasTab.generateIdeasWeightedByFinishedPlan.none"), { finishedPlanCount: grounding.finishedPlanCount })
              : t("ideasTab.noFinishedPlansSinceLast2")
          }
          onClick={() => onGenerateFromFinishedPlans()}
        >
          <Sparkles size={11} /> {t("ideasTab.generateFromFinishedPlans")}
        </button>
      ) : null}
      {selectedIdeaIds.size > 0 ? (
        <div className="inspector-batch-bar" title={t("ideasTab.batchActionsForSelectedConcept")}>
          <span className="text-sm">{t("ideasTab.selected", { size: selectedIdeaIds.size })}</span>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title={t("ideasTab.promoteSelectedIdeasIntoPlans")}
            onClick={() => void handleBatchPromote()}
          >
            {t("ideasTab.approveSelected")}
          </button>
          <button
            className="btn btn-sm"
            type="button"
            title={t("ideasTab.rejectAllSelectedIdeas")}
            onClick={() => void handleRejectSelected()}
          >
            {t("ideasTab.rejectAll")}
          </button>
          <button
            className="btn btn-sm"
            type="button"
            title={t("ideasTab.clearSelection")}
            onClick={() => setSelectedIdeaIds(new Set())}
          >
            {t("ideasTab.clear")}
          </button>
        </div>
      ) : null}
      {batchResult ? <p className="text-sm text-muted">{batchResult}</p> : null}
      {openIdeaHistory ? (
        <IdeaReviewWorkbench
          {...openIdeaHistory.batch}
          toolId={openIdeaHistory.key}
          status={t("ideasTab.success")}
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
            status={t("ideasTab.success2")}
            ideas={ideas}
            onOpen={() => {
              setOpenIdeaHistoryIndex(0);
              setOpenIdeaHistoryKey(key);
            }}
          />
        ))}
        {ideaState.loading && displayedIdeas.length === 0 && ideaHistoryBatches.length === 0 ? (
          <SkeletonRows rows={3} label={t("ideasTab.loadingIdeas")} />
        ) : displayedIdeas.length === 0 && ideaHistoryBatches.length === 0 ? (
          <div className="inspector-ideas-empty">
            <p className="text-muted text-sm">{statusFilter === "all" ? t("ideasTab.noIdeasYet") : t("ideasTab.noIdeasIn", { statusFilter: statusFilter })}</p>
            {onStartIdeaRound && statusFilter === "all" ? (
              <button
                className="btn btn-sm btn-primary"
                type="button"
                title={t("ideasTab.generateIdeasOneClickRound")}
                onClick={() => onStartIdeaRound()}
              >
                <Sparkles size={11} /> {t("ideasTab.generateIdeas")}
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
                  title={t("ideasTab.selectForBatchPromote")}
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
                title={expandedIdeaId === idea.id ? t("ideasTab.collapseAssessmentAndEvidence") : t("ideasTab.showAssessmentAndEvidence")}
                onClick={() => setExpandedIdeaId((current) => (current === idea.id ? null : idea.id))}
              >
                {idea.title}
              </button>
              <span className="chat-idea-date text-muted" title={t("ideasTab.captured", { toLocaleString: formatDateTime(new Date(toMs(idea.createdAt))) })}>
                {formatRelativeTime(idea.createdAt)}
              </span>
              {idea.status === "concept" ? (
                <div className="chat-idea-card-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title={t("ideasTab.createAndPrepareAnOpenSpecPlan", { title: idea.title })}
                    disabled={promotingIdeaId === idea.id}
                    onClick={() => void handlePromoteIdea(idea)}
                  >
                    {promotingIdeaId === idea.id ? <Loader2 size={11} className="is-spinning" /> : <Rocket size={11} />}
                    {promotingIdeaId === idea.id ? t("ideasTab.gettingPlanReady") : t("ideasTab.makePlan")}
                  </button>
                </div>
              ) : (
                <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                  {idea.status === "picked" ? t("ideasTab.planned") : idea.status === "rejected" ? t("ideasTab.rejected") : idea.status}
                </span>
              )}
              <ActionMenu
                triggerTitle={t("ideasTab.moreIdeaActions")}
                items={[
                  ...(idea.status === "concept" ? [
                    {
                      key: "pass",
                      label: t("ideasTab.pass"),
                      title: t("ideasTab.passOn", { title: idea.title }),
                      icon: <X size={12} />,
                      disabled: promotingIdeaId === idea.id,
                      onSelect: () => void ideaState.rejectIdea(idea.id),
                    },
                    {
                      key: "defer",
                      label: t("ideasTab.defer"),
                      title: t("ideasTab.deferForLater", { title: idea.title }),
                      icon: <Archive size={12} />,
                      disabled: promotingIdeaId === idea.id,
                      onSelect: () => void ideaState.updateIdeaStatus(idea.id, "archived"),
                    },
                  ] : []),
                  {
                    key: "delete",
                    label: t("ideasTab.delete"),
                    title: t("ideasTab.deleteThisIdea"),
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
                    title={idea.grounding || t("ideasTab.groundedInTheProjectSchematic")}
                  >
                    {idea.anchor || t("ideasTab.projectGrounded")}
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

import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Lightbulb, Loader2, Minus, Rocket, Sparkles, X } from "lucide-react";
import type { Idea } from "../../lib/ideas";
import { parseImplementationAssessment, type ImplementationAssessment } from "../../lib/planning-assessment";
import { IdeaAssessmentSummary } from "../planning/IdeaAssessmentSummary";
import { ExecutionAdvisorCard } from "../planning/ExecutionAdvisorCard";
import { WorkbenchShell } from "./WorkbenchShell";
import { t } from "../../i18n";

export type ProposedIdea = {
  title: string;
  description: string;
  grounding?: string;
  anchor?: string;
  assessment?: ImplementationAssessment;
};

export type ParsedIdeaBatch = {
  proposals: ProposedIdea[];
  categoryId: string | null;
};

type IdeaReviewWorkbenchProps = ParsedIdeaBatch & {
  toolId: string;
  status: string;
  ideas: Idea[];
  projectPath?: string;
  currentIndex: number;
  showContinue: boolean;
  readOnly?: boolean;
  onCurrentIndexChange: (index: number) => void;
  onMinimize: () => void;
  onPromote?: (idea: Idea) => Promise<void>;
  onReject?: (idea: Idea) => Promise<void>;
  onDefer?: (idea: Idea) => Promise<void>;
  /** Persist a proposal whose original capture failed, so decisions unlock. */
  onCapture?: (proposal: ProposedIdea, categoryId: string | null) => Promise<void>;
  onContinue?: (categoryId: string | null) => void;
  onReviewed?: () => void;
};

type IdeaBatchPreviewProps = ParsedIdeaBatch & {
  status: string;
  ideas: Idea[];
  onOpen: () => void;
};

export function parseIdeaBatch(parsedArgs: unknown): ParsedIdeaBatch | null {
  if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) return null;
  const record = parsedArgs as Record<string, unknown>;
  if (!Array.isArray(record.ideas)) return null;
  const proposals = record.ideas.flatMap((value): ProposedIdea[] => {
    if (
      typeof value !== "object"
      || value === null
      || typeof (value as ProposedIdea).title !== "string"
      || typeof (value as ProposedIdea).description !== "string"
    ) {
      return [];
    }
    const candidate = value as Record<string, unknown>;
    return [{
      title: candidate.title as string,
      description: candidate.description as string,
      grounding: typeof candidate.grounding === "string" ? candidate.grounding : undefined,
      anchor: typeof candidate.anchor === "string" ? candidate.anchor : undefined,
      assessment: parseImplementationAssessment(candidate.assessment),
    }];
  });
  return {
    proposals,
    categoryId: typeof record.categoryId === "string" ? record.categoryId : null,
  };
}

function findPersistedIdea(proposal: ProposedIdea, ideas: Idea[]): Idea | undefined {
  return ideas.find((candidate) => (
    candidate.title === proposal.title
    && candidate.description === proposal.description
  )) ?? ideas.find((candidate) => candidate.title === proposal.title);
}

function statusLabel(status: Idea["status"]): string {
  if (status === "picked") return t("ideaReviewWorkbench.planStarted");
  if (status === "rejected") return t("ideaReviewWorkbench.passed");
  if (status === "archived") return t("ideaReviewWorkbench.deferred");
  return t("ideaReviewWorkbench.needsReview");
}

export function IdeaBatchPreview({ proposals, status, ideas, onOpen }: IdeaBatchPreviewProps) {
  const isRunning = status === "running" || status === "pending";
  const linked = proposals.map((proposal) => findPersistedIdea(proposal, ideas));
  const counts = {
    picked: linked.filter((idea) => idea?.status === "picked").length,
    passed: linked.filter((idea) => idea?.status === "rejected").length,
    deferred: linked.filter((idea) => idea?.status === "archived").length,
    remaining: linked.filter((idea) => !idea || idea.status === "concept").length,
  };
  const ideaLabel = `${proposals.length} ${proposals.length === 1 ? "idea" : "ideas"}`;
  const isReviewed = !isRunning && counts.remaining === 0;

  return (
    <button
      type="button"
      className="chat-idea-batch-preview idea-history-preview"
      title={isRunning ? t("ideaReviewWorkbench.openTheActiveIdeaGeneration") : t("ideaReviewWorkbench.openThisIdeaBatchIn")}
      onClick={onOpen}
    >
      <span className="chat-idea-batch-preview-icon" aria-hidden="true">
        {isRunning ? <Loader2 size={15} className="is-spinning" /> : <Lightbulb size={15} />}
      </span>
      <span className="chat-idea-batch-preview-copy">
        <strong>{isRunning ? t("ideaReviewWorkbench.buildingAGroundedIdeaBatch") : isReviewed ? t("ideaReviewWorkbench.reviewed", { ideaLabel: ideaLabel }) : t("ideaReviewWorkbench.readyForReview", { ideaLabel: ideaLabel })}</strong>
        <span>
          {isRunning
            ? t("ideaReviewWorkbench.receivedSoFarOpenToFollow", { proposalsCount: proposals.length })
            : t("ideaReviewWorkbench.plannedPassedDeferredRemaining", { picked: counts.picked, passed: counts.passed, deferred: counts.deferred, remaining: counts.remaining })}
        </span>
      </span>
      <span className="chat-idea-batch-preview-action">{isRunning ? t("ideaReviewWorkbench.viewProgress") : isReviewed ? t("ideaReviewWorkbench.viewHistory") : t("ideaReviewWorkbench.reviewBatch")}</span>
    </button>
  );
}

export function IdeaReviewWorkbench({
  toolId,
  status,
  proposals,
  categoryId,
  ideas,
  projectPath,
  currentIndex,
  readOnly = false,
  showContinue,
  onCurrentIndexChange,
  onMinimize,
  onPromote,
  onReject,
  onDefer,
  onCapture,
  onContinue,
  onReviewed,
}: IdeaReviewWorkbenchProps) {
  const [busyAction, setBusyAction] = useState<"promote" | "reject" | "defer" | "capture" | null>(null);
  const isRunning = status === "running" || status === "pending";
  const linkedIdeas = useMemo(
    () => proposals.map((proposal) => findPersistedIdea(proposal, ideas)),
    [ideas, proposals],
  );
  const boundedIndex = Math.max(0, Math.min(currentIndex, Math.max(0, proposals.length - 1)));
  const proposal = proposals[boundedIndex];
  const idea = linkedIdeas[boundedIndex];
  const decidedCount = linkedIdeas.filter((candidate) => candidate && candidate.status !== "concept").length;
  const allReviewed = proposals.length > 0 && decidedCount === proposals.length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onMinimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMinimize]);

  useEffect(() => {
    if (currentIndex !== boundedIndex) onCurrentIndexChange(boundedIndex);
  }, [boundedIndex, currentIndex, onCurrentIndexChange]);

  const runAction = async (action: "promote" | "reject" | "defer") => {
    if (!idea) return;
    setBusyAction(action);
    try {
      if (action === "promote") await onPromote?.(idea);
      else if (action === "reject") await onReject?.(idea);
      else await onDefer?.(idea);

      const nextIndex = linkedIdeas.findIndex((candidate, index) => index > boundedIndex && (!candidate || candidate.status === "concept"));
      if (nextIndex >= 0) onCurrentIndexChange(nextIndex);
      else {
        const wrappedIndex = linkedIdeas.findIndex((candidate, index) => index < boundedIndex && (!candidate || candidate.status === "concept"));
        if (wrappedIndex >= 0) onCurrentIndexChange(wrappedIndex);
        else onReviewed?.();
      }
    } finally {
      setBusyAction(null);
    }
  };
  // Recovery path: the proposal streamed in but its capture never persisted
  // (e.g. the propose_ideas tool call failed), so no decisions can bind.
  const runCapture = async () => {
    if (!proposal || !onCapture) return;
    setBusyAction("capture");
    try {
      await onCapture(proposal, categoryId);
    } finally {
      setBusyAction(null);
    }
  };

  const headerActions = (
    <button className="btn-icon" type="button" title={readOnly ? t("ideaReviewWorkbench.closeIdeaHistory") : t("ideaReviewWorkbench.minimizeIdeaReview")} onClick={onMinimize}>
      {readOnly ? <X size={16} /> : <Minus size={16} />}
    </button>
  );
  const footer = (
    <>
      <div className="interaction-page-actions">
        <button className="btn btn-sm" type="button" title={t("ideaReviewWorkbench.previousIdea")} disabled={boundedIndex === 0 || busyAction !== null} onClick={() => onCurrentIndexChange(boundedIndex - 1)}>
          <ChevronLeft size={14} /> {t("ideaReviewWorkbench.back")}
        </button>
        <button className="btn btn-sm" type="button" title={t("ideaReviewWorkbench.nextIdea")} disabled={boundedIndex >= proposals.length - 1 || busyAction !== null} onClick={() => onCurrentIndexChange(boundedIndex + 1)}>
          {t("ideaReviewWorkbench.next")} <ChevronRight size={14} />
        </button>
      </div>
      {idea?.status === "concept" ? (
        <div className="idea-review-actions" aria-label={t("ideaReviewWorkbench.ideaDecisionActions")}>
          <button className="btn btn-sm btn-ghost" type="button" title={t("ideaReviewWorkbench.deferForLater", { title: proposal?.title ?? t("ideaReviewWorkbench.thisIdea") })} disabled={busyAction !== null} onClick={() => void runAction("defer")}>
            {busyAction === "defer" ? <Loader2 size={12} className="is-spinning" /> : <Archive size={12} />} {t("ideaReviewWorkbench.defer")}
          </button>
          <button className="btn btn-sm" type="button" title={t("ideaReviewWorkbench.passOn", { title: proposal?.title ?? t("ideaReviewWorkbench.thisIdea2") })} disabled={busyAction !== null} onClick={() => void runAction("reject")}>
            {busyAction === "reject" ? <Loader2 size={12} className="is-spinning" /> : <X size={12} />} {t("ideaReviewWorkbench.pass")}
          </button>
          <button className="btn btn-sm btn-primary" type="button" title={t("ideaReviewWorkbench.createAndPrepareAnOpenSpecPlan", { title: proposal?.title ?? t("ideaReviewWorkbench.thisIdea3") })} disabled={busyAction !== null} onClick={() => void runAction("promote")}>
            {busyAction === "promote" ? <Loader2 size={12} className="is-spinning" /> : <Rocket size={12} />} {busyAction === "promote" ? t("ideaReviewWorkbench.preparing") : t("ideaReviewWorkbench.makePlan")}
          </button>
        </div>
      ) : !isRunning && !readOnly && !idea && proposal && onCapture ? (
        <div className="idea-review-actions" aria-label={t("ideaReviewWorkbench.ideaRecoveryActions")}>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            title={t("ideaReviewWorkbench.thisProposalWasNotSavedTo", { title: proposal.title })}
            disabled={busyAction !== null}
            onClick={() => void runCapture()}
          >
            {busyAction === "capture" ? <Loader2 size={12} className="is-spinning" /> : <Lightbulb size={12} />} {busyAction === "capture" ? t("ideaReviewWorkbench.saving") : t("ideaReviewWorkbench.saveToIdeas")}
          </button>
        </div>
      ) : allReviewed && showContinue ? (
        <button className="btn btn-sm btn-primary" type="button" title={t("ideaReviewWorkbench.generateAnotherGroundedIdeaBatch")} onClick={() => onContinue?.(categoryId)}>
          <Sparkles size={12} /> {t("ideaReviewWorkbench.moreIdeas")}
        </button>
      ) : idea ? (
        <span className={`idea-review-decision is-${idea.status}`}>{statusLabel(idea.status)}</span>
      ) : null}
    </>
  );

  return (
    <WorkbenchShell
      ariaLabel={readOnly ? t("ideaReviewWorkbench.reviewedIdeas", { length: proposals.length }) : t("ideaReviewWorkbench.generatedIdeas", { length: proposals.length })}
      eyebrow={<><Lightbulb size={14} /> {readOnly ? t("ideaReviewWorkbench.ideaHistory") : t("ideaReviewWorkbench.ideaStudioReview")}</>}
      title={readOnly ? t("ideaReviewWorkbench.reviewCompletedDecisions") : isRunning ? t("ideaReviewWorkbench.findingIdeasWorthYourTime") : t("ideaReviewWorkbench.chooseWhatDeservesAPlan")}
      description={readOnly ? t("ideaReviewWorkbench.theseDecisionsAreReadOnlyBecause") : isRunning ? t("ideaReviewWorkbench.theBatchStaysFocusedHereWhile") : t("ideaReviewWorkbench.reviewOneOptionAtATime")}
      headerActions={headerActions}
      progressLabel={proposals.length > 0 ? t("ideaReviewWorkbench.ideaOf", { v1: boundedIndex + 1, length: proposals.length }) : t("ideaReviewWorkbench.preparingBatch")}
      progressTitle={readOnly ? t("ideaReviewWorkbench.completedDecisions", { decidedCount }) : proposals.length > 0 ? t("ideaReviewWorkbench.decidedRemaining", { decidedCount, value2: proposals.length - decidedCount }) : t("ideaReviewWorkbench.waitingForGroundedProposals")}
      footer={proposals.length > 0 ? footer : undefined}
      className="idea-review-workbench"
    >
      {proposal ? (
        <article className="idea-review-card idea-proposal-card" data-tool-id={toolId}>
          <div className="idea-review-title-row">
            <div>
              <span className="idea-review-sequence">{t("ideaReviewWorkbench.option", { value: boundedIndex + 1 })}</span>
              <h3>{proposal.title}</h3>
            </div>
            {idea && idea.status !== "concept" ? <span className={`idea-review-decision is-${idea.status}`}>{statusLabel(idea.status)}</span> : null}
          </div>
          <p className="idea-review-description">{proposal.description}</p>
          <IdeaAssessmentSummary
            assessment={idea?.assessment ?? proposal.assessment}
            grounding={idea?.grounding ?? proposal.grounding}
            anchor={idea?.anchor ?? proposal.anchor}
          />
          {!isRunning && !readOnly && !idea ? (
            <p className="text-sm text-muted" title={t("ideaReviewWorkbench.theProposeIdeasCaptureFailed")}>
              {t("ideaReviewWorkbench.notSavedToTheIdea")}
            </p>
          ) : null}
          {projectPath && idea?.assessment ? (
            <ExecutionAdvisorCard projectPath={projectPath} ideaId={idea.id} />
          ) : null}
        </article>
      ) : (
        <div className="idea-review-loading" role="status">
          <Loader2 size={18} className="is-spinning" />
          <span>{t("ideaReviewWorkbench.theModelIsCheckingThe")}</span>
        </div>
      )}
    </WorkbenchShell>
  );
}

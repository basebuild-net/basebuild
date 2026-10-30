import { useEffect, useState } from "react";
import { Check, GitBranch, GitCommit, GitPullRequest, ListChecks, Loader2, Play, X } from "lucide-react";

import type { PlanRun, FinishOutcome } from "../../lib/planRuns";
import { openspecTaskProgress } from "../../lib/openspec";
import { LoadingBlock } from "../layout/Loading";
import { t } from "../../i18n";

type CompletionCardProps = {
  run: PlanRun;
  projectPath: string;
  finishOutcome?: FinishOutcome | null;
  changeName?: string | null;
  onMarkComplete: (runId: string) => Promise<void>;
  onReviewTasks?: () => void;
  onResume?: () => void;
  onDismiss: () => void;
};
export function CompletionCard({
  run,
  projectPath,
  finishOutcome,
  changeName,
  onMarkComplete,
  onReviewTasks,
  onResume,
  onDismiss,
}: CompletionCardProps) {
  const [busy, setBusy] = useState<"complete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<{ completed: number; total: number } | null>(null);
  // True while the task-progress fetch below is in flight. Without it the card
  // asserted "task progress is unavailable" against a not-yet-fetched value.
  const [progressLoading, setProgressLoading] = useState(Boolean(changeName && projectPath));

  const isAwaitingReview = run.status === "awaiting_review";
  const isSucceeded = run.status === "succeeded";

  useEffect(() => {
    if (!changeName || !projectPath) {
      // Nothing to load is a settled state, not a pending one.
      setProgressLoading(false);
      return;
    }
    let cancelled = false;
    setProgressLoading(true);
    void openspecTaskProgress(projectPath, changeName)
      .then((progress) => {
        if (!cancelled) setTaskProgress(progress);
      })
      .catch(() => {
        if (!cancelled) setTaskProgress(null);
      })
      .finally(() => {
        if (!cancelled) setProgressLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [changeName, projectPath]);

  // Ordering matters: while `progressLoading` is set there is no blocking
  // reason to report yet, only an unknown one. The action stays disabled via
  // `progressLoading` instead of via a fabricated reason.
  const completionBlockedReason = !changeName
    ? null
    : !projectPath
      ? t("completionCard.cannotMarkCompleteNoProjectIs")
      : progressLoading
        ? null
        : taskProgress === null
          ? t("completionCard.cannotMarkCompleteTaskProgressIs")
          : taskProgress.total === 0
            ? t("completionCard.cannotMarkCompleteTheLinkedOpenspec")
            : taskProgress.completed < taskProgress.total
              ? t("completionCard.cannotMarkCompleteRequiredOpenspecTasks", { completed: taskProgress.completed, total: taskProgress.total })
              : null;

  const handleMarkComplete = async () => {
    setBusy("complete");
    setError(null);
    try {
      await onMarkComplete(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };


  return (
    <div className="completion-card">
      <div className="completion-card-header">
        <span className="completion-card-title">
          <Check size={12} /> {t("completionCard.runTitle", { id: run.id.slice(0, 8), status: isAwaitingReview ? t("completionCard.awaitingReview") : t("completionCard.complete") })}
        </span>
        <button className="btn-icon btn-icon-sm" type="button" title={t("completionCard.dismiss")} onClick={onDismiss}>
          <X size={11} />
        </button>
      </div>

      <div className="completion-card-body">
        <div className="completion-card-meta">
          <span className="completion-card-meta-row" title={projectPath}>
            <GitBranch size={10} /> {projectPath}
          </span>
          {run.workspacePath ? (
            <span className="completion-card-meta-row" title={run.workspacePath}>
              <GitBranch size={10} /> {run.workspacePath}
            </span>
          ) : null}
        </div>

        {isAwaitingReview ? (
          <div className="completion-card-notice">
            {progressLoading ? (
              <LoadingBlock label={t("completionCard.checkingOpenspecTaskProgress")} compact />
            ) : (
              completionBlockedReason ?? t("completionCard.checklistCompleteReviewTheWork")
            )}
          </div>
        ) : null}
        {finishOutcome ? (
          <div className="completion-card-outcome" title={t("completionCard.finishPolicy", { policy: finishOutcome.policy })}>
            {finishOutcome.commitSha ? (
              <span className="completion-card-outcome-row">
                <GitCommit size={10} /> {t("completionCard.committed")} <code>{finishOutcome.commitSha.slice(0, 8)}</code>
              </span>
            ) : null}
            {finishOutcome.prUrl ? (
              <span className="completion-card-outcome-row">
                <GitPullRequest size={10} /> <a href={finishOutcome.prUrl} target="_blank" rel="noopener noreferrer" title={t("completionCard.openPullRequest", { prUrl: finishOutcome.prUrl })}>{finishOutcome.prUrl}</a>
              </span>
            ) : null}
            {finishOutcome.mergeReady ? (
              <span className="completion-card-outcome-row">
                <Check size={10} /> {t("completionCard.queuedForMergeReview")}
              </span>
            ) : null}
            {finishOutcome.error ? (
              <span className="completion-card-outcome-row completion-card-outcome-error">
                {t("completionCard.policyError", { error: finishOutcome.error })}</span>
            ) : null}
          </div>
        ) : null}

        <div className="completion-card-actions">
          {isAwaitingReview ? (
            <>
            {onReviewTasks ? (
              <button
                type="button"
                className="btn btn-sm"
                title={t("completionCard.reviewTheLinkedOpenspecTasks")}
                onClick={onReviewTasks}
              >
                <ListChecks size={11} /> {t("completionCard.reviewTasks")}
              </button>
            ) : null}
            {onResume ? (
              <button
                type="button"
                className="btn btn-sm"
                title={t("completionCard.openPlanRunsToResume")}
                onClick={onResume}
              >
                <Play size={11} /> {t("completionCard.resume")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              title={completionBlockedReason ?? (progressLoading ? t("completionCard.checkingOpenspecTaskProgress") : t("completionCard.markThisRunAsComplete"))}
              disabled={busy !== null || progressLoading || completionBlockedReason !== null}
              onClick={() => void handleMarkComplete()}
            >
              {busy === "complete" || progressLoading ? <Loader2 size={11} className="bb-spin" /> : <Check size={11} />}
              {t("completionCard.markComplete")}
            </button>
            </>
          ) : null}

        </div>

        {error ? (
          <div className="completion-card-error" title={error}>{error}</div>
        ) : null}
      </div>
    </div>
  );
}

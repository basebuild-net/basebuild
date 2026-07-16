import { useEffect, useState } from "react";
import { Check, GitBranch, GitCommit, GitPullRequest, ListChecks, Loader2, Play, X } from "lucide-react";

import type { PlanRun, FinishOutcome } from "../../lib/planRuns";
import { openspecTaskProgress } from "../../lib/openspec";

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

  const isAwaitingReview = run.status === "awaiting_review";
  const isSucceeded = run.status === "succeeded";

  useEffect(() => {
    if (!changeName || !projectPath) return;
    let cancelled = false;
    void openspecTaskProgress(projectPath, changeName)
      .then((progress) => {
        if (!cancelled) setTaskProgress(progress);
      })
      .catch(() => {
        if (!cancelled) setTaskProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [changeName, projectPath]);

  const completionBlockedReason = !changeName
    ? null
    : !projectPath
      ? "Cannot mark complete: no project is open."
      : taskProgress === null
        ? "Cannot mark complete: task progress is unavailable."
        : taskProgress.total === 0
          ? "Cannot mark complete: the linked OpenSpec change has no required tasks."
          : taskProgress.completed < taskProgress.total
            ? `Cannot mark complete: ${taskProgress.completed}/${taskProgress.total} required OpenSpec tasks are complete.`
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
          <Check size={12} /> Run {run.id.slice(0, 8)} — {isAwaitingReview ? "Awaiting review" : "Complete"}
        </span>
        <button className="btn-icon btn-icon-sm" type="button" title="Dismiss" onClick={onDismiss}>
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
            {completionBlockedReason ?? "Checklist complete. Review the work or continue the plan before marking it complete."}
          </div>
        ) : null}
        {finishOutcome ? (
          <div className="completion-card-outcome" title={`Finish policy: ${finishOutcome.policy}`}>
            {finishOutcome.commitSha ? (
              <span className="completion-card-outcome-row">
                <GitCommit size={10} /> Committed: <code>{finishOutcome.commitSha.slice(0, 8)}</code>
              </span>
            ) : null}
            {finishOutcome.prUrl ? (
              <span className="completion-card-outcome-row">
                <GitPullRequest size={10} /> <a href={finishOutcome.prUrl} target="_blank" rel="noopener noreferrer" title={`Open pull request: ${finishOutcome.prUrl}`}>{finishOutcome.prUrl}</a>
              </span>
            ) : null}
            {finishOutcome.mergeReady ? (
              <span className="completion-card-outcome-row">
                <Check size={10} /> Queued for merge review
              </span>
            ) : null}
            {finishOutcome.error ? (
              <span className="completion-card-outcome-row completion-card-outcome-error">
                Policy error: {finishOutcome.error}
              </span>
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
                title="Review the linked OpenSpec tasks"
                onClick={onReviewTasks}
              >
                <ListChecks size={11} /> Review tasks
              </button>
            ) : null}
            {onResume ? (
              <button
                type="button"
                className="btn btn-sm"
                title="Open plan runs to resume this work"
                onClick={onResume}
              >
                <Play size={11} /> Resume
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              title={completionBlockedReason ?? "Mark this run as complete"}
              disabled={busy !== null || completionBlockedReason !== null}
              onClick={() => void handleMarkComplete()}
            >
              {busy === "complete" ? <Loader2 size={11} className="bb-spin" /> : <Check size={11} />}
              Mark complete
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

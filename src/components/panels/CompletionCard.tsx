import { useState } from "react";
import { Check, GitBranch, GitCommit, GitPullRequest, Loader2, X } from "lucide-react";

import type { PlanRun, FinishOutcome } from "../../lib/planRuns";

type CompletionCardProps = {
  run: PlanRun;
  projectPath: string;
  finishOutcome?: FinishOutcome | null;
  onMarkComplete: (runId: string) => Promise<void>;
  onDismiss: () => void;
};
export function CompletionCard({
  run,
  projectPath,
  finishOutcome,
  onMarkComplete,
  onDismiss,
}: CompletionCardProps) {
  const [busy, setBusy] = useState<"complete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAwaitingReview = run.status === "awaiting_review";
  const isSucceeded = run.status === "succeeded";

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
            Checklist incomplete. Review the remaining tasks, then mark complete or keep running.
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
            <button
              type="button"
              className="btn btn-sm btn-primary"
              title="Mark this run as complete"
              disabled={busy !== null}
              onClick={() => void handleMarkComplete()}
            >
              {busy === "complete" ? <Loader2 size={11} className="bb-spin" /> : <Check size={11} />}
              Mark complete
            </button>
          ) : null}

        </div>

        {error ? (
          <div className="completion-card-error" title={error}>{error}</div>
        ) : null}
      </div>
    </div>
  );
}

import { useState } from "react";
import { AlertCircle, Check, GitPullRequest, X } from "lucide-react";
import { prCreate, type PrRecommendation } from "../../lib/pullRequests";

/** Pull-request recommendation card (`plan-final-touches`).
 *
 * Surfaces on a finished worktree run: branch, ahead/behind, changed-file
 * summary, and a confirm-gated "Create pull request" action. Uses the `gh`
 * path when available+authed, else the browser compare-URL fallback. Dismiss
 * keeps the branch (no remote write). No token is stored.
 *
 * Always explicit + confirmed: the user must click "Create pull request"
 * then confirm before any push or PR creation runs. */

export type PrRecommendationCardProps = {
  projectPath: string;
  recommendation: PrRecommendation;
  onDismiss: () => void;
  onCreated?: (url: string | null) => void;
};

export function PrRecommendationCard({ projectPath, recommendation, onDismiss, onCreated }: PrRecommendationCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string | null; method: string } | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await prCreate(projectPath, recommendation.branch, "Automated PR", "");
      if (res.success) {
        setResult({ url: res.url, method: res.method });
        onCreated?.(res.url);
      } else {
        setError(res.error ?? "Failed to create pull request");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (result) {
    return (
      <div className="pr-recommendation-card" role="status">
        <div className="pr-recommendation-header">
          <Check size={12} />
          <span>Pull request {result.method === "gh" ? "created" : "opened"}</span>
        </div>
        {result.url ? (
          <a className="chat-link-btn" href={result.url} target="_blank" rel="noreferrer" title={result.url}>
            {result.url}
          </a>
        ) : null}
        <div className="pr-recommendation-actions">
          <button className="btn btn-sm" type="button" title="Dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pr-recommendation-card" role="status">
      <div className="pr-recommendation-header">
        <GitPullRequest size={12} />
        <span>Pull request ready</span>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Dismiss — the branch is kept locally"
          onClick={onDismiss}
        >
          <X size={11} />
        </button>
      </div>
      <div className="pr-recommendation-meta">
        <span title={`Branch: ${recommendation.branch}`}>⎇ {recommendation.branch}</span>
        <span title="Commits ahead/behind the default branch">+{recommendation.ahead} / −{recommendation.behind}</span>
        <span title="Changed files vs the default branch">{recommendation.changedFiles} files</span>
      </div>
      {recommendation.ghAvailable && !recommendation.ghAuthed ? (
        <div className="text-sm text-muted" title="gh is installed but not authenticated">
          <AlertCircle size={11} /> gh not authenticated — will open the browser compare URL.
        </div>
      ) : null}
      {confirming ? (
        <div className="pr-recommendation-confirm">
          <p className="text-sm">
            This will push <strong>{recommendation.branch}</strong> to origin
            {recommendation.ghAvailable && recommendation.ghAuthed ? " and create a pull request via gh" : " and open the compare URL in your browser"}.
          </p>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          <div className="pr-recommendation-actions">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              title="Confirm: push and create the pull request"
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              {creating ? "Creating…" : "Confirm & create"}
            </button>
            <button className="btn btn-sm" type="button" title="Cancel" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="pr-recommendation-actions">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            title="Create a pull request (confirm-gated)"
            onClick={() => setConfirming(true)}
          >
            <GitPullRequest size={11} /> Create pull request
          </button>
        </div>
      )}
    </div>
  );
}

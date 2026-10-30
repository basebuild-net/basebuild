import { useState } from "react";
import { AlertCircle, Check, GitPullRequest, X } from "lucide-react";
import { prCreate, type PrRecommendation } from "../../lib/pullRequests";
import { t } from "../../i18n";

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
      const res = await prCreate(projectPath, recommendation.branch, t("prRecommendationCard.automatedPr"), "");
      if (res.success) {
        setResult({ url: res.url, method: res.method });
        onCreated?.(res.url);
      } else {
        setError(res.error ?? t("prRecommendationCard.failedToCreatePullRequest"));
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
          <span>{result.method === "gh" ? t("prRecommendationCard.pullRequestCreated") : t("prRecommendationCard.pullRequestOpened")}</span>
        </div>
        {result.url ? (
          <a className="chat-link-btn" href={result.url} target="_blank" rel="noreferrer" title={result.url}>
            {result.url}
          </a>
        ) : null}
        <div className="pr-recommendation-actions">
          <button className="btn btn-sm" type="button" title={t("prRecommendationCard.dismiss")} onClick={onDismiss}>
            {t("prRecommendationCard.dismiss")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pr-recommendation-card" role="status">
      <div className="pr-recommendation-header">
        <GitPullRequest size={12} />
        <span>{t("prRecommendationCard.pullRequestReady")}</span>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={t("prRecommendationCard.dismissTheBranchIsKept")}
          onClick={onDismiss}
        >
          <X size={11} />
        </button>
      </div>
      <div className="pr-recommendation-meta">
        <span title={t("prRecommendationCard.branch", { branch: recommendation.branch })}>⎇ {recommendation.branch}</span>
        <span title={t("prRecommendationCard.commitsAheadBehindTheDefault")}>+{recommendation.ahead} / −{recommendation.behind}</span>
        <span title={t("prRecommendationCard.changedFilesVsTheDefault")}>{t("prRecommendationCard.files", { changedFiles: recommendation.changedFiles })}</span>
      </div>
      {recommendation.ghAvailable && !recommendation.ghAuthed ? (
        <div className="text-sm text-muted" title={t("prRecommendationCard.ghIsInstalledButNot")}>
          <AlertCircle size={11} /> {t("prRecommendationCard.ghNotAuthenticatedWillOpen")}
        </div>
      ) : null}
      {confirming ? (
        <div className="pr-recommendation-confirm">
          <p className="text-sm">
            {t(recommendation.ghAvailable && recommendation.ghAuthed ? "prRecommendationCard.confirmPushCreate" : "prRecommendationCard.confirmPushCompare", { branch: recommendation.branch })}
          </p>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          <div className="pr-recommendation-actions">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              title={t("prRecommendationCard.confirmPushAndCreateThe")}
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              {creating ? t("prRecommendationCard.creating") : t("prRecommendationCard.confirmCreate")}
            </button>
            <button className="btn btn-sm" type="button" title={t("prRecommendationCard.cancel")} onClick={() => setConfirming(false)}>
              {t("prRecommendationCard.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="pr-recommendation-actions">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            title={t("prRecommendationCard.createAPullRequestConfirm")}
            onClick={() => setConfirming(true)}
          >
            <GitPullRequest size={11} /> {t("prRecommendationCard.createPullRequest")}
          </button>
        </div>
      )}
    </div>
  );
}

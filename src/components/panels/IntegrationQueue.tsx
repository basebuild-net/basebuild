import { useEffect, useState } from "react";
import { Check, GitBranch, Trash2, ExternalLink } from "lucide-react";
import { integrationList, integrationCleanup, type IntegrationEntry } from "../../lib/integration";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { SkeletonRows } from "../layout/Loading";
import { t } from "../../i18n";

type IntegrationQueueProps = {
  sessionId: string | null;
  projectPath: string | null;
};

/// Integration queue: lists finished worktree runs with branch, ahead/behind,
/// merged state, and PR state. Confirm-gated cleanup actions.
export function IntegrationQueue({ sessionId, projectPath }: IntegrationQueueProps) {
  const [entries, setEntries] = useState<IntegrationEntry[]>([]);
  // Starts true: the mount effect below fetches, and the first commit
  // otherwise claimed "No finished runs to integrate."
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    runId: string;
    force: boolean;
  } | null>(null);

  useEffect(() => {
    if (!sessionId || !projectPath) {
      // Nothing to load is a settled state, not a pending one.
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const list = await integrationList(sessionId!, projectPath!);
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [sessionId, projectPath]);
  function handleCleanup(runId: string, merged: boolean) {
    if (!sessionId) return;
    setConfirm({ runId, force: !merged });
  }

  async function executeCleanup(runId: string, force: boolean) {
    if (!sessionId) return;
    try {
      await integrationCleanup(runId, force, sessionId);
      setEntries((prev) => prev.filter((e) => e.runId !== runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <p className="text-error text-sm">{error}</p>;
  if (loading) return <SkeletonRows rows={3} label={t("integrationQueue.loadingIntegrationQueue")} />;
  if (entries.length === 0) {
    return <p className="text-muted text-sm">{t("integrationQueue.noFinishedRunsToIntegrate")}</p>;
  }

  return (
    <>
    <div className="integration-queue">
      {entries.map((entry) => (
        <div key={entry.runId} className="integration-entry" title={t("integrationQueue.run", { runId: entry.runId })}>
          <div className="integration-entry-header">
            <span className="integration-entry-title">{entry.planTitle}</span>
            {entry.merged ? (
              <span className="integration-badge integration-badge-merged" title={t("integrationQueue.branchIsMerged")}>
                <Check size={10} /> {t("integrationQueue.merged")}
              </span>
            ) : (
              <span className="integration-badge integration-badge-unmerged" title={t("integrationQueue.branchIsNotMerged")}>
                {t("integrationQueue.unmerged")}
              </span>
            )}
          </div>
          <div className="integration-entry-detail">
            {entry.branch ? (
              <span className="text-muted text-sm">
                <GitBranch size={10} /> {entry.branch}
              </span>
            ) : null}
            {entry.aheadBehind ? (
              <span className="text-muted text-sm" title={t("integrationQueue.aheadBehindVsDefaultBranch")}>
                ↑↓ {entry.aheadBehind}
              </span>
            ) : null}
            {entry.prState ? (
              <span className={`integration-pr-state integration-pr-${entry.prState}`}>
                {t("integrationQueue.pR", { prState: entry.prState })}</span>
            ) : null}
            {entry.prUrl ? (
              <a
                href={entry.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="integration-pr-link"
                title={t("integrationQueue.openPrInBrowser")}
              >
                <ExternalLink size={10} />
              </a>
            ) : null}
          </div>
          <div className="integration-entry-actions">
            <button
              className="btn btn-sm"
              type="button"
              title={entry.merged ? t("integrationQueue.removeWorktreeDeleteMergedBranch") : t("integrationQueue.forceRemoveWorktreeDeleteBranch")}
              onClick={() => void handleCleanup(entry.runId, entry.merged)}
            >
              <Trash2 size={10} /> {t("integrationQueue.cleanup")}
            </button>
          </div>
        </div>
      ))}
    </div>
    <ConfirmDialog
      open={confirm !== null}
      title={confirm?.force ? t("integrationQueue.forceDelete") : t("integrationQueue.cleanUp")}
      message={confirm?.force
        ? t("integrationQueue.thisBranchIsNotMergedForce")
        : t("integrationQueue.cleanUpThisMergedWorktreeAnd")}
      confirmLabel={confirm?.force ? t("integrationQueue.forceDelete2") : t("integrationQueue.cleanUp2")}
      destructive={confirm?.force ?? false}
      onConfirm={() => {
        const c = confirm;
        setConfirm(null);
        if (c) void executeCleanup(c.runId, c.force);
      }}
      onCancel={() => setConfirm(null)}
    />
    </>
  );
}

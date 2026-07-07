import { useEffect, useState } from "react";
import { Check, GitBranch, Trash2, ExternalLink } from "lucide-react";
import { integrationList, integrationCleanup, type IntegrationEntry } from "../../lib/integration";

type IntegrationQueueProps = {
  sessionId: string | null;
  projectPath: string | null;
};

/// Integration queue: lists finished worktree runs with branch, ahead/behind,
/// merged state, and PR state. Confirm-gated cleanup actions.
export function IntegrationQueue({ sessionId, projectPath }: IntegrationQueueProps) {
  const [entries, setEntries] = useState<IntegrationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !projectPath) return;
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

  async function handleCleanup(runId: string, merged: boolean) {
    if (!sessionId) return;
    const msg = merged
      ? "Clean up this merged worktree and delete its branch?"
      : "This branch is NOT merged. Force-delete the worktree and branch anyway?";
    if (!window.confirm(msg)) return;
    try {
      await integrationCleanup(runId, !merged, sessionId);
      setEntries((prev) => prev.filter((e) => e.runId !== runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p className="text-muted text-sm">Loading integration queue…</p>;
  if (error) return <p className="text-error text-sm">{error}</p>;
  if (entries.length === 0) {
    return <p className="text-muted text-sm">No finished runs to integrate.</p>;
  }

  return (
    <div className="integration-queue">
      {entries.map((entry) => (
        <div key={entry.runId} className="integration-entry" title={`Run ${entry.runId}`}>
          <div className="integration-entry-header">
            <span className="integration-entry-title">{entry.planTitle}</span>
            {entry.merged ? (
              <span className="integration-badge integration-badge-merged" title="Branch is merged">
                <Check size={10} /> Merged
              </span>
            ) : (
              <span className="integration-badge integration-badge-unmerged" title="Branch is not merged">
                Unmerged
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
              <span className="text-muted text-sm" title="Ahead/behind vs default branch">
                ↑↓ {entry.aheadBehind}
              </span>
            ) : null}
            {entry.prState ? (
              <span className={`integration-pr-state integration-pr-${entry.prState}`}>
                PR: {entry.prState}
              </span>
            ) : null}
            {entry.prUrl ? (
              <a
                href={entry.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="integration-pr-link"
                title="Open PR in browser"
              >
                <ExternalLink size={10} />
              </a>
            ) : null}
          </div>
          <div className="integration-entry-actions">
            <button
              className="btn btn-sm"
              type="button"
              title={entry.merged ? "Remove worktree + delete merged branch" : "Force-remove worktree + delete branch (not merged)"}
              onClick={() => void handleCleanup(entry.runId, entry.merged)}
            >
              <Trash2 size={10} /> Cleanup
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

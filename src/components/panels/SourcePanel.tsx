import { useEffect, useState } from "react";

import { gitAdd, gitCommit, gitDiff, gitLog, gitReset, gitStatus, type FileEntry, type GitCommit, type GitStatus } from "../../lib/git";

export type ProjectPathProvider = () => string | null;

export function SourcePanel({ projectPath }: { projectPath: string | null }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [tab, setTab] = useState<"workdir" | "history">("workdir");

  useEffect(() => {
    if (!projectPath) {
      return;
    }
    void refresh();
  }, [projectPath]);

  async function refresh() {
    if (!projectPath) {
      return;
    }
    const [newStatus, newCommits] = await Promise.all([gitStatus(projectPath), gitLog(projectPath)]);
    setStatus(newStatus);
    setCommits(newCommits);
  }

  async function viewDiff(file: FileEntry) {
    if (!projectPath) {
      return;
    }
    setSelectedFile(file);
    const patch = await gitDiff(projectPath, file.path, file.staged);
    setDiff(patch);
  }

  async function stage(file: FileEntry) {
    if (!projectPath) {
      return;
    }
    await gitAdd(projectPath, file.path);
    await refresh();
  }

  async function unstage(file: FileEntry) {
    if (!projectPath) {
      return;
    }
    await gitReset(projectPath, file.path);
    await refresh();
  }

  async function commit() {
    if (!projectPath || !commitMessage.trim()) {
      return;
    }
    if (!confirm("Commit staged changes?")) {
      return;
    }
    await gitCommit(projectPath, commitMessage);
    setCommitMessage("");
    await refresh();
  }

  if (!projectPath) {
    return <p className="source-empty">Open a project to see source control.</p>;
  }

  return (
    <div className="source-panel">
      <div className="source-tabs">
        <button className={tab === "workdir" ? "is-active" : ""} onClick={() => setTab("workdir")} type="button">
          Working directory
        </button>
        <button className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")} type="button">
          History
        </button>
      </div>

      {tab === "workdir" ? (
        <>
          {status ? (
            <div className="source-branch">
              <span>{status.branch.branch}</span>
              {status.branch.ahead > 0 ? <span className="branch-ahead">+{status.branch.ahead}</span> : null}
              {status.branch.behind > 0 ? <span className="branch-behind">-{status.branch.behind}</span> : null}
            </div>
          ) : null}

          <div className="source-lists">
            <FileList title="Staged" entries={status?.staged ?? []} onToggle={unstage} onView={viewDiff} actionLabel="-" />
            <FileList title="Changes" entries={status?.unstaged ?? []} onToggle={stage} onView={viewDiff} actionLabel="+" />
            <FileList title="Untracked" entries={status?.untracked ?? []} onToggle={stage} onView={viewDiff} actionLabel="+" />
          </div>

          <div className="source-commit">
            <input
              className="source-input"
              placeholder="Commit message"
              type="text"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <button className="primary-action" disabled={!status?.staged.length} onClick={() => void commit()} type="button">
              Commit
            </button>
          </div>

          {diff && selectedFile ? (
            <div className="source-diff">
              <h4>{selectedFile.path}</h4>
              <pre>{diff}</pre>
            </div>
          ) : null}
        </>
      ) : (
        <ul className="source-history">
          {commits.map((commit) => (
            <li className="source-commit-item" key={commit.hash}>
              <span className="commit-hash">{commit.shortHash}</span>
              <span className="commit-message">{commit.message}</span>
              <span className="commit-meta">
                {commit.author} · {commit.date}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileList({
  title,
  entries,
  onToggle,
  onView,
  actionLabel,
}: {
  title: string;
  entries: FileEntry[];
  onToggle: (entry: FileEntry) => void;
  onView: (entry: FileEntry) => void;
  actionLabel: string;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="source-list">
      <h4>
        {title} ({entries.length})
      </h4>
      <ul>
        {entries.map((entry) => (
          <li className="source-file" key={entry.path}>
            <button className="source-file-action" onClick={() => onToggle(entry)} type="button">
              {actionLabel}
            </button>
            <button className="source-file-name" onClick={() => onView(entry)} type="button">
              {entry.path}
            </button>
            <span className="source-file-status">{entry.changeType}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

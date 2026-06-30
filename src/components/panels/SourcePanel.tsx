import { useEffect, useState } from "react";

import { gitAdd, gitCommit, gitDiff, gitLog, gitReset, gitStatus, type FileEntry, type GitCommit, type GitStatus } from "../../lib/git";

export function SourcePanel({ projectPath }: { projectPath: string | null }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [tab, setTab] = useState<"workdir" | "history">("workdir");

  useEffect(() => {
    if (!projectPath) return;
    void refresh();
  }, [projectPath]);

  async function refresh() {
    if (!projectPath) return;
    const [s, c] = await Promise.all([gitStatus(projectPath), gitLog(projectPath)]);
    setStatus(s);
    setCommits(c);
  }

  async function viewDiff(file: FileEntry) {
    if (!projectPath) return;
    setSelectedFile(file);
    setDiff(await gitDiff(projectPath, file.path, file.staged));
  }

  async function stage(file: FileEntry) {
    if (!projectPath) return;
    await gitAdd(projectPath, file.path);
    await refresh();
  }

  async function unstage(file: FileEntry) {
    if (!projectPath) return;
    await gitReset(projectPath, file.path);
    await refresh();
  }

  async function commit() {
    if (!projectPath || !commitMessage.trim()) return;
    if (!confirm("Commit staged changes?")) return;
    await gitCommit(projectPath, commitMessage);
    setCommitMessage("");
    await refresh();
  }

  if (!projectPath) return <p className="text-muted">Open a project to see source control.</p>;

  return (
    <div className="stack">
      <div className="source-tabs">
        <button className={`source-tab${tab === "workdir" ? " is-active" : ""}`} onClick={() => setTab("workdir")} type="button">Working dir</button>
        <button className={`source-tab${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")} type="button">History</button>
      </div>

      {tab === "workdir" ? (
        <>
          {status ? (
            <div className="row">
              <span className="text-sm">{status.branch.branch}</span>
              {status.branch.ahead > 0 ? <span className="text-sm text-ok">+{status.branch.ahead}</span> : null}
              {status.branch.behind > 0 ? <span className="text-sm text-danger">-{status.branch.behind}</span> : null}
            </div>
          ) : null}

          <FileList title="Staged" entries={status?.staged ?? []} onToggle={unstage} onView={viewDiff} actionLabel="−" />
          <FileList title="Changes" entries={status?.unstaged ?? []} onToggle={stage} onView={viewDiff} actionLabel="+" />
          <FileList title="Untracked" entries={status?.untracked ?? []} onToggle={stage} onView={viewDiff} actionLabel="+" />

          <div className="row gap-sm">
            <input className="input" placeholder="Commit message" type="text" value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)} />
            <button className="btn btn-primary" disabled={!status?.staged.length} onClick={() => void commit()} type="button">Commit</button>
          </div>

          {diff && selectedFile ? (
            <div className="card">
              <h4 className="text-sm text-muted" style={{ marginBottom: 8 }}>{selectedFile.path}</h4>
              <pre className="pre">{diff}</pre>
            </div>
          ) : null}
        </>
      ) : (
        <div className="stack-sm">
          {commits.map((c) => (
            <div className="source-commit-item" key={c.hash}>
              <span className="commit-hash">{c.shortHash}</span>
              <span className="commit-message">{c.message}</span>
              <span className="commit-meta">{c.author} · {c.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileList({ title, entries, onToggle, onView, actionLabel }: {
  title: string; entries: FileEntry[]; onToggle: (e: FileEntry) => void; onView: (e: FileEntry) => void; actionLabel: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm text-muted" style={{ marginBottom: 6 }}>{title} ({entries.length})</h4>
      <div className="stack-sm">
        {entries.map((entry) => (
          <div className="source-file" key={entry.path}>
            <button className="btn-icon btn-icon-sm" onClick={() => onToggle(entry)} type="button">{actionLabel}</button>
            <button className="source-file-name" onClick={() => onView(entry)} type="button">{entry.path}</button>
            <span className="source-file-status">{entry.changeType}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import {
  gitAdd,
  gitBranchList,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitReset,
  gitStageAll,
  gitStatus,
  gitUnstageAll,
  type FileChangeType,
  type FileEntry,
  type GitBranch,
  type GitCommit,
  type GitStatus,
} from "../../lib/git";

const STATUS_ICON: Record<FileChangeType, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  unmerged: "!",
  other: "?",
};

const STATUS_CLASS: Record<FileChangeType, string> = {
  added: "is-added",
  modified: "is-modified",
  deleted: "is-deleted",
  renamed: "is-renamed",
  untracked: "is-untracked",
  unmerged: "is-modified",
  other: "is-untracked",
};

type DiffLine = {
  type: "add" | "del" | "context" | "hunk" | "meta";
  content: string;
  oldNum?: string;
  newNum?: string;
};

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "meta", content: line });
    } else if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10) - 1;
        newNum = parseInt(match[2], 10) - 1;
      }
      result.push({ type: "hunk", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      newNum++;
      result.push({ type: "add", content: line.slice(1), newNum: String(newNum) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      oldNum++;
      result.push({ type: "del", content: line.slice(1), oldNum: String(oldNum) });
    } else if (line.startsWith(" ")) {
      oldNum++;
      newNum++;
      result.push({ type: "context", content: line.slice(1), oldNum: String(oldNum), newNum: String(newNum) });
    } else if (line.length > 0) {
      result.push({ type: "context", content: line });
    }
  }
  return result;
}

export function SourcePanel({ projectPath }: { projectPath: string | null }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c, b] = await Promise.all([
        gitStatus(projectPath),
        gitLog(projectPath, 30),
        gitBranchList(projectPath),
      ]);
      setStatus(s);
      setCommits(c);
      setBranches(b);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    void refresh();
  }, [projectPath, refresh]);

  async function viewDiff(file: FileEntry) {
    if (!projectPath) return;
    setSelectedFile(file);
    try {
      const raw = await gitDiff(projectPath, file.path, file.staged);
      setDiffLines(parseDiff(raw));
    } catch (e) {
      setDiffLines([{ type: "meta", content: `Error: ${e}` }]);
    }
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

  async function discard(file: FileEntry) {
    if (!projectPath) return;
    if (!confirm(`Discard changes to ${file.path}? This cannot be undone.`)) return;
    await gitDiscard(projectPath, file.path);
    if (selectedFile?.path === file.path) {
      setSelectedFile(null);
      setDiffLines([]);
    }
    await refresh();
  }

  async function stageAll() {
    if (!projectPath) return;
    await gitStageAll(projectPath);
    await refresh();
  }

  async function unstageAll() {
    if (!projectPath) return;
    await gitUnstageAll(projectPath);
    await refresh();
  }

  async function commit() {
    if (!projectPath || !commitMessage.trim() || !status?.staged.length) return;
    try {
      await gitCommit(projectPath, commitMessage);
      setCommitMessage("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function pull() {
    if (!projectPath) return;
    setLoading(true);
    try {
      await gitPull(projectPath);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function push() {
    if (!projectPath) return;
    setLoading(true);
    try {
      await gitPush(projectPath);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchRemote() {
    if (!projectPath) return;
    setLoading(true);
    try {
      await gitFetch(projectPath);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!projectPath) {
    return <p className="text-muted pad">Open a project to see source control.</p>;
  }

  return (
    <div className="source-panel">
      {/* Branch bar */}
      {status ? (
        <div className="source-branch-bar">
          <GitBranchIcon size={13} />
          <span className="source-branch-name">{status.branch.branch}</span>
          {status.branch.upstream ? (
            <span className="text-muted text-sm">→ {status.branch.upstream}</span>
          ) : null}
          {status.branch.ahead > 0 ? (
            <span className="source-ahead" title="Commits ahead of upstream">↑{status.branch.ahead}</span>
          ) : null}
          {status.branch.behind > 0 ? (
            <span className="source-behind" title="Commits behind upstream">↓{status.branch.behind}</span>
          ) : null}
          <div className="row" style={{ marginLeft: "auto" }}>
            <button className="btn-icon btn-icon-sm" title="Fetch from remote" onClick={() => void fetchRemote()} disabled={loading} type="button">
              <RefreshCw size={13} />
            </button>
            <button className="btn-icon btn-icon-sm" title="Pull from remote" onClick={() => void pull()} disabled={loading} type="button">
              <RotateCcw size={13} />
            </button>
            <button className="btn-icon btn-icon-sm" title="Push to remote" onClick={() => void push()} disabled={loading} type="button">
              <Plus size={13} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="source-tabs">
        <button className={`source-tab${tab === "changes" ? " is-active" : ""}`} onClick={() => setTab("changes")} type="button">
          Changes
        </button>
        <button className={`source-tab${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")} type="button">
          History
        </button>
        <button
          className="btn-icon btn-icon-sm"
          title="Refresh"
          style={{ marginLeft: "auto" }}
          onClick={() => void refresh()}
          disabled={loading}
          type="button"
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error ? <div className="terminal-error">{error}</div> : null}

      {tab === "changes" ? (
        <div className="stack-sm">
          {/* Staged section */}
          <div>
            <div className="source-section-label">
              Staged ({status?.staged.length ?? 0})
              {status && status.staged.length > 0 ? (
                <button className="btn-icon btn-icon-sm" title="Unstage all" style={{ marginLeft: "auto" }} onClick={() => void unstageAll()} type="button">
                  <Minus size={12} />
                </button>
              ) : null}
            </div>
            {(status?.staged ?? []).map((file) => (
              <FileRow
                key={`staged-${file.path}`}
                file={file}
                isSelected={selectedFile?.path === file.path}
                onView={() => void viewDiff(file)}
                actions={[
                  { icon: Minus, title: "Unstage", onClick: () => void unstage(file) },
                ]}
              />
            ))}
          </div>

          {/* Changes section */}
          <div>
            <div className="source-section-label">
              Changes ({status?.unstaged.length ?? 0})
              {status && status.unstaged.length > 0 ? (
                <button className="btn-icon btn-icon-sm" title="Stage all" style={{ marginLeft: "auto" }} onClick={() => void stageAll()} type="button">
                  <Plus size={12} />
                </button>
              ) : null}
            </div>
            {(status?.unstaged ?? []).map((file) => (
              <FileRow
                key={`unstaged-${file.path}`}
                file={file}
                isSelected={selectedFile?.path === file.path}
                onView={() => void viewDiff(file)}
                actions={[
                  { icon: Plus, title: "Stage", onClick: () => void stage(file) },
                  { icon: RotateCcw, title: "Discard changes", onClick: () => void discard(file), danger: true },
                ]}
              />
            ))}
          </div>

          {/* Untracked section */}
          <div>
            <div className="source-section-label">
              Untracked ({status?.untracked.length ?? 0})
            </div>
            {(status?.untracked ?? []).map((file) => (
              <FileRow
                key={`untracked-${file.path}`}
                file={file}
                isSelected={selectedFile?.path === file.path}
                onView={() => void viewDiff(file)}
                actions={[
                  { icon: Plus, title: "Add", onClick: () => void stage(file) },
                ]}
              />
            ))}
          </div>

          {/* Commit bar */}
          {status && status.staged.length > 0 ? (
            <div className="source-commit-bar">
              <textarea
                className="input source-commit-input"
                placeholder="Commit message..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void commit();
                  }
                }}
                rows={2}
              />
              <button
                className="btn btn-primary"
                title="Commit staged changes (Ctrl+Enter)"
                disabled={!commitMessage.trim()}
                onClick={() => void commit()}
                type="button"
              >
                <Check size={13} /> Commit
              </button>
            </div>
          ) : null}

          {/* Diff viewer */}
          {selectedFile && diffLines.length > 0 ? (
            <div className="source-diff-viewer">
              <div className="source-diff-header">
                <span className="mono text-sm">{selectedFile.path}</span>
                <button
                  className="btn-icon btn-icon-sm"
                  title="Close diff"
                  onClick={() => { setSelectedFile(null); setDiffLines([]); }}
                  type="button"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="source-diff-body">
                {diffLines.map((line, i) => (
                  <div key={i} className={`source-diff-line is-${line.type}`}>
                    <span className="source-diff-gutter">
                      {line.oldNum ?? ""}
                      {line.oldNum && line.newNum ? " " : ""}
                      {line.newNum ?? ""}
                    </span>
                    <span className="source-diff-content">
                      {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
                      {line.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="source-history-graph">
          {commits.map((c) => (
            <div className="source-commit-node" key={c.hash}>
              <div className="source-commit-dot" title={c.hash} />
              <div className="source-commit-info">
                <div className="source-commit-msg">{c.message}</div>
                <div className="source-commit-meta">
                  <span className="commit-hash">{c.shortHash}</span> · {c.author} · {c.date}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type FileAction = {
  icon: typeof Plus;
  title: string;
  onClick: () => void;
  danger?: boolean;
};

function FileRow({
  file,
  isSelected,
  onView,
  actions,
}: {
  file: FileEntry;
  isSelected: boolean;
  onView: () => void;
  actions: FileAction[];
}) {
  const pathParts = file.path.split("/");
  const fileName = pathParts.pop() ?? file.path;
  const dirPath = pathParts.length > 0 ? pathParts.join("/") + "/" : "";

  return (
    <div className={`source-file-row${isSelected ? " is-selected" : ""}`} onClick={onView}>
      <span className={`source-file-status ${STATUS_CLASS[file.changeType]}`} title={file.changeType}>
        {STATUS_ICON[file.changeType]}
      </span>
      <span className="source-file-name">
        {dirPath ? <span className="source-file-path">{dirPath}</span> : null}
        {fileName}
      </span>
      <div className="row gap-sm">
        {actions.map((action, i) => (
          <button
            key={i}
            className={`btn-icon btn-icon-sm${action.danger ? " text-danger" : ""}`}
            title={action.title}
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            type="button"
          >
            <action.icon size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}

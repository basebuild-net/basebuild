import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode, Folder, RefreshCw, Search, X } from "lucide-react";
import { listFiles, type DirEntry } from "../../lib/files";
import { gitStatus, type FileChangeType, type GitStatus } from "../../lib/git";
import { ModalPortal } from "../ModalPortal";

type FileExplorerModalProps = {
  projectPath: string | null;
  open: boolean;
  onClose: () => void;
  onOpenFile: (path: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TreeNode = {
  entry: DirEntry;
  children: TreeNode[] | null; // null = not loaded yet (folder) or file
  loaded: boolean;
  expanded: boolean;
};

const GIT_COLORS: Record<FileChangeType, string> = {
  added: "var(--bb-positive)",
  modified: "var(--bb-warning)",
  deleted: "var(--bb-danger)",
  untracked: "var(--bb-info)",
  renamed: "var(--bb-text-secondary)",
  unmerged: "var(--bb-danger)",
  other: "var(--bb-muted)",
};

const GIT_LABELS: Record<FileChangeType, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  untracked: "Untracked",
  renamed: "Renamed",
  unmerged: "Unmerged",
  other: "Other",
};

// Priority order for rolling a folder's status up from its descendants.
const FOLDER_PRIORITY: FileChangeType[] = [
  "unmerged",
  "deleted",
  "modified",
  "added",
  "untracked",
  "renamed",
  "other",
];

/** Normalize an absolute path to a forward-slash path relative to root. */
function relPath(absPath: string, root: string): string {
  let rel = absPath;
  if (rel.startsWith(root)) rel = rel.slice(root.length);
  rel = rel.replace(/^[\\/]+/, "");
  return rel.replace(/\\/g, "/");
}

function buildGitMap(gs: GitStatus): Map<string, FileChangeType> {
  const m = new Map<string, FileChangeType>();
  for (const fe of gs.staged) m.set(fe.path.replace(/\\/g, "/"), fe.changeType);
  for (const fe of gs.unstaged) {
    if (!m.has(fe.path.replace(/\\/g, "/"))) m.set(fe.path.replace(/\\/g, "/"), fe.changeType);
  }
  for (const fe of gs.untracked) {
    if (!m.has(fe.path.replace(/\\/g, "/"))) m.set(fe.path.replace(/\\/g, "/"), fe.changeType);
  }
  return m;
}

function mapNodes(
  nodes: TreeNode[],
  targetPath: string,
  fn: (n: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.path === targetPath) return fn(n);
    if (n.children) return { ...n, children: mapNodes(n.children, targetPath, fn) };
    return n;
  });
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.entry.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function depthClass(depth: number): string {
  return `files-tree-depth-${Math.min(depth, 5)}`;
}

export function FileExplorerModal({ projectPath, open, onClose, onOpenFile }: FileExplorerModalProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [query, setQuery] = useState("");
  const [gitMap, setGitMap] = useState<Map<string, FileChangeType>>(new Map());
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelected(null);
    setQuery("");
  }, [projectPath, open]);

  const load = useCallback(async () => {
    if (!projectPath) {
      setRootNodes([]);
      setGitMap(new Map());
      setBranch(null);
      return;
    }
    setLoading(true);
    try {
      const entries = await listFiles(projectPath);
      setRootNodes(entries.map((e) => ({ entry: e, children: null, loaded: false, expanded: false })));
      setError(null);
    } catch (e) {
      setError(String(e));
      setRootNodes([]);
    }
    try {
      const gs = await gitStatus(projectPath);
      setGitMap(buildGitMap(gs));
      setBranch(gs.branch.branch);
    } catch {
      setGitMap(new Map());
      setBranch(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggleFolder = useCallback(async (entry: DirEntry) => {
    const existing = findNode(rootNodes, entry.path);
    if (existing && existing.loaded) {
      setRootNodes((prev) =>
        mapNodes(prev, entry.path, (n) => ({ ...n, expanded: !n.expanded })),
      );
      return;
    }
    try {
      const children = await listFiles(entry.path);
      const childNodes: TreeNode[] = children.map((c) => ({
        entry: c,
        children: null,
        loaded: false,
        expanded: false,
      }));
      setRootNodes((prev) =>
        mapNodes(prev, entry.path, (n) => ({
          ...n,
          children: childNodes,
          loaded: true,
          expanded: true,
        })),
      );
    } catch (e) {
      setError(String(e));
    }
  }, [rootNodes]);

  // Flatten the loaded tree to entries whose name matches the query.
  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const out: { node: TreeNode; depth: number }[] = [];
    function walk(ns: TreeNode[], depth: number) {
      for (const n of ns) {
        if (n.entry.name.toLowerCase().includes(q)) out.push({ node: n, depth });
        if (n.children) walk(n.children, depth + 1);
      }
    }
    walk(rootNodes, 0);
    return out;
  }, [rootNodes, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const gitForNode = useCallback(
    (node: TreeNode): FileChangeType | null => {
      if (!projectPath) return null;
      const rel = relPath(node.entry.path, projectPath);
      const exact = gitMap.get(rel);
      if (exact) return exact;
      // Roll up descendant status for folders.
      if (node.entry.isDir) {
        const prefix = rel.endsWith("/") ? rel : `${rel}/`;
        let best: FileChangeType | null = null;
        let bestIdx = FOLDER_PRIORITY.length;
        for (const [key, type] of gitMap) {
          if (key.startsWith(prefix)) {
            const idx = FOLDER_PRIORITY.indexOf(type);
            if (idx >= 0 && idx < bestIdx) {
              bestIdx = idx;
              best = type;
            }
          }
        }
        return best;
      }
      return null;
    },
    [gitMap, projectPath],
  );

  if (!open || !projectPath) return null;

  const handleOpen = (node: TreeNode) => {
    if (node.entry.isDir) {
      void toggleFolder(node.entry);
    } else {
      onOpenFile(node.entry.path);
      onClose();
    }
  };

  const onSelect = (node: TreeNode) => {
    setSelected(node);
    if (node.entry.isDir && !query.trim()) void toggleFolder(node.entry);
  };

  const renderDot = (type: FileChangeType | null) => {
    if (!type) return null;
    return (
      <span
        className={`files-item-git-dot files-item-git-${type}`}
        title={GIT_LABELS[type]}
      />
    );
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const gitType = gitForNode(node);
    const isSelected = selected?.entry.path === node.entry.path;
    const chevron = node.entry.isDir ? (
      node.expanded ? (
        <ChevronDown size={12} className="files-tree-chevron" />
      ) : (
        <ChevronRight size={12} className="files-tree-chevron" />
      )
    ) : (
      <span className="files-tree-chevron-placeholder" />
    );
    return (
      <div key={node.entry.path}>
        <button
          className={`files-item ${depthClass(depth)}${isSelected ? " is-selected" : ""}`}
          type="button"
          title={node.entry.path}
          onClick={() => onSelect(node)}
          onDoubleClick={() => handleOpen(node)}
        >
          {chevron}
          {node.entry.isDir ? <Folder size={12} /> : <FileCode size={12} />}
          {renderDot(gitType)}
          <span className="mono">{node.entry.name}</span>
          {node.entry.isFile ? (
            <span className="text-sm text-muted">{formatSize(node.entry.size)}</span>
          ) : null}
        </button>
        {node.entry.isDir && node.expanded && node.children
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  const selectedGit = selected ? gitForNode(selected) : null;

  return (
    <ModalPortal>
    <div className="file-modal-overlay" role="dialog" aria-label="File explorer" onClick={onClose}>
      <div className="file-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-modal-header">
          <div className="file-modal-search">
            <Search size={12} className="text-muted" />
            <input
              className="input file-modal-search-input"
              type="text"
              placeholder="Filter files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              title="Filter files by name"
              autoFocus
            />
          </div>
          <span className="file-modal-path mono text-muted" title={projectPath}>
            {branch ? `${branch}` : projectPath.split(/[\\/]/).pop()}
          </span>
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title="Refresh file tree and git status"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="file-modal-body">
          <div className="file-modal-tree">
            <div className="files-tree-legend" title="Git status legend">
              <span className="files-tree-legend-item">
                <span className="files-item-git-dot files-item-git-added" /> Added
              </span>
              <span className="files-tree-legend-item">
                <span className="files-item-git-dot files-item-git-modified" /> Modified
              </span>
              <span className="files-tree-legend-item">
                <span className="files-item-git-dot files-item-git-deleted" /> Deleted
              </span>
              <span className="files-tree-legend-item">
                <span className="files-item-git-dot files-item-git-untracked" /> Untracked
              </span>
              <span className="files-tree-legend-item">
                <span className="files-item-git-dot files-item-git-renamed" /> Renamed
              </span>
            </div>
            {error ? (
              <p className="text-danger text-sm pad">{error}</p>
            ) : filtered ? (
              filtered.length === 0 ? (
                <p className="text-muted text-sm pad">No matching files.</p>
              ) : (
                filtered.map(({ node, depth }) => {
                  const gitType = gitForNode(node);
                  const isSelected = selected?.entry.path === node.entry.path;
                  return (
                    <button
                      key={node.entry.path}
                      className={`files-item ${depthClass(depth)}${isSelected ? " is-selected" : ""}`}
                      type="button"
                      title={node.entry.path}
                      onClick={() => setSelected(node)}
                      onDoubleClick={() => handleOpen(node)}
                    >
                      {node.entry.isDir ? <Folder size={12} /> : <FileCode size={12} />}
                      {renderDot(gitType)}
                      <span className="mono">{node.entry.name}</span>
                      {node.entry.isFile ? (
                        <span className="text-sm text-muted">{formatSize(node.entry.size)}</span>
                      ) : null}
                    </button>
                  );
                })
              )
            ) : rootNodes.length === 0 ? (
              <p className="text-muted text-sm pad">{loading ? "Loading…" : "Empty folder."}</p>
            ) : (
              rootNodes.map((node) => renderNode(node, 0))
            )}
          </div>
          <div className="file-modal-detail">
            {selected ? (
              <div className="stack-sm">
                <div className="row-between">
                  <span className="text-sm">
                    {selected.entry.isDir ? <Folder size={12} /> : <FileCode size={12} />}
                    <span className="mono">{selected.entry.name}</span>
                  </span>
                  {selected.entry.isFile ? (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      title="Open in a file tab"
                      onClick={() => handleOpen(selected)}
                    >
                      Open
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      title={selected.expanded ? "Collapse folder" : "Expand folder"}
                      onClick={() => void toggleFolder(selected.entry)}
                    >
                      {selected.expanded ? "Collapse" : "Expand"}
                    </button>
                  )}
                </div>
                <p className="text-muted text-sm mono" title={selected.entry.path}>
                  {selected.entry.path}
                </p>
                {selected.entry.isFile ? (
                  <p className="text-muted text-sm">{formatSize(selected.entry.size)}</p>
                ) : null}
                {selectedGit ? (
                  <p className="text-sm files-detail-git">
                    <span
                      className={`files-item-git-dot files-item-git-${selectedGit}`}
                      title={GIT_LABELS[selectedGit]}
                    />
                    <span>Git: {GIT_LABELS[selectedGit]}</span>
                  </p>
                ) : (
                  <p className="text-muted text-sm">Git: no changes</p>
                )}
              </div>
            ) : (
              <p className="text-muted text-sm pad">
                Select a file to preview, or double-click to open. Click a folder to expand it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

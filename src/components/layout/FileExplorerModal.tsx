import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileCode, Folder, RefreshCw, Search, X } from "lucide-react";
import { listFiles, type DirEntry } from "../../lib/files";

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
  children: TreeNode[] | null; // null = not loaded / file
  loaded: boolean;
};

export function FileExplorerModal({ projectPath, open, onClose, onOpenFile }: FileExplorerModalProps) {
  const [path, setPath] = useState<string | null>(projectPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DirEntry | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setPath(projectPath);
    setSelected(null);
    setQuery("");
  }, [projectPath, open]);

  const load = useCallback(async () => {
    if (!path) {
      setEntries([]);
      return;
    }
    try {
      setEntries(await listFiles(path));
      setError(null);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    }
  }, [path]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !projectPath) return null;

  const handleOpen = (entry: DirEntry) => {
    if (entry.isDir) {
      setPath(entry.path);
      setSelected(null);
    } else {
      onOpenFile(entry.path);
      onClose();
    }
  };

  const crumb = path ? path.split(/[\\/]/) : [];
  const relativeCrumb = crumb.slice(-3);

  return (
    <div className="file-modal-overlay" role="dialog" aria-label="File explorer" onClick={onClose}>
      <div className="file-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-modal-header">
          <div className="file-modal-search">
            <Search size={12} className="text-muted" />
            <input
              className="input file-modal-search-input"
              type="text"
              placeholder="Filter files in this folder…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              title="Filter files by name"
              autoFocus
            />
          </div>
          <span className="file-modal-path mono text-muted" title={path ?? ""}>
            {relativeCrumb.join("/")}
          </span>
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title="Refresh"
            onClick={() => void load()}
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
            {path && path !== projectPath ? (
              <button
                className="files-item"
                type="button"
                onClick={() => { setPath(projectPath); setSelected(null); }}
                title="Back to project root"
              >
                <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
                <span>..</span>
              </button>
            ) : null}
            {error ? (
              <p className="text-danger text-sm pad">{error}</p>
            ) : filtered.length === 0 ? (
              <p className="text-muted text-sm pad">{query ? "No matching files." : "Empty folder."}</p>
            ) : (
              filtered.map((entry) => (
                <button
                  key={entry.path}
                  className={`files-item${selected?.path === entry.path ? " is-selected" : ""}`}
                  type="button"
                  title={entry.path}
                  onClick={() => setSelected(entry)}
                  onDoubleClick={() => handleOpen(entry)}
                >
                  {entry.isDir ? <Folder size={12} /> : <FileCode size={12} />}
                  <span className="mono">{entry.name}</span>
                  {entry.isFile ? <span className="text-sm text-muted">{formatSize(entry.size)}</span> : null}
                </button>
              ))
            )}
          </div>
          <div className="file-modal-detail">
            {selected ? (
              <div className="stack-sm">
                <div className="row-between">
                  <span className="text-sm">
                    {selected.isDir ? <Folder size={12} /> : <FileCode size={12} />}
                    <span className="mono">{selected.name}</span>
                  </span>
                  {selected.isFile ? (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      title="Open in a file tab"
                      onClick={() => handleOpen(selected)}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
                <p className="text-muted text-sm mono" title={selected.path}>{selected.path}</p>
                {selected.isFile ? (
                  <p className="text-muted text-sm">{formatSize(selected.size)}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted text-sm pad">Select a file to preview, or double-click to open.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

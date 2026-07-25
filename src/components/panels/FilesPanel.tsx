import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FileCode, Folder, RefreshCw } from "lucide-react";
import { listFiles, type DirEntry } from "../../lib/files";
import { SkeletonRows } from "../layout/Loading";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FilesPanelProps = {
  projectPath: string | null;
  onOpenFile?: (path: string) => void;
};

export function FilesPanel({ projectPath, onOpenFile }: FilesPanelProps) {
  // Seeded from the prop so the very first `load` targets the project root.
  // Deriving it in an effect left one commit with `path === null`, which
  // settled the loading flag against an empty directory listing.
  const [path, setPath] = useState<string | null>(projectPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPath(projectPath);
  }, [projectPath]);

  const load = useCallback(async () => {
    if (!path) {
      setEntries([]);
      // Nothing to load is a settled state, not a pending one.
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setEntries(await listFiles(path));
      setError(null);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!projectPath) {
    return <p className="text-muted text-sm pad">Open a project to browse files.</p>;
  }
  if (error) return <p className="text-danger text-sm pad">{error}</p>;

  return (
    <div className="files-panel stack-sm">
      <div className="files-panel-header row-between">
        <span className="text-sm text-muted mono" title={path ?? undefined}>
          {path ? path.split(/[/\\]/).slice(-2).join("/") : ""}
        </span>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => void load()}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="files-list">
        {loading && entries.length === 0 ? (
          <SkeletonRows rows={6} label="Loading files…" />
        ) : null}
        {path && path !== projectPath ? (
          <button
            className="files-item"
            type="button"
            onClick={() => setPath(projectPath)}
            title="Back to project root"
          >
            <ChevronRight size={12} className="icon-rotate-180" />
            <span>..</span>
          </button>
        ) : null}
        {entries.map((entry) => (
          <button
            key={entry.path}
            className="files-item"
            type="button"
            title={entry.path}
            onClick={() => {
              if (entry.isDir) {
                setPath(entry.path);
              } else if (onOpenFile) {
                onOpenFile(entry.path);
              }
            }}
          >
            {entry.isDir ? <Folder size={12} /> : <FileCode size={12} />}
            <span className="mono">{entry.name}</span>
            {entry.isFile ? <span className="text-sm text-muted">{formatSize(entry.size)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

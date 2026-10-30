import { useEffect, useState } from "react";
import { readFile } from "../../lib/sessions";
import { t } from "../../i18n";

export type FileViewerProps = {
  path: string | null;
};

export function FileViewer({ path }: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setContent("");
      setError("");
      return;
    }
    setLoading(true);
    readFile(path)
      .then((text) => {
        setContent(text);
        setError("");
      })
      .catch((e: unknown) => {
        setContent("");
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [path]);

  if (!path) {
    return (
      <div className="empty-state">
        <h3>{t("fileViewer.noFileSelected")}</h3>
        <p>{t("fileViewer.openAFileFromThe")}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="terminal-container"><div className="empty-state"><p>{t("fileViewer.loading")}</p></div></div>;
  }

  if (error) {
    return (
      <div className="empty-state">
        <h3>{t("fileViewer.couldNotReadFile")}</h3>
        <p className="text-danger">{error}</p>
      </div>
    );
  }

  const basename = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <span className="file-viewer-name">{basename}</span>
        <span className="file-viewer-meta">{path}</span>
      </div>
      <pre className="file-viewer-content">{content}</pre>
    </div>
  );
}

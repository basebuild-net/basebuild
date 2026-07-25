import { useCallback, useEffect, useState } from "react";
import {
  getProjectSchematic,
  hasProjectSchematic,
  inspectProjectSchematic,
  setProjectSchematic,
  type SchematicReport,
} from "../lib/schematic";

export function useProjectSchematic(projectPath: string | null) {
  const [exists, setExists] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [report, setReport] = useState<SchematicReport | null>(null);
  // True until the mount fetch settles: the false start painted the
  // "Project description missing / Start wizard" CTA over every load.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setExists(false);
      setContent(null);
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const has = await hasProjectSchematic(projectPath);
      setExists(has);
      setContent(has ? await getProjectSchematic(projectPath) : null);
      setReport(await inspectProjectSchematic(projectPath));
    } catch (err) {
      setError(String(err));
      setExists(false);
      setContent(null);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const write = useCallback(
    async (text: string) => {
      if (!projectPath) return;
      await setProjectSchematic(projectPath, text);
      setContent(text);
      setExists(true);
      setReport(await inspectProjectSchematic(projectPath));
    },
    [projectPath],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { exists, content, report, loading, error, refresh, write };
}

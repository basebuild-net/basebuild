import { useCallback, useEffect, useState } from "react";
import { getProjectSchematic, hasProjectSchematic, setProjectSchematic } from "../lib/schematic";

export function useProjectSchematic(projectPath: string | null) {
  const [exists, setExists] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setExists(false);
      setContent(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const has = await hasProjectSchematic(projectPath);
      setExists(has);
      if (has) {
        const text = await getProjectSchematic(projectPath);
        setContent(text);
      } else {
        setContent(null);
      }
    } catch (err) {
      setError(String(err));
      setExists(false);
      setContent(null);
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
    },
    [projectPath],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { exists, content, loading, error, refresh, write };
}

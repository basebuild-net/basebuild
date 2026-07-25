import { useCallback, useEffect, useState } from "react";
import {
  openspecRuntimeStatus,
  type OpenSpecRuntimeStatus,
} from "../lib/openspecRuntime";

export type OpenSpecRuntimeState = {
  status: OpenSpecRuntimeStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useOpenSpecRuntime(projectPath: string | null): OpenSpecRuntimeState {
  const [status, setStatus] = useState<OpenSpecRuntimeStatus | null>(null);
  // True until the mount fetch settles. `status ?? "missing"` rendered a
  // definitive "OpenSpec: missing" badge plus manual-install instructions
  // during every normal load.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await openspecRuntimeStatus(projectPath);
      setStatus(s);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}

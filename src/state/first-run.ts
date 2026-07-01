import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "basebuild:first-run-complete";

export type FirstRunState = {
  completed: boolean;
  loading: boolean;
  complete: () => void;
  skip: () => void;
};

export function useFirstRun(): FirstRunState {
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setCompleted(stored === "true");
    } catch {
      setCompleted(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const complete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setCompleted(true);
  }, []);

  const skip = useCallback(() => {
    // Skip uses conservative defaults — same as complete but marks that the user
    // didn't explicitly configure anything
    localStorage.setItem(STORAGE_KEY, "skipped");
    setCompleted(true);
  }, []);

  return { completed, loading, complete, skip };
}

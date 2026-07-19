import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "basebuild:first-run-complete";

export function parseFirstRunCompletion(value: string | null): boolean {
  return value === "true" || value === "skipped";
}

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
      setCompleted(parseFirstRunCompletion(localStorage.getItem(STORAGE_KEY)));
    } catch {
      setCompleted(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const persistCompletion = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Storage can be unavailable; completion still holds for this session.
    }
    setCompleted(true);
  }, []);

  const complete = persistCompletion;
  const skip = persistCompletion;

  return { completed, loading, complete, skip };
}

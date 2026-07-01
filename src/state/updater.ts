import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdates, installUpdate, type UpdateInfo } from "../lib/updater";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type UpdateStatus = "idle" | "checking" | "available" | "up_to_date" | "installing" | "error";

export type UpdaterState = {
  info: UpdateInfo | null;
  status: UpdateStatus;
  error: string | null;
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorInfo(message: string): UpdateInfo {
  return {
    available: false,
    version: null,
    currentVersion: null,
    notes: message,
    date: null,
    target: null,
    downloadUrl: null,
  };
}

export function useUpdater(): UpdaterState {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const checkInFlight = useRef(false);
  const installInFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (checkInFlight.current || installInFlight.current) return;
    checkInFlight.current = true;
    setStatus("checking");
    try {
      const result = await checkForUpdates();
      setInfo(result);
      setError(null);
      setLastCheckedAt(Date.now());
      setStatus(result.available ? "available" : "up_to_date");
    } catch (e) {
      const message = messageFromError(e);
      setInfo(errorInfo(message));
      setError(message);
      setLastCheckedAt(Date.now());
      setStatus("error");
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (installInFlight.current) return;
    installInFlight.current = true;
    setStatus("installing");
    try {
      await installUpdate();
    } catch (e) {
      const message = messageFromError(e);
      setError(message);
      setInfo((current) => ({
        ...(current ?? errorInfo(message)),
        notes: `Install failed: ${message}`,
      }));
      setStatus("error");
    } finally {
      installInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void checkNow();
    const id = window.setInterval(() => void checkNow(), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [checkNow]);

  return { info, status, error, lastCheckedAt, checkNow, install };
}

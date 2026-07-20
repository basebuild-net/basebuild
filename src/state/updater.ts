import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDownloadedUpdate,
  checkForUpdates,
  clearSkippedUpdate,
  downloadUpdate,
  getSkippedUpdateVersion,
  onUpdaterProgress,
  type UpdateChannelStatus,
  type UpdateInfo,
  type UpdateProgress,
} from "../lib/updater";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type UpdaterState = {
  info: UpdateInfo | null;
  status: UpdateStatus;
  error: string | null;
  lastCheckedAt: number | null;
  progress: UpdateProgress | null;
  checkNow: () => Promise<void>;
  download: () => Promise<void>;
  /** Install the staged update and restart. User-triggered only. */
  restartToApply: () => Promise<void>;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/// Parse a `channel_status=Variant` token from a backend error string.
/// The backend formats updater errors as
/// `"... | channel_status=Variant | explanation..."` so the frontend
/// can classify release-channel breakage without leaking plugin internals.
function parseChannelStatus(message: string): UpdateChannelStatus {
  const match = message.match(/channel_status=(\w+)/);
  if (!match) return "unknown";
  const variant = match[1];
  // Convert PascalCase Rust enum to the camelCase TS union member.
  const lower = variant.charAt(0).toLowerCase() + variant.slice(1);
  const valid: UpdateChannelStatus[] = [
    "ok",
    "endpointUnavailable",
    "malformedManifest",
    "platformMissing",
    "signatureInvalid",
    "networkUnreachable",
    "unknown",
  ];
  return (valid as string[]).includes(lower) ? (lower as UpdateChannelStatus) : "unknown";
}

function parseChannelExplanation(message: string): string {
  // Extract everything after the last " | " separator in the formatted error.
  const idx = message.lastIndexOf(" | ");
  if (idx >= 0 && idx + 3 < message.length) {
    return message.slice(idx + 3);
  }
  return "An update-channel error occurred. See the raw message for details.";
}

function errorInfo(message: string): UpdateInfo {
  const channelStatus = parseChannelStatus(message);
  const channelExplanation = parseChannelExplanation(message);
  return {
    available: false,
    version: null,
    currentVersion: null,
    notes: message,
    date: null,
    target: null,
    downloadUrl: null,
    channelStatus,
    channelExplanation,
    rawError: message,
    policy: { mandatory: false, minimumSupportedVersion: null, releaseSummary: null },
    skipped: false,
  };
}

export function useUpdater(): UpdaterState {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const checkInFlight = useRef(false);
  const downloadInFlight = useRef(false);
  const applyInFlight = useRef(false);
  // Mirror of `status` for callbacks with empty dep lists.
  const statusRef = useRef<UpdateStatus>("idle");
  statusRef.current = status;

  const checkNow = useCallback(async () => {
    if (checkInFlight.current || downloadInFlight.current || applyInFlight.current) return;
    // A staged download is version-pinned; re-checking would clobber the
    // "restart to apply" state. The staged version installs on next restart,
    // after which checks resume.
    if (statusRef.current === "downloading" || statusRef.current === "downloaded" || statusRef.current === "installing") {
      return;
    }
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

  // Download and stage the update in the background. Never installs and
  // never restarts — the app keeps running until the user explicitly
  // applies the update (or the next launch does).
  const download = useCallback(async () => {
    if (downloadInFlight.current || applyInFlight.current) return;
    downloadInFlight.current = true;
    setStatus("downloading");
    setProgress(null);
    try {
      await downloadUpdate();
      setStatus("downloaded");
    } catch (e) {
      const message = messageFromError(e);
      setError(message);
      setInfo((current) => ({
        ...(current ?? errorInfo(message)),
        notes: `Download failed: ${message}`,
      }));
      setStatus("error");
    } finally {
      downloadInFlight.current = false;
    }
  }, []);

  // Install the staged update and restart. Only ever invoked from an
  // explicit user action ("Restart to apply update") or the startup splash.
  const restartToApply = useCallback(async () => {
    if (applyInFlight.current) return;
    applyInFlight.current = true;
    setStatus("installing");
    try {
      await applyDownloadedUpdate();
      // On success the process restarts; this line is never reached.
    } catch (e) {
      const message = messageFromError(e);
      setError(message);
      setInfo((current) => ({
        ...(current ?? errorInfo(message)),
        notes: `Install failed: ${message}`,
      }));
      // The payload stays staged backend-side; keep the restart CTA visible.
      setStatus("downloaded");
    } finally {
      applyInFlight.current = false;
    }
  }, []);

  // Listen for progress events from the backend during download/install.
  useEffect(() => {
    const unlistenPromise = onUpdaterProgress((p) => setProgress(p));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Clear stale skipped version if a newer release appears.
  useEffect(() => {
    void (async () => {
      const skipped = await getSkippedUpdateVersion();
      if (skipped && info?.available && info.version && skipped !== info.version) {
        await clearSkippedUpdate();
      }
    })();
  }, [info?.available, info?.version]);

  // Background auto-DOWNLOAD (not install): when an update is available,
  // stage it silently. The app is never restarted mid-session — the update
  // applies when the user clicks "Restart to apply update" or on the next
  // launch via the startup splash.
  // Never in dev: the dev build runs as 0.0.0, so every release looks
  // "newer" (backend also refuses in debug builds). Playwright e2e
  // (BASEBUILD_E2E) runs the dev server against mocked commands, so the
  // updater flow stays enabled there for coverage.
  useEffect(() => {
    if (import.meta.env.DEV && !import.meta.env.BASEBUILD_E2E) return;
    if (status === "available" && info?.available && !info.skipped) {
      void download();
    }
  }, [status, info, download]);

  useEffect(() => {
    // No automatic update checks in dev builds (see auto-download note above).
    if (import.meta.env.DEV && !import.meta.env.BASEBUILD_E2E) return;
    // Releases are Windows-only (NSIS). Skip the check on other platforms to
    // avoid a guaranteed "platform missing" error every 5 minutes.
    if (!navigator.platform.includes("Win")) return;
    void checkNow();
    const id = window.setInterval(() => void checkNow(), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [checkNow]);

  return {
    info,
    status,
    error,
    lastCheckedAt,
    progress,
    checkNow,
    download,
    restartToApply,
  };
}

import { useCallback, useEffect, useState } from "react";
import { BarChart3, X } from "lucide-react";
import {
  listenUsageSyncStatus,
  usageSyncSetEnabled,
  usageSyncStatus,
  type AutoSyncStatus,
} from "../../lib/usageSync";
import { getAnalyticsConsent, setAnalyticsConsent } from "../../lib/analytics";
import { useLogs } from "../../state/log";

const DISMISS_KEY = "basebuild:usage-consent-dismissed";

type UsageSharingBannerProps = {
  /** Open Settings on the Privacy tab so the user can review what is shared. */
  onOpenPrivacy: () => void;
};

/**
 * Proactive, non-nagging notice shown only when usage sync is blocked because
 * the user has never made a sharing choice (`off_reason === "consent_required"`).
 * An explicit opt-out or an already-enabled toggle never surfaces this. The
 * primary action turns sharing on in one click; "Not now" is remembered so the
 * banner does not reappear.
 */
export function UsageSharingBanner({ onOpenPrivacy }: UsageSharingBannerProps) {
  const { addLog } = useLogs();
  const [status, setStatus] = useState<AutoSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    try {
      setStatus(await usageSyncStatus());
    } catch {
      // Non-blocking: a status read failure just leaves the banner hidden.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The backend emits usage-sync://status after enable/toggle/sync; refetch so
  // the banner hides itself the moment sharing is turned on.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenUsageSyncStatus(() => {
      void refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    addLog("debug", "Usage sharing banner enable", "Turning on aggregate usage sharing");
    try {
      const consent = await getAnalyticsConsent();
      await setAnalyticsConsent({
        ...consent,
        collectionEnabled: true,
        uploadEnabled: true,
        consentVersion: "usage-sharing-v1",
        consentedAt: Math.floor(Date.now() / 1000),
      });
      await usageSyncSetEnabled(true);
      await refresh();
    } catch (error) {
      addLog("error", "Usage sharing enable failed", String(error));
    } finally {
      setBusy(false);
    }
  }, [addLog, refresh]);

  const dismiss = useCallback(() => {
    addLog("debug", "Usage sharing banner dismissed", "User chose Not now");
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Storage can be unavailable; dismissal still holds for this session.
    }
    setDismissed(true);
  }, [addLog]);

  const openDetails = useCallback(() => {
    addLog("debug", "Usage sharing banner details", "Opening Privacy settings");
    onOpenPrivacy();
  }, [addLog, onOpenPrivacy]);

  if (dismissed || status?.offReason !== "consent_required") return null;

  return (
    <div className="usage-consent-banner" role="status">
      <BarChart3 size={14} className="usage-consent-banner-icon" />
      <div className="usage-consent-banner-body">
        <strong className="text-sm">Usage isn't being sent yet</strong>
        <span className="text-muted text-sm">
          Share anonymous aggregate usage (model, hours, request counts) to help build
          community plan estimates. Never your name, prompts, code, paths, or secrets.
        </span>
      </div>
      <div className="usage-consent-banner-actions">
        <button
          className="btn btn-sm btn-primary"
          type="button"
          disabled={busy}
          onClick={() => void enable()}
          title="Turn on anonymous aggregate usage sharing"
        >
          {busy ? "Turning on..." : "Turn on usage sharing"}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          onClick={openDetails}
          title="Open Analytics settings to review exactly what is shared"
        >
          What's shared
        </button>
        <button
          className="usage-consent-banner-close"
          type="button"
          onClick={dismiss}
          title="Not now: hide this notice"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

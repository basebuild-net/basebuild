import { useEffect, useState } from "react";
import { AlertTriangle, X, ChevronRight } from "lucide-react";

import { useStability } from "../../state/stability";

type CrashReportNoticeProps = {
  onViewReports: () => void;
};

/// Non-blocking toast that surfaces unseen crash/freeze reports on launch.
/// Auto-dismisses after 15s but persists the unseen count until the user
/// opens the DebugPanel and marks reports as seen.
export function CrashReportNotice({ onViewReports }: CrashReportNoticeProps) {
  const { unseenCount } = useStability();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (unseenCount === 0) return;
    const timer = setTimeout(() => setDismissed(true), 15_000);
    return () => clearTimeout(timer);
  }, [unseenCount]);

  if (unseenCount === 0 || dismissed) return null;

  return (
    <div className="crash-notice" role="alert" aria-live="polite">
      <AlertTriangle size={16} />
      <span className="crash-notice-text">
        {unseenCount === 1
          ? "1 crash or freeze report found from last session."
          : `${unseenCount} crash or freeze reports found from last session.`}
      </span>
      <button
        className="crash-notice-action"
        type="button"
        title="View reports in Debug Panel"
        onClick={() => {
          setDismissed(true);
          onViewReports();
        }}
      >
        View <ChevronRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
      </button>
      <button
        className="crash-notice-dismiss"
        type="button"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

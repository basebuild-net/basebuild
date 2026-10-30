import { useEffect, useState } from "react";
import { AlertTriangle, X, ChevronRight } from "lucide-react";

import { useStability } from "../../state/stability";
import { t } from "../../i18n";

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
          ? t("crashReportNotice.1CrashOrFreezeReport")
          : t("crashReportNotice.crashOrFreezeReportsFoundFrom", { unseenCount: unseenCount })}
      </span>
      <button
        className="crash-notice-action"
        type="button"
        title={t("crashReportNotice.viewReportsInDebugPanel")}
        onClick={() => {
          setDismissed(true);
          onViewReports();
        }}
      >
        {t("crashReportNotice.view")} <ChevronRight size={12} className="icon-inline" />
      </button>
      <button
        className="crash-notice-dismiss"
        type="button"
        title={t("crashReportNotice.dismiss")}
        aria-label={t("crashReportNotice.dismiss")}
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

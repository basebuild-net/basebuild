import { useEffect, useState } from "react";
import { appVersion } from "../../lib/app";
import { LogoPulse } from "./LogoPulse";
import { t } from "../../i18n";

export type RestorePhase = "starting" | "detecting" | "restoring" | "resolving" | "ready";

type WorkspaceSplashProps = {
  phase: RestorePhase;
  onDismissed?: () => void;
};

const PHASE_LABELS: Record<RestorePhase, string> = {
  starting: t("workspaceSplash.startingUp"),
  detecting: t("workspaceSplash.detectingProjects"),
  restoring: t("workspaceSplash.restoringWorkspace"),
  resolving: t("workspaceSplash.resolvingProviders"),
  ready: t("workspaceSplash.ready"),
};

export function WorkspaceSplash({ phase, onDismissed }: WorkspaceSplashProps) {
  const [version, setVersion] = useState("");
  const [fading, setFading] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    void appVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    setFading(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      onDismissed?.();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [phase, onDismissed]);

  if (!mounted) return null;

  return (
    <div className={`splash-overlay workspace-splash${fading ? " workspace-splash-fading" : ""}`} role="status" aria-live="polite">
      <div className="splash-card">
        <div className="splash-brand">{t("workspaceSplash.bASEBUILD")}</div>
        <div className="splash-version mono">{t("workspaceSplash.v", { version: version || "0.0.0" })}</div>
        <LogoPulse size={28} className="splash-spinner" />
        <div className="splash-status">{PHASE_LABELS[phase]}</div>
      </div>
    </div>
  );
}

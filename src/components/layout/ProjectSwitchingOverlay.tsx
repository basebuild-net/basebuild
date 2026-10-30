import { LogoPulse } from "./LogoPulse";
import { t } from "../../i18n";

type ProjectSwitchingOverlayProps = {
  projectName: string;
};

export function ProjectSwitchingOverlay({ projectName }: ProjectSwitchingOverlayProps) {
  return (
    <div className="project-switching-overlay" role="status" aria-live="polite">
      <LogoPulse size={28} />
      <span className="project-switching-label">{t("projectSwitchingOverlay.loading", { projectName: projectName })}</span>
    </div>
  );
}

import { LogoPulse } from "./LogoPulse";

type ProjectSwitchingOverlayProps = {
  projectName: string;
};

export function ProjectSwitchingOverlay({ projectName }: ProjectSwitchingOverlayProps) {
  return (
    <div className="project-switching-overlay" role="status" aria-live="polite">
      <LogoPulse size={28} />
      <span className="project-switching-label">Loading {projectName}…</span>
    </div>
  );
}

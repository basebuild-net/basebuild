type ProjectSwitchingOverlayProps = {
  projectName: string;
};

export function ProjectSwitchingOverlay({ projectName }: ProjectSwitchingOverlayProps) {
  return (
    <div className="project-switching-overlay" role="status" aria-live="polite">
      <span className="is-spinning project-switching-spinner" aria-hidden="true" />
      <span className="project-switching-label">Loading {projectName}…</span>
    </div>
  );
}

import { useProjectSchematic } from "../../state/schematic";

export type ProjectSchematicTabProps = {
  projectPath: string | null;
  onOpenDescription: () => void;
};

export function ProjectSchematicTab({ projectPath, onOpenDescription }: ProjectSchematicTabProps) {
  const schematic = useProjectSchematic(projectPath);

  if (!projectPath) {
    return (
      <div className="empty-state">
        <h3>No project</h3>
        <p>Open a project to view its schematic and plan context.</p>
      </div>
    );
  }

  if (schematic.loading) {
    return (
      <div className="empty-state">
        <p>Loading schematic...</p>
      </div>
    );
  }

  if (!schematic.exists) {
    return (
      <div className="empty-state">
        <h3>Project description missing</h3>
        <p>This project has no <code>.basebuild/project-schematic.md</code> yet.</p>
        <button className="btn btn-primary" type="button" onClick={onOpenDescription}>
          Create project description
        </button>
      </div>
    );
  }

  return (
    <div className="project-schematic-tab">
      <div className="project-schematic-header">
        <span>.basebuild/project-schematic.md</span>
        <button className="btn btn-sm" type="button" onClick={onOpenDescription}>
          Edit
        </button>
      </div>
      <pre className="project-schematic-content">{schematic.content}</pre>
    </div>
  );
}

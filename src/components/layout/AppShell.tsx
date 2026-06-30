import { useEffect, useMemo, useState } from "react";

import { primaryActivities, type ActivityId } from "../../state/activity";
import { useOmpState } from "../../state/omp";
import { ActivityRail } from "./ActivityRail";
import { RightPanel } from "./RightPanel";
import { WorkspacePanel } from "../layout/WorkspacePanel";
import { createProjectBasebuildConfig, detectProject, pickProjectDirectory, rememberRecentProject, type ProjectDetection } from "../../lib/projects";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";

export function AppShell() {
  const [activeActivity, setActiveActivity] = useState<ActivityId>("projects");
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [projectDetection, setProjectDetection] = useState<ProjectDetection | null>(null);
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const ompState = useOmpState();

  useEffect(() => {
    void refreshRequirements();
  }, []);

  async function refreshRequirements() {
    setRequirements(await listRequirements());
  }

  async function handleOpenProject() {
    const projectPath = await pickProjectDirectory();
    if (projectPath) {
      await rememberRecentProject(projectPath);
      setProjectDetection(await detectProject(projectPath));
      setActiveProjectPath(projectPath);
      setActiveActivity("projects");
    }
  }

  async function handleCreateProjectConfig() {
    if (!activeProjectPath) {
      return;
    }
    setProjectDetection(await createProjectBasebuildConfig(activeProjectPath));
  }

  const activities = useMemo(() => {
    const issueCount = requirements.filter((requirement) => requirement.severity !== "ok").length;
    return primaryActivities.map((activity) =>
      activity.id === "updates" && issueCount > 0 ? { ...activity, badge: issueCount } : activity,
    );
  }, [requirements]);

  return (
    <main className="app-shell">
      <ActivityRail
        active={activeActivity}
        items={activities}
        onSelect={(activity) => {
          if (activity === "updates") {
            void refreshRequirements();
          }
          setActiveActivity(activity);
        }}
      />
      <WorkspacePanel
        active={activeActivity}
        activeProjectPath={activeProjectPath}
        projectDetection={projectDetection}
        requirements={requirements}
        ompState={ompState}
        onOpenProject={handleOpenProject}
        onCreateProjectConfig={handleCreateProjectConfig}
        onRefreshRequirements={refreshRequirements}
      />
      <RightPanel />
    </main>
  );
}

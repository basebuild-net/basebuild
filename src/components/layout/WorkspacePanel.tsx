import type { ActivityId } from "../../state/activity";
import type { ProjectDetection } from "../../lib/projects";
import { gitDownloadUrl, gitInstallCommand, type RequirementStatus } from "../../lib/requirements";
import { ConfigPanel } from "../panels/ConfigPanel";
import { OmpPanel } from "../panels/OmpPanel";
import { SourcePanel } from "../panels/SourcePanel";
import { TerminalPanel } from "../panels/TerminalPanel";
import type { OmpController } from "../../state/omp";
import { TopBar } from "./TopBar";

type WorkspacePanelProps = {
  active: ActivityId;
  activeProjectPath: string | null;
  projectDetection: ProjectDetection | null;
  requirements: RequirementStatus[];
  ompState: OmpController;
  onCreateProjectConfig: () => void;
  onOpenProject: () => void;
  onRefreshRequirements: () => void;
};

const titles: Record<ActivityId, string> = {
  projects: "Open a local project",
  omp: "OMP session control",
  terminal: "Terminal panes",
  source: "Source control",
  configs: "Basebuild configs",
  updates: "Updates & requirements",
};

const descriptions: Record<ActivityId, string> = {
  projects: "Open a folder to connect OMP, terminals, source control, and config packs.",
  omp: "Provider, model, session, and OMP todo state will appear here.",
  terminal: "Interactive terminals will appear here.",
  source: "Git changes, diffs, staging, commits, and history will appear here.",
  configs: "Choose built-in, user-created, or installed Basebuild prompt packs.",
  updates: "Missing requirements, app updates, and config-pack updates will appear here." };

export function WorkspacePanel({ active, activeProjectPath, projectDetection, requirements, ompState, onOpenProject, onCreateProjectConfig, onRefreshRequirements }: WorkspacePanelProps) {
  const isProjects = active === "projects";

  async function copyGitInstallCommand() {
    await navigator.clipboard.writeText(gitInstallCommand);
  }

  return (
    <section className="workspace-panel">
      <TopBar title={titles[active]} status="Windows-first" />
      <div className="empty-state">
        <p className="eyebrow">{activeProjectPath ?? active}</p>
        <h2>{activeProjectPath && isProjects ? "Project selected" : titles[active]}</h2>
        {active === "updates" ? (
          <div className="requirement-list">
            {requirements.map((requirement) => (
              <article className={`requirement-card is-${requirement.severity}`} key={requirement.id}>
                <div>
                  <h3>{requirement.label}</h3>
                  <p>
                    {requirement.installed
                      ? `Installed${requirement.version ? `: ${requirement.version}` : ""}`
                      : requirement.message}
                  </p>
                  {requirement.id === "git" && !requirement.installed ? (
                    <div className="requirement-actions">
                      <button className="secondary-action" type="button" onClick={copyGitInstallCommand}>
                        Copy winget command
                      </button>
                      <a className="secondary-link" href={gitDownloadUrl} target="_blank" rel="noreferrer">
                        Open Git for Windows
                      </a>
                    </div>
                  ) : null}
                </div>
                <span>{requirement.required ? "Required" : "Optional"}</span>
              </article>
            ))}
            <button className="primary-action" type="button" onClick={onRefreshRequirements}>
              Re-check requirements
            </button>
          </div>
        ) : null}
        {active === "omp" ? <OmpPanel state={ompState} /> : null}
        {active === "terminal" ? <TerminalPanel /> : null}
        {active === "source" ? <SourcePanel projectPath={activeProjectPath} /> : null}
        {active === "configs" ? <ConfigPanel projectPath={activeProjectPath} /> : null}
        {active !== "omp" && active !== "terminal" && active !== "source" && active !== "configs" ? <p>{activeProjectPath && isProjects ? activeProjectPath : descriptions[active]}</p> : null}
        {activeProjectPath && isProjects && projectDetection ? (
          <div className="capability-row" aria-label="Project capabilities">
            <span className={`capability-pill${projectDetection.hasGit ? " is-ok" : ""}`}>
              Git {projectDetection.hasGit ? "detected" : "missing"}
            </span>
            <span className={`capability-pill${projectDetection.hasOpenSpec ? " is-ok" : ""}`}>
              OpenSpec {projectDetection.hasOpenSpec ? "detected" : "missing"}
            </span>
            <span className={`capability-pill${projectDetection.hasBasebuild ? " is-ok" : ""}`}>
              .basebuild {projectDetection.hasBasebuild ? "detected" : "missing"}
            </span>
          </div>
        ) : null}
        {activeProjectPath && isProjects && projectDetection && !projectDetection.hasBasebuild ? (
          <button className="secondary-action" type="button" onClick={onCreateProjectConfig}>
            Create .basebuild
          </button>
        ) : null}
        {isProjects ? (
          <button className="primary-action" type="button" onClick={onOpenProject}>
            Open project
          </button>
        ) : null}
      </div>
    </section>
  );
}

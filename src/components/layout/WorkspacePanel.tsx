import type { ToolId } from "./AppShell";
import type { ProjectDetection } from "../../lib/projects";
import { gitDownloadUrl, gitInstallCommand, type RequirementStatus } from "../../lib/requirements";
import { ConfigPanel } from "../panels/ConfigPanel";
import { DebugPanel } from "../panels/DebugPanel";
import { OmpPanel } from "../panels/OmpPanel";
import { SourcePanel } from "../panels/SourcePanel";
import { TerminalPanel } from "../panels/TerminalPanel";
import type { OmpController } from "../../state/omp";
import { TopBar } from "./TopBar";

type WorkspacePanelProps = {
  activeTool: ToolId;
  activeProjectPath: string | null;
  projectDetection: ProjectDetection | null;
  requirements: RequirementStatus[];
  ompState: OmpController;
  onOpenProject: () => void;
  onCreateProjectConfig: () => void;
  onRefreshRequirements: () => void;
};

const titles: Record<ToolId, string> = {
  terminal: "Terminal",
  omp: "OMP Session",
  source: "Source Control",
  configs: "Config Packs",
  updates: "Updates & Requirements",
  debug: "Debug",
};

export function WorkspacePanel({
  activeTool,
  activeProjectPath,
  projectDetection,
  requirements,
  ompState,
  onOpenProject,
  onCreateProjectConfig,
  onRefreshRequirements,
}: WorkspacePanelProps) {
  async function copyGitInstallCommand() {
    await navigator.clipboard.writeText(gitInstallCommand);
  }

  return (
    <section className="workspace-panel">
      <TopBar title={titles[activeTool]} status={activeProjectPath ?? undefined} />
      <div className="workspace-scroll">
        {!activeProjectPath && activeTool !== "terminal" && activeTool !== "debug" ? (
          <div className="workspace-content">
            <p className="text-muted">Open a folder to connect OMP, terminals, source control, and config packs.</p>
            <button className="btn btn-primary" type="button" onClick={onOpenProject}>Open project</button>
          </div>
        ) : null}
        {activeTool === "terminal" ? <TerminalPanel cwd={activeProjectPath} /> : null}
        {activeTool === "omp" ? <OmpPanel state={ompState} /> : null}
        {activeTool === "source" && activeProjectPath ? <SourcePanel projectPath={activeProjectPath} /> : null}
        {activeTool === "configs" && activeProjectPath ? <ConfigPanel projectPath={activeProjectPath} /> : null}
        {activeTool === "updates" ? (
          <div className="workspace-content">
            <div className="stack-sm">
              {requirements.map((requirement) => (
                <article className={`card row-between is-${requirement.severity}`} key={requirement.id}>
                  <div>
                    <h3>{requirement.label}</h3>
                    <p className="text-muted">
                      {requirement.installed ? `Installed${requirement.version ? `: ${requirement.version}` : ""}` : requirement.message}
                    </p>
                    {requirement.id === "git" && !requirement.installed ? (
                      <div className="row gap-sm">
                        <button className="btn btn-ghost" type="button" onClick={copyGitInstallCommand}>Copy winget command</button>
                        <a className="btn btn-ghost" href={gitDownloadUrl} target="_blank" rel="noreferrer">Open Git for Windows</a>
                      </div>
                    ) : null}
                  </div>
                  <span className="badge">{requirement.required ? "Required" : "Optional"}</span>
                </article>
              ))}
              <button className="btn btn-primary" type="button" onClick={onRefreshRequirements}>Re-check requirements</button>
            </div>
          </div>
        ) : null}
        {activeTool === "debug" ? <DebugPanel /> : null}
      </div>
    </section>
  );
}

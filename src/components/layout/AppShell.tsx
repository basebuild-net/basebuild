import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Bug,
  GitBranch,
  RefreshCw,
  Settings2,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { useOmpState } from "../../state/omp";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { ToolRail } from "./ToolRail";
import { WorkspacePanel } from "./WorkspacePanel";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { createProjectBasebuildConfig } from "../../lib/projects";

export type ToolId = "terminal" | "omp" | "source" | "configs" | "updates" | "debug";

type ToolItem = { id: ToolId; icon: LucideIcon; label: string; tooltip: string };

const tools: ToolItem[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal", tooltip: "Integrated terminal (PowerShell/bash)" },
  { id: "omp", icon: Bot, label: "OMP", tooltip: "OhMyPi session — providers, models, usage" },
  { id: "source", icon: GitBranch, label: "Source", tooltip: "Git source control — stage, commit, diff, history" },
  { id: "configs", icon: Settings2, label: "Configs", tooltip: "Config packs — discovery and creation" },
  { id: "updates", icon: RefreshCw, label: "Updates", tooltip: "App updates and requirement checks" },
  { id: "debug", icon: Bug, label: "Debug", tooltip: "Debug panel — app info, terminal sessions, OMP context" },
];

export function AppShell() {
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("terminal");
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const ompState = useOmpState();
  const sidebar = useProjectSidebar(activeProjectPath);

  useEffect(() => {
    void refreshRequirements();
  }, []);

  async function refreshRequirements() {
    try {
      setRequirements(await listRequirements());
    } catch {
      // ignore
    }
  }

  async function handleOpenFolder() {
    const path = await sidebar.openFolder();
    if (path) {
      setActiveProjectPath(path);
      setActiveTool("terminal");
    }
  }

  async function handleSelectProject(path: string) {
    await sidebar.selectProject(path);
    setActiveProjectPath(path);
    setActiveTool("terminal");
  }

  async function handleRemoveProject(path: string) {
    await sidebar.removeProject(path);
    if (path === activeProjectPath) {
      setActiveProjectPath(null);
    }
  }

  async function handleCreateProjectConfig() {
    if (!activeProjectPath) return;
    await createProjectBasebuildConfig(activeProjectPath);
    if (activeProjectPath) {
      setActiveProjectPath(activeProjectPath);
    }
  }

  const toolBadge = useMemo(() => {
    if (activeTool !== "updates") return undefined;
    const issueCount = requirements.filter((r) => r.severity !== "ok").length;
    return issueCount > 0 ? issueCount : undefined;
  }, [activeTool, requirements]);

  return (
    <main
      className="app-shell"
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      data-rail={railCollapsed ? "collapsed" : "expanded"}
    >
      <ProjectSidebar
        activeProjectPath={activeProjectPath}
        projects={sidebar.projects}
        projectDetection={sidebar.projectDetection}
        onSelectProject={handleSelectProject}
        onOpenFolder={handleOpenFolder}
        onRemoveProject={handleRemoveProject}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <WorkspacePanel
        activeTool={activeTool}
        activeProjectPath={activeProjectPath}
        projectDetection={sidebar.projectDetection}
        requirements={requirements}
        ompState={ompState}
        onOpenProject={handleOpenFolder}
        onCreateProjectConfig={handleCreateProjectConfig}
        onRefreshRequirements={refreshRequirements}
      />
      <ToolRail
        tools={tools}
        activeTool={activeTool}
        onSelectTool={(id) => {
          if (id === "updates") void refreshRequirements();
          setActiveTool(id);
        }}
        badge={toolBadge}
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((v) => !v)}
      />
    </main>
  );
}

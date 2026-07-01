import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Bug,
  GitBranch,
  Lightbulb,
  RefreshCw,
  Settings2,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { useOmpState } from "../../state/omp";
import { useSessionState } from "../../state/sessions";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { ToolRail } from "./ToolRail";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { MenuBar, type MenuConfig } from "./MenuBar";
import { listRequirements, type RequirementStatus } from "../../lib/requirements";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { OmpPanel } from "../panels/OmpPanel";
import { SourcePanel } from "../panels/SourcePanel";
import { IdeasPanel } from "../panels/IdeasPanel";
import { DebugPanel } from "../panels/DebugPanel";

export type ToolId = "terminal" | "omp" | "source" | "configs" | "updates" | "debug" | "ideas";

type ToolItem = { id: ToolId; icon: LucideIcon; label: string; tooltip: string };

const tools: ToolItem[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal", tooltip: "Integrated terminal — multiple tabs and grid view" },
  { id: "omp", icon: Bot, label: "OMP", tooltip: "OhMyPi session — providers, models, usage" },
  { id: "source", icon: GitBranch, label: "Source", tooltip: "Git source control — stage, commit, diff, history" },
  { id: "ideas", icon: Lightbulb, label: "Ideas", tooltip: "Ideas and plans — generate, track, manage work" },
  { id: "configs", icon: Settings2, label: "Configs", tooltip: "Config packs — discovery and creation" },
  { id: "updates", icon: RefreshCw, label: "Updates", tooltip: "App updates and requirement checks" },
  { id: "debug", icon: Bug, label: "Debug", tooltip: "Debug panel — app info, terminal sessions, OMP context" },
];

const DEFAULT_SHELL = () => {
  if (typeof window !== "undefined" && window.navigator.platform.includes("Win")) return "powershell.exe";
  return "bash";
};

export function AppShell() {
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("terminal");
  const [requirements, setRequirements] = useState<RequirementStatus[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const ompState = useOmpState();
  const sidebar = useProjectSidebar(activeProjectPath);
  const session = useSessionState(activeProjectPath);

  const refreshRequirements = useCallback(async () => {
    try {
      setRequirements(await listRequirements());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshRequirements();
  }, [refreshRequirements]);

  useEffect(() => {
    if (activeProjectPath && session.sessions.length === 0 && !session.activeSessionId) {
      void session.createSession();
    }
  }, [activeProjectPath, session.sessions.length]);

  const handleOpenFolder = useCallback(async () => {
    const path = await sidebar.openFolder();
    if (path) {
      setActiveProjectPath(path);
      setActiveTool("terminal");
    }
  }, [sidebar]);

  const handleSelectProject = useCallback(
    async (path: string) => {
      await sidebar.selectProject(path);
      setActiveProjectPath(path);
      setActiveTool("terminal");
    },
    [sidebar],
  );

  const handleRemoveProject = useCallback(
    async (path: string) => {
      await sidebar.removeProject(path);
      if (path === activeProjectPath) {
        setActiveProjectPath(null);
      }
    },
    [sidebar, activeProjectPath],
  );

  const handleCreateSession = useCallback(async () => {
    await session.createSession();
    setActiveTool("terminal");
  }, [session]);

  const handleCreateTerminalTab = useCallback(async () => {
    if (!session.activeSessionId) return;
    const shell = DEFAULT_SHELL();
    const term = await createTerminal(shell, activeProjectPath ?? undefined);
    await session.createTab("terminal", `Terminal ${term.id}`, term.id);
    setActiveTool("terminal");
  }, [session, activeProjectPath]);

  const handleCreateOmpTab = useCallback(async () => {
    if (!session.activeSessionId) return;
    await session.createTab("omp", "OMP");
    setActiveTool("omp");
  }, [session]);

  const toolBadge = useMemo(() => {
    if (activeTool !== "updates") return undefined;
    const issueCount = requirements.filter((r) => r.severity !== "ok").length;
    return issueCount > 0 ? issueCount : undefined;
  }, [activeTool, requirements]);

  const menus: MenuConfig[] = useMemo(() => [
    {
      label: "File",
      items: [
        { label: "Open Project...", onClick: handleOpenFolder },
        { label: "New Session", onClick: () => void handleCreateSession(), disabled: !activeProjectPath },
        { separator: true },
        { label: "Exit", shortcut: "Alt+F4" },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Preferences...", disabled: true },
      ],
    },
    {
      label: "View",
      items: [
        { label: sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar", onClick: () => setSidebarCollapsed((v) => !v) },
        { label: railCollapsed ? "Expand Tool Rail" : "Collapse Tool Rail", onClick: () => setRailCollapsed((v) => !v) },
        { separator: true },
        { label: gridView ? "Single Tab View" : "Grid View", onClick: () => setGridView((v) => !v) },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "App Settings...", disabled: true },
      ],
    },
  ], [activeProjectPath, handleOpenFolder, handleCreateSession, sidebarCollapsed, railCollapsed, gridView]);

  const terminalTabs = session.tabs.filter((t) => t.kind === "terminal");
  const activeTerminalTab = terminalTabs.find((t) => t.id === session.activeTabId) ?? terminalTabs[0] ?? null;

  return (
    <div className="app-container">
      {/* Global window taskbar — always visible */}
      <header className="window-taskbar">
        <MenuBar menus={menus} />
        <div className="window-taskbar-right">
          <span className="window-taskbar-title">Basebuild</span>
        </div>
      </header>

      {/* Three-column layout below taskbar */}
      <main
        className="app-shell"
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
        data-rail={railCollapsed ? "collapsed" : "expanded"}
      >
        <ProjectSidebar
          activeProjectPath={activeProjectPath}
          activeSessionId={session.activeSessionId}
          projects={sidebar.projects}
          projectDetection={sidebar.projectDetection}
          sessions={session.sessions}
          onSelectProject={handleSelectProject}
          onOpenFolder={handleOpenFolder}
          onRemoveProject={handleRemoveProject}
          onSelectSession={session.selectSession}
          onCreateSession={handleCreateSession}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <section className="workspace-panel">
          {/* Session-specific header */}
          {activeProjectPath && session.activeSessionId ? (
            <>
              <div className="session-header">
                <h1 className="session-title">{session.activeSession?.title ?? "Session"}</h1>
                <span className="status-pill" title={activeProjectPath}>{activeProjectPath}</span>
              </div>
              <WorkspaceTabs
                tabs={session.tabs}
                activeTabId={session.activeTabId}
                onSelectTab={session.setActiveTabId}
                onCloseTab={(id) => void session.removeTab(id)}
                onCreateTerminal={() => void handleCreateTerminalTab()}
                onCreateOmp={() => void handleCreateOmpTab()}
              />
            </>
          ) : null}
          <div className="workspace-scroll">
            {!activeProjectPath && activeTool !== "debug" ? (
              <div className="empty-state">
                <TerminalSquare size={32} className="text-muted" />
                <h3>No project open</h3>
                <p>Open a folder to start managing terminals, source control, and ideas.</p>
                <button className="btn btn-primary" type="button" onClick={handleOpenFolder}>Open project</button>
              </div>
            ) : null}

            {activeTool === "terminal" && activeProjectPath ? (
              gridView && terminalTabs.length > 1 ? (
                <div className="terminal-grid" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(terminalTabs.length))}, 1fr)` }}>
                  {terminalTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`terminal-grid-cell${tab.id === session.activeTabId ? " is-active" : ""}`}
                      onClick={() => session.setActiveTabId(tab.id)}
                    >
                      <div className="terminal-grid-cell-header">
                        <TerminalSquare size={10} /> {tab.title}
                      </div>
                      <TerminalPanel terminalId={tab.terminalId} />
                    </div>
                  ))}
                </div>
              ) : activeTerminalTab ? (
                <TerminalPanel terminalId={activeTerminalTab.terminalId} />
              ) : (
                <div className="empty-state">
                  <TerminalSquare size={32} className="text-muted" />
                  <h3>No terminals</h3>
                  <p>Click + in the tab bar to create a new terminal.</p>
                </div>
              )
            ) : null}

            {activeTool === "omp" ? <OmpPanel state={ompState} /> : null}
            {activeTool === "source" && activeProjectPath ? <SourcePanel projectPath={activeProjectPath} /> : null}
            {activeTool === "ideas" ? <IdeasPanel sessionId={session.activeSessionId} /> : null}
            {activeTool === "debug" ? <DebugPanel /> : null}
          </div>
        </section>
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
    </div>
  );
}

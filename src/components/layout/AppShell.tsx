import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Bug,
  GitBranch,
  Lightbulb,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { useOmpState } from "../../state/omp";
import { useSessionState } from "../../state/sessions";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { generateSessionTitle } from "../../lib/skills";
import { ToolRail } from "./ToolRail";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { MenuBar, type MenuConfig } from "./MenuBar";
import { WindowControls } from "./WindowControls";
import { SettingsModal } from "./SettingsModal";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { OmpPanel } from "../panels/OmpPanel";
import { SourcePanel } from "../panels/SourcePanel";
import { IdeasPanel } from "../panels/IdeasPanel";
import { DebugPanel } from "../panels/DebugPanel";

export type ToolId = "terminal" | "omp" | "source" | "debug" | "ideas";

type ToolItem = { id: ToolId; icon: LucideIcon; label: string; tooltip: string };

const tools: ToolItem[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal", tooltip: "Integrated terminal — multiple tabs and grid view" },
  { id: "omp", icon: Bot, label: "OMP", tooltip: "OhMyPi session — providers, models, usage" },
  { id: "source", icon: GitBranch, label: "Source", tooltip: "Git source control — stage, commit, diff, history" },
  { id: "ideas", icon: Lightbulb, label: "Ideas", tooltip: "Ideas and plans — generate, track, manage work" },
  { id: "debug", icon: Bug, label: "Debug", tooltip: "Debug panel — app info, terminal sessions, OMP context" },
];

const DEFAULT_SHELL = () => {
  if (typeof window !== "undefined" && window.navigator.platform.includes("Win")) return "powershell.exe";
  return "bash";
};

export function AppShell() {
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("terminal");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const [autoMode, setAutoMode] = useState<"none" | "steps" | "idea" | "combined">("none");
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoPr, setAutoPr] = useState(false);
  const [autoGroupPr, setAutoGroupPr] = useState(false);
  const [autoAgents, setAutoAgents] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titlePendingRef = useRef(false);
  const ompState = useOmpState();
  const sidebar = useProjectSidebar(activeProjectPath);
  const activeProject = sidebar.projects.find((p) => p.path === activeProjectPath);
  const session = useSessionState(activeProjectPath, activeProject?.lastActiveSessionId);

  useEffect(() => {
    if (activeProjectPath && session.sessions.length === 0 && !session.activeSessionId) {
      void session.createSession();
    }
  }, [activeProjectPath, session.sessions.length]);

  // Auto-generate session title once after terminal output settles, while title is still default
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId) return;
    if (session.activeSession?.title !== "New Session") return;
    if (titlePendingRef.current) return;
    if (!terminalOutputBuffer.trim()) return;

    const projectPath = activeProjectPath;
    const sessionId = session.activeSessionId;
    const activeSession = session.activeSession;
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(async () => {
      titlePendingRef.current = true;
      try {
        const projectName = projectPath.split(/[/\\]/).pop() ?? "";
        const newTitle = await generateSessionTitle({
          projectPath,
          projectName,
          recentOutput: terminalOutputBuffer,
          existingTitle: activeSession?.title ?? "New Session",
          tabKinds: activeSession ? session.tabs.map((t) => t.kind) : [],
        });
        if (newTitle && sessionId) {
          await session.renameSession(sessionId, newTitle);
        }
      } finally {
        titlePendingRef.current = false;
        setTerminalOutputBuffer("");
      }
    }, 2500);

    return () => {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    };
  }, [activeProjectPath, session.activeSessionId, session.activeSession?.title, terminalOutputBuffer, session.tabs]);

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

  const handleTerminalOutput = useCallback((data: string) => {
    setTerminalOutputBuffer((prev) => (prev + data).slice(-2500));
  }, []);

  const handleCreateOmpTab = useCallback(async () => {
    if (!session.activeSessionId) return;
    // Build OMP command with autonomous flags
    const ompArgs: string[] = [];
    if (autoMode === "steps") ompArgs.push("--auto-next-steps");
    if (autoMode === "idea") ompArgs.push("--auto-next-idea");
    if (autoMode === "combined") ompArgs.push("--auto-next-steps", "--auto-next-idea");
    if (autoCommit) ompArgs.push("--auto-commit");
    if (autoPr) ompArgs.push("--auto-pr");
    if (autoGroupPr) ompArgs.push("--auto-group-pr");
    if (autoAgents > 0) ompArgs.push("--auto-agents", String(autoAgents));

    // Create terminal running OMP with autonomous flags
    const shell = ompArgs.length > 0 ? `omp ${ompArgs.join(" ")}` : "omp";
    const term = await createTerminal(shell, activeProjectPath ?? undefined);
    const label = autoMode !== "none" ? `OMP (${autoMode})` : "OMP";
    await session.createTab("omp", label, term.id);
    setActiveTool("terminal");
  }, [session, activeProjectPath, autoMode, autoCommit, autoPr, autoGroupPr, autoAgents]);

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
        { label: "Preferences...", onClick: () => setSettingsOpen(true) },
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
        { label: "App Settings...", onClick: () => setSettingsOpen(true) },
      ],
    },
  ], [activeProjectPath, handleOpenFolder, handleCreateSession, sidebarCollapsed, railCollapsed, gridView]);

  const terminalTabs = session.tabs.filter((t) => t.kind === "terminal");
  const activeTerminalTab = terminalTabs.find((t) => t.id === session.activeTabId) ?? terminalTabs[0] ?? null;

  return (
    <div className="app-container">
      {/* Global window taskbar — always visible */}
      <header className="window-taskbar" data-tauri-drag-region>
        <MenuBar menus={menus} />
        <div className="window-taskbar-right">
          <span className="window-taskbar-title" data-tauri-drag-region>Basebuild</span>
          <WindowControls />
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
          sessionsByProject={sidebar.sessionsByProject}
          onSelectProject={handleSelectProject}
          onOpenFolder={handleOpenFolder}
          onRemoveProject={handleRemoveProject}
          onSelectSession={session.selectSession}
          onCreateSession={handleCreateSession}
          onRenameSession={(id, title) => void session.renameSession(id, title)}
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
                autoMode={autoMode}
                autoCommit={autoCommit}
                autoPr={autoPr}
                autoGroupPr={autoGroupPr}
                autoAgents={autoAgents}
                onModeChange={setAutoMode}
                onCommitChange={setAutoCommit}
                onPrChange={setAutoPr}
                onGroupPrChange={setAutoGroupPr}
                onAgentsChange={setAutoAgents}
                onStop={() => setAutoMode("none")}
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
                      <TerminalPanel terminalId={tab.terminalId} onOutput={handleTerminalOutput} />
                    </div>
                  ))}
                </div>
              ) : activeTerminalTab ? (
                <TerminalPanel terminalId={activeTerminalTab.terminalId} onOutput={handleTerminalOutput} />
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
          onSelectTool={setActiveTool}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
        />
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} projectPath={activeProjectPath} />
    </div>
  );
}

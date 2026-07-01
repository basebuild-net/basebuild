import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  GitBranch,
  TerminalSquare,
} from "lucide-react";

import { useSessionState } from "../../state/sessions";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { PlanPanel } from "./PlanPanel";
import { EditPlanModal } from "./EditPlanModal";
import { FocusPlanModal } from "./FocusPlanModal";
import { GeneratePlanModal } from "./GeneratePlanModal";
import { ProjectDescriptionModal } from "./ProjectDescriptionModal";
import { ToolTabs, type ToolTabId, type ToolTabItem } from "./ToolTabs";
import { useProjectSchematic } from "../../state/schematic";
import { revealInExplorer } from "../../lib/projects";
import { generateSessionTitle } from "../../lib/skills";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { MenuBar, type MenuConfig } from "./MenuBar";
import { WindowControls } from "./WindowControls";
import { SettingsModal } from "./SettingsModal";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { SourcePanel } from "../panels/SourcePanel";
import { DebugPanel } from "../panels/DebugPanel";
import type { Plan, NewPlan, PlanFocusContext } from "../../lib/plans";

export type ToolId = ToolTabId;

const toolTabs: ToolTabItem[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal" },
  { id: "source", icon: GitBranch, label: "Source" },
  { id: "debug", icon: Bug, label: "Debug" },
];

const DEFAULT_SHELL = () => {
  if (typeof window !== "undefined" && window.navigator.platform.includes("Win")) return "powershell.exe";
  return "bash";
};

export function AppShell() {
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("terminal");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const [autoMode, setAutoMode] = useState<"none" | "steps" | "idea" | "combined">("none");
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoPr, setAutoPr] = useState(false);
  const [autoGroupPr, setAutoGroupPr] = useState(false);
  const [autoAgents, setAutoAgents] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [focusingPlan, setFocusingPlan] = useState<Plan | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titlePendingRef = useRef(false);
  const sidebar = useProjectSidebar(activeProjectPath);
  const activeProject = sidebar.projects.find((p) => p.path === activeProjectPath);
  const session = useSessionState(activeProjectPath, activeProject?.lastActiveSessionId);
  const plans = usePlans(session.activeSessionId);
  const schematic = useProjectSchematic(activeProjectPath);

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

  const handleCreatePlan = useCallback(() => {
    if (!session.activeSessionId) return;
    void plans.createPlan({
      title: "New Plan",
      description: "Describe this plan…",
      status: "draft",
      priority: 50,
      tags: [],
    });
  }, [plans, session.activeSessionId]);

  const handleGenerateFromGoal = useCallback(
    (goal: string) => {
      if (!session.activeSessionId) return;
      if (!schematic.exists) {
        setDescriptionOpen(true);
        return;
      }
      // TODO: call OMP planner skill with goal + schematic context, parse JSON, create plans
      void plans.createPlan({
        title: `Plan from ${activeProjectPath?.split(/[/\\]/)?.pop() ?? "project"}`,
        description: goal || `Generated plan. Schematic context:\n\n${schematic.content ?? "(no schematic)"}`,
        goal: goal || null,
        status: "draft",
        priority: 60,
        tags: ["generated"],
      });
    },
    [plans, session.activeSessionId, activeProjectPath, schematic.exists, schematic.content],
  );

  const handleSuggestMore = useCallback(
    (goal: string) => {
      // TODO: send existing plans + schematic + goal to OMP and append new plans
      void handleGenerateFromGoal(goal);
    },
    [handleGenerateFromGoal],
  );

  const handleOpenSchematicFile = useCallback(async () => {
    if (!activeProjectPath) return;
    await schematic.write(schematic.content ?? `# Project Schematic\n\n## Purpose\n`);
    await revealInExplorer(`${activeProjectPath}/.basebuild/project-schematic.md`);
  }, [activeProjectPath, schematic]);

  const handleEnhancePlan = useCallback(
    (plan: Plan) => {
      // TODO: call OMP to rewrite title/description/goal with clearer scope
      void plans.updatePlan(plan.id, {
        title: plan.title,
        description: `${plan.description}\n\n[enhanced — wire AI rewrite]`,
        goal: plan.goal ?? undefined,
        status: plan.status,
        priority: Math.min(100, plan.priority + 10),
        tags: [...plan.tags, "enhanced"],
      });
    },
    [plans],
  );

  const handleEditPlan = useCallback((plan: Plan) => {
    setEditingPlan(plan);
  }, []);

  const handleSavePlan = useCallback(
    (draft: NewPlan) => {
      if (!editingPlan) return;
      void plans.updatePlan(editingPlan.id, draft);
      setEditingPlan(null);
    },
    [editingPlan, plans],
  );

  const handleFocusPlan = useCallback((plan: Plan) => {
    setFocusingPlan(plan);
  }, []);

  const handleCopyReference = useCallback((refId: string) => {
    void navigator.clipboard.writeText(`#${refId}`);
  }, []);

  const handleOpenPlanInTerminal = useCallback((plan: import("../../lib/plans").Plan) => {
    void handleCreateTerminalTab();
    void navigator.clipboard.writeText(`#${plan.referenceId} ${plan.title}\n${plan.description}`);
  }, [handleCreateTerminalTab]);

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
        { label: planCollapsed ? "Expand Plans" : "Collapse Plans", onClick: () => setPlanCollapsed((v) => !v) },
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
  ], [activeProjectPath, handleOpenFolder, handleCreateSession, sidebarCollapsed, planCollapsed, gridView]);

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
        data-rail={planCollapsed ? "collapsed" : "expanded"}
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
                <ToolTabs tabs={toolTabs} activeTab={activeTool} onSelect={setActiveTool} />
                <span className="status-pill" title={activeProjectPath}>{activeProjectPath}</span>
              </div>
              <WorkspaceTabs
                tabs={session.tabs}
                activeTabId={session.activeTabId}
                onSelectTab={session.setActiveTabId}
                onCloseTab={(id) => void session.removeTab(id)}
                onCreateTerminal={() => void handleCreateTerminalTab()}
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

            {activeTool === "source" && activeProjectPath ? <SourcePanel projectPath={activeProjectPath} /> : null}
            {activeTool === "debug" ? <DebugPanel /> : null}
          </div>
        </section>
        <PlanPanel
          sessionId={session.activeSessionId}
          plans={plans.plans}
          loading={plans.loading}
          collapsed={planCollapsed}
          onToggleCollapse={() => setPlanCollapsed((v) => !v)}
          onCreatePlan={handleCreatePlan}
          onGeneratePlans={() => setGenerateOpen(true)}
          onEditPlan={handleEditPlan}
          onFocusPlan={handleFocusPlan}
          onSetPlanStatus={plans.setPlanStatus}
          onDeletePlan={plans.deletePlan}
          onCopyReference={handleCopyReference}
          onOpenInTerminal={handleOpenPlanInTerminal}
          onEnhancePlan={handleEnhancePlan}
        />
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} projectPath={activeProjectPath} />
      <EditPlanModal
        plan={editingPlan}
        open={!!editingPlan}
        onClose={() => setEditingPlan(null)}
        onSave={handleSavePlan}
      />
      <FocusPlanModal
        plan={focusingPlan}
        open={!!focusingPlan}
        onClose={() => setFocusingPlan(null)}
        onSetStatus={plans.setPlanStatus}
        onCopyReference={handleCopyReference}
        onOpenInTerminal={handleOpenPlanInTerminal}
        onSetContext={(id, ctx: PlanFocusContext) => void plans.setPlanContext(id, ctx)}
      />
      <GeneratePlanModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerate={handleGenerateFromGoal}
        onSuggest={handleSuggestMore}
        onCreateBlank={handleOpenSchematicFile}
        showSuggestMore={schematic.exists}
      />
      <ProjectDescriptionModal
        open={descriptionOpen}
        onClose={() => setDescriptionOpen(false)}
        existingContent={schematic.content}
        onSave={schematic.write}
        onOpenFile={handleOpenSchematicFile}
      />
    </div>
  );
}

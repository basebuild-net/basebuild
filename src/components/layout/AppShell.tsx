import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bug, LayoutTemplate, MessageSquare, Settings2, TerminalSquare } from "lucide-react";

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
import { AccountButton } from "./AccountButton";
import { UpdateButton } from "./UpdateButton";
import { SettingsModal } from "./SettingsModal";
import { FirstRunModal } from "./FirstRunModal";
import { useFirstRun } from "../../state/first-run";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { DebugPanel } from "../panels/DebugPanel";
import { FileViewer } from "../panels/FileViewer";
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { LogPanel } from "./LogPanel";
import { useLogs } from "../../state/log";
import { useAccount } from "../../state/account";
import { useUpdater } from "../../state/updater";
import type { Plan, NewPlan, PlanFocusContext } from "../../lib/plans";
export type ToolId = ToolTabId;

const toolTabs: ToolTabItem[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal" },
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
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const { addLog } = useLogs();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [focusingPlan, setFocusingPlan] = useState<Plan | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
 const firstRun = useFirstRun();
  const [chatDraft, setChatDraft] = useState<string | null>(null);
 const [chatDraftTabId, setChatDraftTabId] = useState<string | null>(null);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titlePendingRef = useRef(false);
  const sidebar = useProjectSidebar(activeProjectPath);
  const activeProject = sidebar.projects.find((p) => p.path === activeProjectPath);
  const session = useSessionState(activeProjectPath, activeProject?.lastActiveSessionId);
  const plans = usePlans(session.activeSessionId);
  const schematic = useProjectSchematic(activeProjectPath);
  const account = useAccount();
  const updates = useUpdater();

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
    try {
      const path = await sidebar.openFolder();
      if (path) {
        setActiveProjectPath(path);
        setActiveTool("terminal");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to open project folder", message);
    }
  }, [sidebar, addLog]);

  const handleSelectProject = useCallback(
    async (path: string) => {
      try {
        await sidebar.selectProject(path);
        setActiveProjectPath(path);
        setActiveTool("terminal");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog("error", `Failed to select project ${path}`, message);
      }
    },
    [sidebar, addLog],
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

  const openOrFocusChat = useCallback(
    async (draftPrompt: string) => {
      if (!session.activeSessionId) return;
      // Find existing chat tab (prefer active, then most recent)
      const activeChat = session.tabs.find((t) => t.id === session.activeTabId && t.kind === "chat");
      const existingChat = activeChat ?? session.tabs.filter((t) => t.kind === "chat").slice(-1)[0] ?? null;
      if (existingChat) {
        session.setActiveTabId(existingChat.id);
      } else {
        await session.createTab("chat", `Chat ${session.tabs.length + 1}`);
      }
      setActiveTool("terminal");
      // Inject the draft prompt — ChatPanel consumes it once
      setChatDraft(draftPrompt);
      setChatDraftTabId(session.activeTabId);
    },
    [session],
  );

  const handleGenerateFromGoal = useCallback(
    (goal: string, contextFile?: string, contextContent?: string) => {
      if (!session.activeSessionId) {
        addLog("warn", "Cannot generate", "No active session. Open a project first.");
        return;
      }
      if (!schematic.exists && !contextContent) {
        setDescriptionOpen(true);
        return;
      }
      // Compose a transparent prompt for the chat agent
      const parts: string[] = [];
      if (goal) parts.push(`Goal: ${goal}`);
      if (contextContent) {
        const label = contextFile ?? "selected context";
        parts.push(`Context from ${label}:\n\n${contextContent.slice(0, 5000)}`);
      }
      if (schematic.content) {
        parts.push(`Project Schematic:\n\n${schematic.content}`);
      }
      if (activeProjectPath) {
        parts.push(`Project path: ${activeProjectPath}`);
      }
      const planSummary = plans.plans.length > 0
        ? plans.plans.map((p) => `- [${p.status}] ${p.title} (${p.referenceId})`).join("\n")
        : "(no existing plans)";
      parts.push(`Existing plans:\n${planSummary}`);
      parts.push("Based on the above, propose OpenSpec-backed plans. Do not create files or commit anything.");
      const prompt = parts.join("\n\n---\n\n");
      void openOrFocusChat(prompt);
    },
    [session.activeSessionId, schematic.exists, schematic.content, activeProjectPath, plans.plans, openOrFocusChat, addLog],
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
        description: `${plan.description}\n\n[enhanced - wire AI rewrite]`,
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
        { label: sideCollapsed ? "Expand Side Panel" : "Collapse Side Panel", onClick: () => setSideCollapsed((v) => !v) },
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
  ], [activeProjectPath, handleOpenFolder, handleCreateSession, sidebarCollapsed, sideCollapsed, gridView]);

  const activeTab = session.tabs.find((t) => t.id === session.activeTabId) ?? null;

  const handleCreateTab = useCallback(
    async (kind: "terminal" | "empty" | "chat") => {
      if (!session.activeSessionId) return;
      if (kind === "empty") {
        await session.createTab("empty", "Schematic");
        setActiveTool("terminal");
        return;
      }
      if (kind === "chat") {
        await session.createTab("chat", `Chat ${session.tabs.length + 1}`);
        setActiveTool("terminal");
        return;
      }
      await handleCreateTerminalTab();
    },
    [session, handleCreateTerminalTab],
  );

  const handleOpenFileInTab = useCallback(
    async (filePath: string) => {
      if (!session.activeSessionId) return;
      // Reuse existing tab if file is already open
      const existing = session.tabs.find((t) => t.kind === "file" && t.filePath === filePath);
      if (existing) {
        session.setActiveTabId(existing.id);
        setActiveTool("terminal");
        return;
      }
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      await session.createTab("file", name, undefined, filePath);
      setActiveTool("terminal");
    },
    [session],
  );

  return (
    <div className="app-container">
      {/* Global window taskbar - always visible */}
      <header className="window-taskbar" data-tauri-drag-region>
        <MenuBar menus={menus} />
        <div className="window-taskbar-right">
          <UpdateButton updates={updates} onOpenSettings={() => setSettingsOpen(true)} />
          <AccountButton account={account} onOpenSettings={() => setSettingsOpen(true)} />
          <button
            className="window-control-btn"
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={14} />
          </button>
          <WindowControls />
        </div>
      </header>

      {/* Three-column layout below taskbar */}
      <main
        className="app-shell"
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
        data-rail={sideCollapsed ? "collapsed" : "expanded"}
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
          onDeleteSession={(id) => void session.removeSession(id)}
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
                onCreateTab={(kind) => void handleCreateTab(kind)}
              />
            </>
          ) : null}
          <div className="workspace-scroll">
            {!activeProjectPath && activeTool !== "debug" ? (
              <div className="empty-state">
                <TerminalSquare size={32} className="text-muted" />
                <h3>No project open</h3>
                <p>Open a folder to start managing terminals, files, source control, and plans.</p>
                <button className="btn btn-primary" type="button" onClick={handleOpenFolder}>Open project</button>
              </div>
            ) : null}

            {activeTool === "terminal" && activeProjectPath ? (
              !activeTab ? (
                <div className="empty-state">
                  <LayoutTemplate size={32} className="text-muted" />
                  <h3>No tab open</h3>
                  <p>Click + in the tab bar to create a terminal, schematic, or chat tab.</p>
                </div>
              ) : activeTab.kind === "chat" ? (
                <ChatPanel
                  projectPath={activeProjectPath}
                  draftPrompt={chatDraft}
                  onDraftConsumed={() => { setChatDraft(null); setChatDraftTabId(null); }}
                />
              ) : activeTab.kind === "file" ? (
                <FileViewer path={activeTab.filePath} />
              ) : activeTab.kind === "empty" ? (
                <ProjectSchematicTab projectPath={activeProjectPath} onOpenDescription={() => setDescriptionOpen(true)} />
              ) : activeTab.terminalId == null ? (
                <div className="empty-state">
                  <LayoutTemplate size={32} className="text-muted" />
                  <h3>Terminal not connected</h3>
                  <p>This terminal tab was restored from a previous session. Close it and create a new terminal tab to start a fresh shell.</p>
                </div>
              ) : gridView && session.tabs.filter((t) => t.kind === "terminal").length > 1 ? (
                (() => {
                  const terminalTabs = session.tabs.filter((t) => t.kind === "terminal");
                  return (
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
                  );
                })()
              ) : (
                <TerminalPanel terminalId={activeTab.terminalId} onOutput={handleTerminalOutput} />
              )
            ) : null}
            {activeTool === "debug" ? <DebugPanel /> : null}
          </div>
        </section>
        <SidePanel
          projectPath={activeProjectPath}
          sessionId={session.activeSessionId}
          collapsed={sideCollapsed}
          onToggleCollapse={() => setSideCollapsed((v) => !v)}
          onOpenFile={handleOpenFileInTab}
          plans={plans}
          planCallbacks={{
            onCreatePlan: handleCreatePlan,
            onGeneratePlans: () => setGenerateOpen(true),
            onEditPlan: handleEditPlan,
            onFocusPlan: handleFocusPlan,
            onCopyReference: handleCopyReference,
            onOpenInTerminal: handleOpenPlanInTerminal,
            onEnhancePlan: handleEnhancePlan,
          }}
        />
      </main>
      <StatusBar onClick={() => setLogPanelOpen(true)} />
      <LogPanel open={logPanelOpen} onClose={() => setLogPanelOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} projectPath={activeProjectPath} account={account} updates={updates} />
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
      <FirstRunModal
        open={!firstRun.completed && !firstRun.loading}
        onComplete={() => firstRun.complete()}
        onSkip={() => firstRun.skip()}
      />
    </div>
  );
}

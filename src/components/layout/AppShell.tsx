import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, Settings2, TerminalSquare, X } from "lucide-react";

import { useSessionState } from "../../state/sessions";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { PlanPanel } from "./PlanPanel";
import { EditPlanModal } from "./EditPlanModal";
import { FocusPlanModal } from "./FocusPlanModal";
import { GeneratePlanModal } from "./GeneratePlanModal";
import { ProjectDescriptionModal } from "./ProjectDescriptionModal";
import { useProjectSchematic } from "../../state/schematic";
import { revealInExplorer } from "../../lib/projects";
import { generateSessionTitle } from "../../lib/skills";
import { getWorkspaceRestoreState, saveWorkspaceRestoreState, type WorkspaceRestoreState } from "../../lib/workspace";
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
import { OmpTerminalTab } from "../panels/OmpTerminalTab";
import { FileViewer } from "../panels/FileViewer";
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { ompStatus } from "../../lib/omp";
import { stabilityRendererHeartbeat } from "../../lib/stability";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { LogPanel } from "./LogPanel";
import { CrashReportNotice } from "./CrashReportNotice";
import { DebugPanel } from "../panels/DebugPanel";
import { useLogs } from "../../state/log";
import { useAccount } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import type { Plan, NewPlan, PlanFocusContext } from "../../lib/plans";
export type ToolId = "terminal";

const DEFAULT_SHELL = () => {
  if (typeof window !== "undefined" && window.navigator.platform.includes("Win")) return "powershell.exe";
  return "bash";
};

type AppShellProps = {
  updates: UpdaterState;
};

export function AppShell({ updates }: AppShellProps) {
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const { addLog } = useLogs();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [focusingPlan, setFocusingPlan] = useState<Plan | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const firstRun = useFirstRun();
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [chatDraftTabId, setChatDraftTabId] = useState<string | null>(null);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<number | null>(null);
  const workspacePersistTimerRef = useRef<number | null>(null);
  const restoredProjectRef = useRef<string | null>(null);
  const [workspaceRestore, setWorkspaceRestore] = useState<WorkspaceRestoreState | null>(null);
  const [sideWidth, setSideWidth] = useState(260);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(260);
  const titlePendingRef = useRef(false);
  const sidebar = useProjectSidebar(activeProjectPath);
  const activeProject = sidebar.projects.find((p) => p.path === activeProjectPath);
  const session = useSessionState(activeProjectPath, activeProject?.lastActiveSessionId);
  const plans = usePlans(session.activeSessionId);
  const schematic = useProjectSchematic(activeProjectPath);
  const account = useAccount();
  const [ompInstalled, setOmpInstalled] = useState(false);
  useEffect(() => {
    ompStatus()
      .then((s) => setOmpInstalled(s.installed))
      .catch(() => setOmpInstalled(false));
  }, []);

  // Renderer heartbeat: call every 5s so the backend can detect renderer crashes.
  useEffect(() => {
    const sendHeartbeat = () => {
      stabilityRendererHeartbeat().catch(() => {});
    };
    sendHeartbeat(); // Send immediately on mount
    const interval = setInterval(sendHeartbeat, 5000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (activeProjectPath && session.sessions.length === 0 && !session.activeSessionId) {
      void session.createSession();
    }
  }, [activeProjectPath, session.sessions.length]);

  // Auto-create a chat tab when a session is active but has no tabs
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId) return;
    if (session.tabs.length > 0) return;
    if (session.activeSession?.title === "New Session") return;
    void session.createTab("chat", "Chat 1");
  }, [activeProjectPath, session.activeSessionId, session.tabs.length, session.activeSession?.title, session]);

  useEffect(() => {
    if (activeProjectPath || sidebar.projects.length === 0) return;
    const latestProject = sidebar.projects[0];
    setActiveProjectPath(latestProject.path);
    void sidebar.selectProject(latestProject.path);
  }, [activeProjectPath, sidebar]);

  useEffect(() => {
    if (!activeProjectPath) {
      setWorkspaceRestore(null);
      restoredProjectRef.current = null;
      return;
    }
    let cancelled = false;
    void getWorkspaceRestoreState(activeProjectPath).then((state) => {
      if (cancelled) return;
      setWorkspaceRestore(state);
      setSidebarCollapsed(state.sidebarCollapsed);
      setSideCollapsed(state.sideCollapsed);
      setSideWidth(state.sideWidth);
      restoredProjectRef.current = activeProjectPath;
    }).catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      addLog("warn", "Failed to restore workspace state", message);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, addLog]);

  useEffect(() => {
    document.documentElement.style.setProperty("--bb-rail-w", `${sideCollapsed ? 36 : sideWidth}px`);
  }, [sideCollapsed, sideWidth]);

  useEffect(() => {
    if (!activeProjectPath || restoredProjectRef.current !== activeProjectPath) return;
    if (workspacePersistTimerRef.current) window.clearTimeout(workspacePersistTimerRef.current);
    workspacePersistTimerRef.current = window.setTimeout(() => {
      workspacePersistTimerRef.current = null;
      void saveWorkspaceRestoreState({
        projectPath: activeProjectPath,
        lastSessionId: session.activeSessionId,
        lastTabId: session.activeTabId,
        sideSection: workspaceRestore?.sideSection ?? "plans",
        sidebarCollapsed,
        sideCollapsed,
        sideWidth,
        updatedAt: workspaceRestore?.updatedAt ?? 0,
      }).catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("warn", "Failed to persist workspace state", message);
      });
    }, 250);
    return () => {
      if (workspacePersistTimerRef.current) window.clearTimeout(workspacePersistTimerRef.current);
    };
  }, [activeProjectPath, session.activeSessionId, session.activeTabId, workspaceRestore, sidebarCollapsed, sideCollapsed, sideWidth, addLog]);

  useEffect(() => {
    if (!workspaceRestore?.lastTabId) return;
    if (session.activeTabId) return;
    const restoredTab = session.tabs.find((tab) => tab.id === workspaceRestore.lastTabId);
    if (!restoredTab) {
      // If the restored tab doesn't exist but we have chat tabs, focus the first one
      const firstChat = session.tabs.find((tab) => tab.kind === "chat");
      if (firstChat) session.setActiveTabId(firstChat.id);
      return;
    }
    if (restoredTab.kind === "terminal" && restoredTab.terminalId == null) {
      // Stale terminal — prefer a chat tab if available
      const firstChat = session.tabs.find((tab) => tab.kind === "chat");
      if (firstChat) session.setActiveTabId(firstChat.id);
      return;
    }
    session.setActiveTabId(restoredTab.id);
  }, [workspaceRestore, session]);

  // Auto-generate session title once after terminal output settles, while title is still default
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId) return;
    if (session.activeSession?.title !== "New Session") return;
    if (titlePendingRef.current) return;
    if (!terminalOutputBuffer.trim()) return;

    const projectPath = activeProjectPath;
    const sessionId = session.activeSessionId;
    const activeSession = session.activeSession;
    if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = window.setTimeout(async () => {
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
      if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    };
  }, [activeProjectPath, session.activeSessionId, session.activeSession?.title, terminalOutputBuffer, session.tabs]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await sidebar.openFolder();
      if (path) {
        setActiveProjectPath(path);
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
  }, [session]);

  const handleCreateTerminalTab = useCallback(async () => {
    if (!session.activeSessionId) return;
    const shell = DEFAULT_SHELL();
    const term = await createTerminal(shell, activeProjectPath ?? undefined);
    await session.createTab("terminal", `Terminal ${term.id}`, term.id);
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

  const handleCreatePlanFromIdea = useCallback(
    async (title: string, description: string, chatSessionId: string | null) => {
      if (!session.activeSessionId) return;
      await plans.createPlan({
        title,
        description,
        status: "draft",
        priority: 50,
        tags: chatSessionId ? [`chat:${chatSessionId}`] : [],
      });
    },
    [plans, session.activeSessionId],
  );

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
    async (kind: "terminal" | "empty" | "chat" | "omp") => {
      if (!session.activeSessionId) return;
      if (kind === "empty") {
        await session.createTab("empty", "Schematic");
        return;
      }
      if (kind === "chat") {
        await session.createTab("chat", `Chat ${session.tabs.length + 1}`);
        return;
      }
      if (kind === "omp") {
        // Spawn OMP as a raw terminal in the project's working directory.
        const term = await createTerminal("omp", activeProjectPath ?? undefined);
        await session.createTab("omp", `Oh My Pi`, term.id);
        return;
      }
      await handleCreateTerminalTab();
    },
    [session, handleCreateTerminalTab, activeProjectPath],
  );

  const handleOpenChatSession = useCallback(
    async (chatSessionId: string) => {
      if (!session.activeSessionId) return;
      const existing = session.tabs.find(
        (t) => t.kind === "chat" && t.chatSessionId === chatSessionId,
      );
      if (existing) {
        session.setActiveTabId(existing.id);
        return;
      }
      // Create a new chat tab and link it to the chat session.
      await session.createTab("chat", `Plan Run`);
      const newTab = session.tabs[session.tabs.length - 1];
      if (newTab) {
        await session.setTabChatSession(newTab.id, chatSessionId);
      }
    },
    [session],
  );

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (sideCollapsed) return;
      event.preventDefault();
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = sideWidth;
      const onMove = (clientX: number) => {
        const delta = resizeStartXRef.current - clientX;
        const next = Math.min(520, Math.max(180, resizeStartWidthRef.current + delta));
        setSideWidth(next);
      };
      const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
      const onTouchMove = (e: TouchEvent) => {
        if (e.touches[0]) onMove(e.touches[0].clientX);
      };
      const onEnd = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onEnd);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onEnd);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("touchmove", onTouchMove);
      window.addEventListener("touchend", onEnd);
    },
    [sideCollapsed, sideWidth],
  );

  const handleChatSessionCreated = useCallback(
    (tabId: string) => (chatSessionId: string) => {
      void session.setTabChatSession(tabId, chatSessionId);
    },
    [session],
  );

  const handleOpenFileInTab = useCallback(
    async (filePath: string) => {
      if (!session.activeSessionId) return;
      // Reuse existing tab if file is already open
      const existing = session.tabs.find((t) => t.kind === "file" && t.filePath === filePath);
      if (existing) {
        session.setActiveTabId(existing.id);
        return;
      }
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      await session.createTab("file", name, undefined, filePath);
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
                <span className="status-pill" title={activeProjectPath}>{activeProjectPath}</span>
              </div>
              <WorkspaceTabs
                tabs={session.tabs}
                activeTabId={session.activeTabId}
                onSelectTab={session.setActiveTabId}
                onCloseTab={(id) => void session.removeTab(id)}
                onCreateTab={(kind) => void handleCreateTab(kind)}
                ompInstalled={ompInstalled}
              />
            </>
          ) : null}
          <div className="workspace-scroll">
            {!activeProjectPath ? (
              <div className="empty-state">
                <TerminalSquare size={32} className="text-muted" />
                <h3>No project open</h3>
                <p>Open a folder to start managing terminals, files, source control, and plans.</p>
                <button className="btn btn-primary" type="button" onClick={handleOpenFolder}>Open project</button>
              </div>
            ) : null}

            {activeProjectPath ? (
              !activeTab ? (
                <div className="empty-state">
                  <LayoutTemplate size={32} className="text-muted" />
                  <h3>No tab open</h3>
                  <p>Click + in the tab bar to create a terminal, schematic, or chat tab.</p>
                </div>
              ) : activeTab.kind === "empty" ? (
                <ProjectSchematicTab projectPath={activeProjectPath} onOpenDescription={() => setDescriptionOpen(true)} />
              ) : activeTab.kind === "omp" ? (
                <OmpTerminalTab terminalId={activeTab.terminalId} onOutput={handleTerminalOutput} />
              ) : activeTab.kind === "chat" ? (
                <ChatPanel
                  projectPath={activeProjectPath}
                  chatSessionId={activeTab.chatSessionId}
                  onChatSessionCreated={handleChatSessionCreated(activeTab.id)}
                  draftPrompt={chatDraft}
                  onDraftConsumed={() => { setChatDraft(null); setChatDraftTabId(null); }}
                  activeSessionId={session.activeSessionId}
                  schematicContent={schematic.content}
                  onCreatePlanFromIdea={handleCreatePlanFromIdea}
                />
              ) : activeTab.kind === "file" ? (
                <FileViewer path={activeTab.filePath} />
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
          </div>
        </section>
        <div className="side-panel-wrapper">
          <div
            className="side-resizer"
            aria-orientation="vertical"
            title="Drag to resize side panel"
            onMouseDown={handleResizeStart}
          />
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
            }}
            onOpenChatSession={handleOpenChatSession}
          />
        </div>
      </main>
      <StatusBar onClick={() => setLogPanelOpen(true)} />
      <CrashReportNotice onViewReports={() => setDebugPanelOpen(true)} />
      <LogPanel open={logPanelOpen} onClose={() => setLogPanelOpen(false)} />
      {debugPanelOpen ? (
        <div className="debug-panel-overlay" role="dialog" aria-label="Debug Panel">
          <div className="debug-panel-modal">
            <div className="debug-panel-header">
              <h2>Debug Panel</h2>
              <button
                className="btn-icon"
                type="button"
                title="Close debug panel"
                aria-label="Close debug panel"
                onClick={() => setDebugPanelOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="debug-panel-body">
              <DebugPanel />
            </div>
          </div>
        </div>
      ) : null}
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

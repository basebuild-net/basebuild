import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, Settings2, TerminalSquare, X } from "lucide-react";

import { useSessionState } from "../../state/sessions";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import { ChatEnvironmentPanel } from "./ChatEnvironmentPanel";
import { FileExplorerModal } from "./FileExplorerModal";

import { EditPlanModal } from "./EditPlanModal";
import { FocusPlanModal } from "./FocusPlanModal";
import { ProjectDescriptionModal } from "./ProjectDescriptionModal";
import { useProjectSchematic } from "../../state/schematic";
import { revealInExplorer } from "../../lib/projects";
import { generateSessionTitle, readSkill } from "../../lib/skills";
import { getWorkspaceRestoreState, saveWorkspaceRestoreState, type WorkspaceRestoreState } from "../../lib/workspace";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { SettingsModal } from "./SettingsModal";
import { FirstRunModal } from "./FirstRunModal";
import { useFirstRun } from "../../state/first-run";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { OmpTerminalTab } from "../panels/OmpTerminalTab";
import { FileViewer } from "../panels/FileViewer";
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { ChatGrid } from "../panels/ChatGrid";
import { singleColumnGrid, type ChatGrid as ChatGridLayout } from "../../lib/gridMath";
import { parseTabGridStates, serializeTabGridStates } from "../../lib/workspace";
import { ompStatus } from "../../lib/omp";
import { stabilityRendererHeartbeat } from "../../lib/stability";
import { StatusBar } from "./StatusBar";
import { WindowControls } from "./WindowControls";
import { LogPanel } from "./LogPanel";
import { CrashReportNotice } from "./CrashReportNotice";
import { DebugPanel } from "../panels/DebugPanel";
import { useLogs } from "../../state/log";
import { useAccount } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import type { Plan, NewPlan, PlanFocusContext } from "../../lib/plans";
import type { IdeaCategory } from "../../lib/ideas";
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
  const [gridView, setGridView] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [plansFoldSignal, setPlansFoldSignal] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const { addLog } = useLogs();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [focusingPlan, setFocusingPlan] = useState<Plan | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const firstRun = useFirstRun();
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [chatDraftTabId, setChatDraftTabId] = useState<string | null>(null);
  const [autoSendDraft, setAutoSendDraft] = useState(false);
  const [focusedChatId, setFocusedChatId] = useState<string | null>(null);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<number | null>(null);
  const workspacePersistTimerRef = useRef<number | null>(null);
  const restoredProjectRef = useRef<string | null>(null);
  const [workspaceRestore, setWorkspaceRestore] = useState<WorkspaceRestoreState | null>(null);
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
    // Launch does not mint sessions: if sessions exist, select the most
    // recent (created_at DESC from the backend). Only create a session when
    // the project has zero sessions (first open) — never on restart.
    if (!activeProjectPath || session.activeSessionId) return;
    if (session.sessions.length > 0) {
      void session.selectSession(session.sessions[0].id);
    } else if (!session.activeSession) {
      void session.createSession();
    }
  }, [activeProjectPath, session.sessions.length, session.activeSessionId, session.activeSession, session]);

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
      restoredProjectRef.current = activeProjectPath;
    }).catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      addLog("warn", "Failed to restore workspace state", message);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, addLog]);

  // Hydrate per-tab grid states from the workspace restore snapshot.
  useEffect(() => {
    if (!workspaceRestore?.tabGridStates) return;
    session.hydrateTabGridStates(parseTabGridStates(workspaceRestore.tabGridStates));
  }, [workspaceRestore, session.hydrateTabGridStates]);


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
        sideCollapsed: workspaceRestore?.sideCollapsed ?? false,
        sideWidth: workspaceRestore?.sideWidth ?? 260,
        tabGridStates: serializeTabGridStates(session.tabGridStates),
        updatedAt: workspaceRestore?.updatedAt ?? 0,
      }).catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("warn", "Failed to persist workspace state", message);
      });
    }, 250);
    return () => {
      if (workspacePersistTimerRef.current) window.clearTimeout(workspacePersistTimerRef.current);
    };
  }, [activeProjectPath, session.activeSessionId, session.activeTabId, session.tabGridStates, workspaceRestore, sidebarCollapsed, addLog]);

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
  const handleOpenPlanningInspector = useCallback(() => {
    setPlansFoldSignal((v) => v + 1);
  }, []);

  const openOrFocusChat = useCallback(
    async (draftPrompt: string) => {
      if (!session.activeSessionId) return;
      // Find existing chat tab (prefer active, then most recent)
      const activeChat = session.tabs.find((t) => t.id === session.activeTabId && t.kind === "chat");
      const existingChat = activeChat ?? session.tabs.filter((t) => t.kind === "chat").slice(-1)[0] ?? null;
      if (existingChat) {
        session.setActiveTabId(existingChat.id);
      } else {
        const chatCount = session.tabs.filter((t) => t.kind === "chat").length + 1;
        await session.createTab("chat", `Chat ${chatCount}`);
      }
      // Inject the draft prompt — ChatPanel consumes it once
      setChatDraft(draftPrompt);
      setChatDraftTabId(session.activeTabId);
    },
    [session],
  );

  const handleSuggestForCategory = useCallback(
    (category: IdeaCategory | null) => {
      const prompt = category
        ? `Generate new ideas for the "${category.name}" category. ${category.description ?? ""}`.trim()
        : "Generate ideas for this project.";
      void openOrFocusChat(prompt);
    },
    [openOrFocusChat],
  );
  const handleStartSchematicWizard = useCallback(
    async (section?: string) => {
      if (!session.activeSessionId) return;
      let skillBody = "";
      try {
        const skill = await readSkill("basebuild-project-schematic");
        skillBody = skill.content;
      } catch {
        skillBody = "";
      }
      const target = section
        ? `Focus on the "${section}" section only. Read what the repository already says about it, prefill what you can, then ask the user one focused question to confirm or fill the gap. Do not rewrite other sections.`
        : `Start in Create mode (or Update mode if a schematic already exists). Begin with the Blueprint questions — archetype, team size, stage — since they scope every later answer. Then work through the remaining sections in template order.`;
      const prompt = `${skillBody}

---

You are now running the Project Schematic skill for this project. ${target}

Rules:
- Read the repository first (manifests, README, AGENTS.md, directory structure, recent git history) and prefill observable facts for confirmation instead of asking the user to recite them.
- Ask ONE question at a time. Wait for the user's answer before moving on.
- Let the user finish whenever they want — they can say "done" to stop, or keep going to add more context.
- Never fabricate facts. If something is not observable, ask.
- Do not write the schematic file until the user explicitly approves. When ready, show the full proposed document (or per-section diff) and ask for approval before writing to .basebuild/project-schematic.md.
- Keep it concise — readable in under three minutes.`;
      // Focus or create a chat tab, inject the prompt, and auto-send.
      const activeChat = session.tabs.find((t) => t.id === session.activeTabId && t.kind === "chat");
      const existingChat = activeChat ?? session.tabs.filter((t) => t.kind === "chat").slice(-1)[0] ?? null;
      if (existingChat) {
        session.setActiveTabId(existingChat.id);
      } else {
        const chatCount = session.tabs.filter((t) => t.kind === "chat").length + 1;
        await session.createTab("chat", `Chat ${chatCount}`);
      }
      setChatDraft(prompt);
      setChatDraftTabId(session.activeTabId);
      setAutoSendDraft(true);
    },
    [session],
  );

  const handleOpenSchematic = useCallback(() => {
    // Focus or create an "empty" tab (the schematic tab).
    const existingEmpty = session.tabs.find((t) => t.kind === "empty");
    if (existingEmpty) {
      session.setActiveTabId(existingEmpty.id);
    } else {
      void session.createTab("empty", "Schematic");
    }
  }, [session]);

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


  const activeTab = session.tabs.find((t) => t.id === session.activeTabId) ?? null;
  const handleCreateTab = useCallback(
    async (kind: "terminal" | "empty" | "chat" | "omp") => {
      if (!session.activeSessionId) return;
      if (kind === "empty") {
        await session.createTab("empty", "Schematic");
        return;
      }
      if (kind === "chat") {
        const chatCount = session.tabs.filter((t) => t.kind === "chat").length + 1;
        await session.createTab("chat", `Chat ${chatCount}`);
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
    <div className="app-container app-container-chat-first">
      <div className="window-taskbar" role="banner">
        <span className="window-taskbar-title" title="Basebuild">Basebuild</span>
        <div className="window-taskbar-right">
          <WindowControls />
        </div>
      </div>
      <main
        className="app-shell app-shell-chat-first"
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      >
        <ProjectChatSidebar
          activeProjectPath={activeProjectPath}
          activeSessionId={session.activeSessionId}
          projects={sidebar.projects}
          sessionsByProject={sidebar.sessionsByProject}
          account={account}
          updates={updates}
          onSelectProject={handleSelectProject}
          onOpenFolder={handleOpenFolder}
          onRemoveProject={handleRemoveProject}
          onSelectSession={session.selectSession}
          onCreateSession={handleCreateSession}
          onRenameSession={(id, title) => void session.renameSession(id, title)}
          onDeleteSession={(id) => void session.removeSession(id)}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <section className="workspace-panel workspace-panel-chat-first">
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
          <div className="workspace-scroll workspace-scroll-chat-first">
            {activeProjectPath ? (
              <ChatEnvironmentPanel
                projectPath={activeProjectPath}
                sessionId={session.activeSessionId}
                plans={plans}
                planCallbacks={{
                  onCreatePlan: handleCreatePlan,
                  onEditPlan: handleEditPlan,
                  onFocusPlan: handleFocusPlan,
                  onCopyReference: handleCopyReference,
                  onOpenInTerminal: handleOpenPlanInTerminal,
                }}
                onOpenChatSession={handleOpenChatSession}
                onSuggestForCategory={handleSuggestForCategory}
                activeChatSessionId={session.activeSessionId}
                onOpenFiles={() => setFileModalOpen(true)}
              />
            ) : null}
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
                <ProjectSchematicTab
                  projectPath={activeProjectPath}
                  onStartWizard={handleStartSchematicWizard}
                  onOpenRaw={() => setDescriptionOpen(true)}
                />
              ) : activeTab.kind === "chat" ? (
                <ChatGrid
                  grid={session.tabGridStates[activeTab.id] ?? singleColumnGrid(activeTab.chatSessionId ?? "new")}
                  onGridChange={(g) => session.setTabGrid(activeTab.id, g)}
                  renderChat={(chatId) => (
                    <ChatPanel
                      projectPath={activeProjectPath}
                      chatSessionId={chatId === "new" ? null : chatId}
                      onChatSessionCreated={(id) => {
                        void session.setTabChatSession(activeTab.id, id);
                      }}
                      draftPrompt={chatDraft}
                      autoSendDraft={autoSendDraft}
                      onDraftConsumed={() => { setChatDraft(null); setChatDraftTabId(null); setAutoSendDraft(false); }}
                      activeSessionId={session.activeSessionId}
                      schematicContent={schematic.content}
                      onCreatePlanFromIdea={handleCreatePlanFromIdea}
                      onOpenPlanningInspector={handleOpenPlanningInspector}
                      onOpenSchematic={handleOpenSchematic}
                    />
                  )}
                  focusedChatId={focusedChatId ?? activeTab.chatSessionId}
                  onFocusChat={setFocusedChatId}
                  onCloseChat={() => { /* session retained; grid handles removal */ }}
                  onAddChatBeside={() => { const id = `chat-${Date.now()}`; return id; }}
                  onDuplicateChat={() => { const id = `chat-${Date.now()}`; return id; }}
                  viewportWidth={typeof window !== "undefined" ? window.innerWidth - 80 : 1200}
                  viewportHeight={typeof window !== "undefined" ? window.innerHeight - 120 : 700}
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
      </main>
      <FileExplorerModal
        projectPath={activeProjectPath}
        open={fileModalOpen}
        onClose={() => setFileModalOpen(false)}
        onOpenFile={handleOpenFileInTab}
      />
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
        projectPath={activeProjectPath ?? ""}
        onClose={() => setFocusingPlan(null)}
        onSetStatus={plans.setPlanStatus}
        onCopyReference={handleCopyReference}
        onOpenInTerminal={handleOpenPlanInTerminal}
        onSetContext={(id, ctx: PlanFocusContext) => void plans.setPlanContext(id, ctx)}
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

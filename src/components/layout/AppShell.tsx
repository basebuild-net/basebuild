import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, Settings2, TerminalSquare, X } from "lucide-react";
import { deliverPrompt, type PromptMode } from "../../lib/promptDelivery";
import { DestinationPicker, type DestinationChoice } from "./DestinationPicker";

import { useSessionState } from "../../state/sessions";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { ActivitySidebar } from "./ActivitySidebar";
import { ChatEnvironmentPanel } from "./ChatEnvironmentPanel";
import { FileExplorerModal } from "./FileExplorerModal";
import { PlanningInspector } from "./PlanningInspector";
import { CommandStrip } from "./CommandStrip";
import { ToastStack } from "./ToastStack";
import { SourcePanel } from "../panels/SourcePanel";
import { EditPlanModal } from "./EditPlanModal";
import { FocusPlanModal } from "./FocusPlanModal";
import { ProjectDescriptionModal } from "./ProjectDescriptionModal";
import { useProjectSchematic } from "../../state/schematic";
import { revealInExplorer } from "../../lib/projects";
import { onPlanRunEvent } from "../../lib/planRuns";
import { generateSessionTitle, readSkill } from "../../lib/skills";
import { getWorkspaceRestoreState, saveWorkspaceRestoreState, type WorkspaceRestoreState } from "../../lib/workspace";
import { SettingsModal } from "./SettingsModal";
import { FirstRunModal } from "./FirstRunModal";
import { useFirstRun } from "../../state/first-run";
import { createTerminal } from "../../lib/terminal";
import { TerminalPanel } from "../panels/TerminalPanel";
import { FileViewer } from "../panels/FileViewer";
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { PanelGrid } from "../panels/PanelGrid";
import { PanelStatusProvider } from "../panels/PanelStatusContext";
import { HistoryDrawer } from "../panels/HistoryDrawer";
import {
  closePanel,
  deletePanelFromHistory,
  detectOrphanedTabs,
  emptyGrid,
  flattenPanels,
  insertPanel,
  newPanelId,
  parsePanelGrid,
  parsePanelGridWithDiagnostics,
  removePanelFromGrid,
  reopenPanel,
  repairActivePanelId,
  serializePanelGrid,
  singlePanelGrid,
  splitPanelAt,
  updatePanelInTree,
  type DropSide,
  type Panel,
  type PanelGridState,
  type PanelType,
} from "../../lib/panelGrid";
import { parseTabGridStates, serializeTabGridStates } from "../../lib/workspace";
import { ompStatus } from "../../lib/omp";
import { stabilityRendererHeartbeat } from "../../lib/stability";
import { OmpTerminalTab } from "../panels/OmpTerminalTab";
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
import type { SessionTab, TabKind } from "../../lib/sessions";
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
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [plansModalOpen, setPlansModalOpen] = useState(false);
  const [commandStripCollapsed, setCommandStripCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const { addLog } = useLogs();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [focusingPlan, setFocusingPlan] = useState<Plan | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const firstRun = useFirstRun();
  // Prompts queued for new panels that don't have a chatSessionId yet.
  // Flushed in onChatSessionCreated once the native session is created.
  const pendingNewPanelPrompts = useRef<Map<string, { text: string; mode: PromptMode }>>(new Map());
  // Destination picker state — when open, the pending prompt is held here
  // until the user picks a destination (or cancels).
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [pendingDelivery, setPendingDelivery] = useState<{ text: string; mode: PromptMode } | null>(null);
  const [focusedChatId, setFocusedChatId] = useState<string | null>(null);
  const [panelGridState, setPanelGridState] = useState<PanelGridState>(emptyGrid());
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState("");
  const titleDebounceRef = useRef<number | null>(null);
  const workspacePersistTimerRef = useRef<number | null>(null);
  const restoredProjectRef = useRef<string | null>(null);
  // Project-keyed loading boundary: panel mutations are disabled until the
  // selected project's restore resolves. A generation token guards late
  // restore responses from a prior project so they cannot hydrate the grid.
  const [projectRestoreLoading, setProjectRestoreLoading] = useState(false);
  const restoreGenerationRef = useRef(0);
  // Per-type in-flight guard serializing rapid repeated creation clicks so
  // one click creates exactly one panel + one backing resource.
  const creatingInFlightRef = useRef<Set<string>>(new Set());
  // Ref indirection so openOrFocusChat (defined before handleCreateTypedPanel)
  // can call it without a forward-reference error.
  const handleCreateTypedPanelRef = useRef<(type: "chat" | "terminal" | "omp" | "schematic", pendingPrompt?: { text: string; mode: PromptMode }) => void>(() => {});
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
  // Auto-create a chat panel when the panel grid is empty and a session is active.
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId) return;
    if (panelGridState.root) return; // grid already has panels
    if (session.activeSession?.title === "New Session") return;
    const newPanel: Panel = {
      id: newPanelId(),
      type: "chat",
      title: "Chat 1",
      chatSessionId: null,
      terminalId: null,
      filePath: null,
    };
    setPanelGridState(singlePanelGrid(newPanel));
  }, [activeProjectPath, session.activeSessionId, panelGridState.root, session.activeSession?.title]);

  // Auto-select the most recent project when none is active. Setting the
  // path is enough: the `useProjectSidebar` effect runs detection once.
  useEffect(() => {
    if (activeProjectPath || sidebar.projects.length === 0) return;
    setActiveProjectPath(sidebar.projects[0].path);
  }, [activeProjectPath, sidebar]);

  useEffect(() => {
    if (!activeProjectPath) {
      setWorkspaceRestore(null);
      restoredProjectRef.current = null;
      loggedOrphanIdsRef.current.clear();
      return;
    }
    // Project-keyed loading boundary: disable panel mutations until this
    // project's restore resolves. The generation token ensures a late
    // response from a prior project cannot hydrate the current grid.
    const generation = ++restoreGenerationRef.current;
    loggedOrphanIdsRef.current.clear();
    let cancelled = false;
    void getWorkspaceRestoreState(activeProjectPath).then((state) => {
      if (cancelled || generation !== restoreGenerationRef.current) return;
      setWorkspaceRestore(state);
      setSidebarCollapsed(state.sidebarCollapsed);
      restoredProjectRef.current = activeProjectPath;
      setProjectRestoreLoading(false);
    }).catch((caught) => {
      if (cancelled || generation !== restoreGenerationRef.current) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      addLog("warn", "Failed to restore workspace state", message);
      setProjectRestoreLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, addLog]);
  // Plan-run event listener: when a run starts with a chat session, surface
  // it as a new panel in the panel grid (per `panel-grid`).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onPlanRunEvent((event) => {
      if (event.status !== "running" || !event.chatSessionId) return;
      // If the chat session is already a panel in the grid, just focus it.
      const existingPanel = flattenPanels(panelGridState.root).find((p) => p.chatSessionId === event.chatSessionId);
      if (existingPanel) {
        setPanelGridState((prev) => ({ ...prev, activePanelId: existingPanel.id }));
        return;
      }
      // Add as a new panel through the checked insertion contract.
      const newPanel: Panel = {
        id: event.chatSessionId ?? newPanelId(),
        type: "chat",
        title: event.chatSessionId ? `Run ${event.chatSessionId.slice(-6)}` : "Plan Run",
        chatSessionId: event.chatSessionId ?? null,
        terminalId: null,
        filePath: null,
      };
      setPanelGridState((prev) => {
        const result = insertPanel(prev, newPanel, { side: "right", anchorId: prev.activePanelId });
        if (!result.ok) {
          addLog("error", "Plan-run panel creation failed", result.reason);
          return prev;
        }
        return result.state;
      });
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [panelGridState.root]);
  // Hydrate per-tab grid states from the workspace restore snapshot.
  useEffect(() => {
    if (!workspaceRestore?.tabGridStates) return;
    session.hydrateTabGridStates(parseTabGridStates(workspaceRestore.tabGridStates));
  }, [workspaceRestore, session.hydrateTabGridStates]);
  // Hydrate panel grid state from the workspace restore snapshot. Normalizes
  // the restored blob, logs repair diagnostics, and writes back the repaired
  // state only after this project's restore ownership is established (the
  // persist effect below checks restoredProjectRef).
  useEffect(() => {
    if (!workspaceRestore?.panelGrid) return;
    const { state, diagnostics, repaired } = parsePanelGridWithDiagnostics(workspaceRestore.panelGrid);
    setPanelGridState(state);
    if (repaired) {
      for (const d of diagnostics) {
        addLog("warn", "Repaired panel grid state", `${d.kind}: ${d.message}`);
      }
    }
  }, [workspaceRestore, addLog]);
  // Detect orphaned backing tabs after restore or when tabs change —
  // non-destructive: log only, never delete. Each orphan is logged once.
  const loggedOrphanIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const orphans = detectOrphanedTabs(panelGridState, session.tabs);
    for (const o of orphans) {
      if (loggedOrphanIdsRef.current.has(o.tabId)) continue;
      loggedOrphanIdsRef.current.add(o.tabId);
      addLog("warn", "Orphaned session tab recovered", `Tab ${o.tabId} (${o.kind}) has no reachable panel; recover it from history or delete it explicitly.`);
    }
  }, [panelGridState, session.tabs, addLog]);


  useEffect(() => {
    if (!activeProjectPath || restoredProjectRef.current !== activeProjectPath) return;
    // Capture the project path + state this save belongs to. Even if the
    // user switches projects before the timer fires, the save is written
    // against the captured project, not the current one.
    const saveProjectPath = activeProjectPath;
    const saveSessionId = session.activeSessionId;
    const saveTabId = session.activeTabId;
    const saveTabGridStates = serializeTabGridStates(session.tabGridStates);
    const savePanelGrid = serializePanelGrid(panelGridState);
    const saveSidebarCollapsed = sidebarCollapsed;
    const saveRestoreSnapshot = workspaceRestore;
    if (workspacePersistTimerRef.current) window.clearTimeout(workspacePersistTimerRef.current);
    workspacePersistTimerRef.current = window.setTimeout(() => {
      workspacePersistTimerRef.current = null;
      void saveWorkspaceRestoreState({
        projectPath: saveProjectPath,
        lastSessionId: saveSessionId,
        lastTabId: saveTabId,
        sideSection: saveRestoreSnapshot?.sideSection ?? "plans",
        sidebarCollapsed: saveSidebarCollapsed,
        sideCollapsed: saveRestoreSnapshot?.sideCollapsed ?? false,
        sideWidth: saveRestoreSnapshot?.sideWidth ?? 260,
        tabGridStates: saveTabGridStates,
        panelGrid: savePanelGrid,
        updatedAt: saveRestoreSnapshot?.updatedAt ?? 0,
      }).catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("warn", "Failed to persist workspace state", message);
      });
    }, 250);
    return () => {
      if (workspacePersistTimerRef.current) window.clearTimeout(workspacePersistTimerRef.current);
    };
  }, [activeProjectPath, session.activeSessionId, session.activeTabId, session.tabGridStates, workspaceRestore, sidebarCollapsed, panelGridState, addLog]);

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
      // Only set the path — the `useProjectSidebar` effect runs detection
      // once. Calling `selectProject` here too would duplicate diagnostics.
      try {
        setActiveProjectPath(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog("error", `Failed to select project ${path}`, message);
      }
    },
    [addLog],
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

  /** Commit a checked panel insertion. Resolves a valid live anchor (or
   *  accepts the panel as the sole root for an empty grid), verifies the new
   *  panel appears exactly once, and logs an actionable error on failure.
   *  Returns true on success. A stale `activePanelId` / anchor never becomes
   *  a silent no-op. Panel mutations are blocked while a project restore is
   *  loading (project-keyed boundary). */
  const commitInsert = useCallback(
    (panel: Panel, anchorId: string | null = null, side: DropSide = "right"): boolean => {
      if (projectRestoreLoading) {
        addLog("warn", "Panel creation blocked", "The project is still loading; please wait.");
        return false;
      }
      const result = insertPanel(panelGridState, panel, { side, anchorId });
      if (!result.ok) {
        addLog("error", "Panel creation failed", result.reason);
        return false;
      }
      setPanelGridState(result.state);
      return true;
    },
    [panelGridState, projectRestoreLoading, addLog],
  );

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
    setPlansModalOpen(true);
  }, []);

  const handleCloseChat = useCallback((chatId: string) => {
    // The grid's onCloseChat handles the visual removal; the session is retained.
    // AppShell's onCloseChat on the grid delegates here for any session-level cleanup.
  }, []);

  const handleDuplicateChat = useCallback((sourceId: string) => {
    // Returns a new chat id; the grid handles layout. Session creation happens
    // when ChatPanel mounts and calls onChatSessionCreated.
  }, []);
  const openOrFocusChat = useCallback(
    async (draftPrompt: string) => {
      if (!session.activeSessionId) return;
      // Find existing chat tab (prefer active, then most recent)
      const activeChat = session.tabs.find((t) => t.id === session.activeTabId && t.kind === "chat");
      const existingChat = activeChat ?? session.tabs.filter((t) => t.kind === "chat").slice(-1)[0] ?? null;
      if (existingChat) {
        session.setActiveTabId(existingChat.id);
        if (existingChat.chatSessionId) {
          deliverPrompt({ chatSessionId: existingChat.chatSessionId, text: draftPrompt, mode: "insert" });
        } else {
          pendingNewPanelPrompts.current.set(existingChat.id, { text: draftPrompt, mode: "insert" });
        }
      } else {
        handleCreateTypedPanelRef.current("chat", { text: draftPrompt, mode: "insert" });
      }
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
- Use the \`ask_user\` tool for every question — it presents clickable option cards instead of prose. One question at a time; wait for the user's answer before moving on.
- Let the user finish whenever they want — they can say "done" to stop, or keep going to add more context.
- Never fabricate facts. If something is not observable, ask.
- Do not write the schematic file until the user explicitly approves. When ready, use \`ask_user\` with a confirm question to get approval, then write to .basebuild/project-schematic.md.
- Keep it concise — readable in under three minutes.`;
      // Open the destination picker — the user chooses which chat gets
      // the wizard prompt. The delivery happens in the picker's onSelect.
      setPendingDelivery({ text: prompt, mode: "send" });
      setDestinationPickerOpen(true);
    },
    [session],
  );

  const handleOpenSchematic = useCallback(() => {
    // Focus or create a schematic panel in the grid (not a legacy empty tab).
    const allPanels = flattenPanels(panelGridState.root);
    const existing = allPanels.find((p) => p.type === "schematic");
    if (existing) {
      setPanelGridState((prev) => ({ ...prev, activePanelId: existing.id }));
      return;
    }
    const newPanel: Panel = {
      id: newPanelId(),
      type: "schematic",
      title: "Schematic",
      chatSessionId: null,
      terminalId: null,
      filePath: null,
    };
    commitInsert(newPanel, panelGridState.activePanelId, "right");
  }, [panelGridState, commitInsert]);

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

  const handleOpenPlanInTerminal = useCallback((plan: Plan) => {
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
  /** Create a new panel for the panel grid (split/duplicate handler).
   *  Returns the panel to insert; the caller (`PanelGrid`) performs the
   *  actual `splitPanelAt`. Uses a collision-resistant id. */
  const handleCreatePanel = useCallback(
    (anchorId: string | null, _side: DropSide): Panel => {
      const id = newPanelId();
      if (!session.activeSessionId) {
        return { id, type: "chat", title: "Chat", chatSessionId: null, terminalId: null, filePath: null };
      }
      const chatCount = session.tabs.filter((t) => t.kind === "chat").length + 1;
      void session.createTab("chat", `Chat ${chatCount}`);
      return { id, type: "chat", title: `Chat ${chatCount}`, chatSessionId: null, terminalId: null, filePath: null };
    },
    [session],
  );

  /** Create a panel of a specific type (chat, terminal, omp, schematic).
   *  Resource-backed creation is transactional: a visible `creating` panel is
   *  reserved before the tab/process is acquired, then bound on success or
   *  rolled back on failure. Rapid clicks are serialized by a per-type
   *  in-flight guard so one click creates exactly one panel + one resource. */
  const handleCreateTypedPanel = useCallback(
    (type: "chat" | "terminal" | "omp" | "schematic", pendingPrompt?: { text: string; mode: PromptMode }): void => {
      if (!session.activeSessionId) return;
      if (projectRestoreLoading) {
        addLog("warn", "Panel creation blocked", "The project is still loading; please wait.");
        return;
      }
      // Serialize rapid repeated clicks per type.
      if (creatingInFlightRef.current.has(type)) return;
      creatingInFlightRef.current.add(type);
      const releaseGuard = () => creatingInFlightRef.current.delete(type);

      const panelId = newPanelId();
      const reserve = (kind: Panel["type"], title: string): Panel => ({
        id: panelId,
        type: kind,
        title,
        chatSessionId: null,
        terminalId: null,
        filePath: null,
        creating: true,
      });

      if (type === "chat") {
        const chatCount = session.tabs.filter((t) => t.kind === "chat").length + 1;
        const pending = reserve("chat", `Chat ${chatCount}`);
        if (!commitInsert(pending, panelGridState.activePanelId, "right")) {
          releaseGuard();
          return;
        }
        // Acquire the chat tab after the reservation is visible.
        void (async () => {
          try {
            const tab = await session.createTab("chat", `Chat ${chatCount}`);
            // The chatSessionId is linked later by ChatPanel via
            // onChatSessionCreated. Keep `creating: true` until then so
            // orphan detection doesn't flag the in-flight tab.
            if (!tab) {
              addLog("warn", "Chat tab creation returned no tab", panelId);
            } else if (pendingPrompt) {
              pendingNewPanelPrompts.current.set(tab.id, pendingPrompt);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog("error", "Chat tab creation failed", message);
            setPanelGridState((prev) => removePanelFromGrid(prev, panelId));
          } finally {
            releaseGuard();
          }
        })();
        return;
      }

      if (type === "terminal" || type === "omp") {
        const shell = type === "omp" ? "omp" : DEFAULT_SHELL();
        const baseTitle = type === "omp" ? "Oh My Pi" : "Terminal";
        const pending = reserve(type, baseTitle);
        if (!commitInsert(pending, panelGridState.activePanelId, "right")) {
          releaseGuard();
          return;
        }
        void (async () => {
          try {
            const term = await createTerminal(shell, activeProjectPath ?? undefined);
            await session.createTab(type, type === "omp" ? "Oh My Pi" : `Terminal ${term.id}`, term.id);
            // Bind the terminal id and clear `creating`.
            setPanelGridState((prev) => ({
              ...prev,
              root: updatePanelInTree(prev.root, panelId, {
                terminalId: term.id,
                title: type === "omp" ? "Oh My Pi" : `Terminal ${term.id}`,
                creating: false,
              }),
            }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog("error", `${baseTitle} creation failed`, message);
            // Roll back the reservation; no terminal record was bound.
            setPanelGridState((prev) => removePanelFromGrid(prev, panelId));
          } finally {
            releaseGuard();
          }
        })();
        return;
      }

      // schematic — no backing resource, insert directly.
      const panel: Panel = { id: panelId, type: "schematic", title: "Schematic", chatSessionId: null, terminalId: null, filePath: null };
      commitInsert(panel, panelGridState.activePanelId, "right");
      releaseGuard();
    },
    [session, activeProjectPath, projectRestoreLoading, panelGridState, commitInsert, addLog],
  );
  handleCreateTypedPanelRef.current = handleCreateTypedPanel;

  /** Render a panel's content by type. */
  const renderPanel = useCallback(
    (panel: Panel, _isActive: boolean) => {
      if (panel.type === "chat") {
        // Find the tab for this panel — primary lookup is chatSessionId
        // (stable across restarts); fall back to title/id for legacy panels.
        const tab = session.tabs.find(
          (t) => t.kind === "chat" && (
            (panel.chatSessionId && t.chatSessionId === panel.chatSessionId) ||
            t.title === panel.title ||
            t.id === panel.id
          ),
        );
        return (
          <ChatPanel
            projectPath={activeProjectPath ?? ""}
            chatSessionId={panel.chatSessionId ?? tab?.chatSessionId ?? null}
            onChatSessionCreated={(chatSessionId) => {
              if (tab) {
                void session.setTabChatSession(tab.id, chatSessionId);
                // Flush any prompt queued for this tab before its session existed.
                const pending = pendingNewPanelPrompts.current.get(tab.id);
                if (pending) {
                  pendingNewPanelPrompts.current.delete(tab.id);
                  deliverPrompt({ chatSessionId, text: pending.text, mode: pending.mode });
                }
              }
              // Also update the panel's chatSessionId in the grid so the link
              // persists across restarts.
              setPanelGridState((prev) => ({
                ...prev,
                root: updatePanelInTree(prev.root, panel.id, { chatSessionId, creating: false }),
              }));
            }}
            onOpenPlanningInspector={handleOpenPlanningInspector}
            onOpenSchematic={handleOpenSchematic}
            onCloseChat={() => setPanelGridState((prev) => closePanel(prev, panel.id))}
            onCloseAndDeleteChat={() => setPanelGridState((prev) => deletePanelFromHistory(prev, panel.id))}
            onDuplicateChat={() => {
              const newPanel = handleCreatePanel(panel.id, "right");
              commitInsert(newPanel, panel.id, "right");
            }}
          />
        );
      }
      if (panel.type === "terminal") {
        if (!panel.terminalId) {
          // Try to find a terminal tab by title match (legacy panels).
          const tab = session.tabs.find((t) => t.kind === "terminal" && (t.id === panel.id || t.title === panel.title));
          if (tab?.terminalId) {
            return <TerminalPanel terminalId={tab.terminalId} onOutput={handleTerminalOutput} />;
          }
          return (
            <div className="empty-state">
              <TerminalSquare size={32} className="text-muted" />
              <h3>Terminal not connected</h3>
              <p>The terminal process from the previous session is no longer running.</p>
              <button
                className="btn btn-primary"
                type="button"
                title="Create a new terminal"
                onClick={() => {
                  void (async () => {
                    const shell = DEFAULT_SHELL();
                    const term = await createTerminal(shell, activeProjectPath ?? undefined);
                    setPanelGridState((prev) => ({
                      ...prev,
                      root: updatePanelInTree(prev.root, panel.id, {
                        terminalId: term.id,
                        title: `Terminal ${term.id}`,
                      }),
                    }));
                  })();
                }}
              >
                Reconnect
              </button>
            </div>
          );
        }
        return (
          <TerminalPanel
            terminalId={panel.terminalId}
            onOutput={handleTerminalOutput}
            onReconnect={() => {
              void (async () => {
                const shell = DEFAULT_SHELL();
                const term = await createTerminal(shell, activeProjectPath ?? undefined);
                setPanelGridState((prev) => ({
                  ...prev,
                  root: updatePanelInTree(prev.root, panel.id, {
                    terminalId: term.id,
                    title: `Terminal ${term.id}`,
                  }),
                }));
              })();
            }}
          />
        );
      }
      if (panel.type === "file") {
        if (!panel.filePath) return null;
        return <FileViewer path={panel.filePath} />;
      }
      if (panel.type === "schematic") {
        return (
          <ProjectSchematicTab
            projectPath={activeProjectPath ?? ""}
            onStartWizard={handleStartSchematicWizard}
            onOpenRaw={() => setDescriptionOpen(true)}
          />
        );
      }
      if (panel.type === "omp") {
        const reconnectOmp = () => {
          void (async () => {
            const shell = DEFAULT_SHELL();
            const term = await createTerminal(shell, activeProjectPath ?? undefined);
            setPanelGridState((prev) => ({
              ...prev,
              root: updatePanelInTree(prev.root, panel.id, {
                terminalId: term.id,
                title: `OMP ${term.id}`,
              }),
            }));
          })();
        };
        if (panel.terminalId) {
          return <OmpTerminalTab terminalId={panel.terminalId} onOutput={handleTerminalOutput} onReconnect={reconnectOmp} />;
        }
        const tab = session.tabs.find((t) => t.kind === "omp" && (t.id === panel.id || t.title === panel.title));
        return <OmpTerminalTab terminalId={tab?.terminalId ?? null} onOutput={handleTerminalOutput} onReconnect={reconnectOmp} />;
      }
      return null;
    },
    [session, activeProjectPath, schematic.content, handleCreatePlanFromIdea, handleOpenPlanningInspector, handleOpenSchematic, handleTerminalOutput, handleStartSchematicWizard],
  );

  /** Handle panel grid state changes. */
  const handlePanelGridChange = useCallback(
    (newState: PanelGridState) => {
      setPanelGridState(newState);
    },
    [],
  );

  /** Handle closing a panel → moves to history. */
  const handlePanelClose = useCallback(
    (panelId: string) => {
      setPanelGridState((prev) => closePanel(prev, panelId));
    },
    [],
  );

  /** Handle reopening a panel from history. */
  const handlePanelReopen = useCallback(
    (panelId: string) => {
      setPanelGridState((prev) => reopenPanel(prev, panelId));
    },
    [],
  );

  /** Handle deleting a panel from history permanently. */
  const handlePanelDelete = useCallback(
    (panelId: string) => {
      // Confirm-gated: the caller (HistoryDrawer) handles the confirm UI.
      // For chat panels, delete the session; for terminals, discard.
      const panel = panelGridState.closedPanels.find((p) => p.id === panelId);
      if (panel?.chatSessionId) {
        void session.removeSession(panel.chatSessionId);
      }
      setPanelGridState((prev) => deletePanelFromHistory(prev, panelId));
    },
    [panelGridState.closedPanels, session],
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

  const handleOpenFileInTab = useCallback(
    async (filePath: string) => {
      if (!session.activeSessionId) return;
      const name = filePath.split(/[\\/]/).pop() ?? filePath;

      // Check if this file is already open in any panel — if so, focus it.
      const allPanels = flattenPanels(panelGridState.root);
      const existing = allPanels.find((p) => p.type === "file" && p.filePath === filePath);
      if (existing) {
        setPanelGridState((prev) => ({ ...prev, activePanelId: existing.id }));
        return;
      }

      // VSCode-style preview: if the active panel is a file panel that hasn't
      // been modified (we track this via the panel's `filePath` only — no dirty
      // state tracking yet), replace its file instead of creating a new panel.
      const activeId = panelGridState.activePanelId;
      const activePanel = allPanels.find((p) => p.id === activeId);
      if (activePanel?.type === "file") {
        // Replace the file in the active file panel (preview behavior).
        setPanelGridState((prev) => ({
          ...prev,
          root: updatePanelInTree(prev.root, activePanel.id, {
            filePath,
            title: name,
          }),
        }));
        return;
      }

      // Otherwise, create a new file panel through the checked insertion contract.
      const newPanel: Panel = {
        id: newPanelId(),
        type: "file",
        title: name,
        chatSessionId: null,
        terminalId: null,
        filePath,
      };
      commitInsert(newPanel, panelGridState.activePanelId, "right");
    },
    [session, panelGridState, commitInsert],
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
        <ActivitySidebar
          activeProjectPath={activeProjectPath}
          root={panelGridState.root}
          activePanelId={panelGridState.activePanelId}
          closedPanelCount={panelGridState.closedPanels.length}
          projects={sidebar.projects}
          account={account}
          updates={updates}
          onSelectProject={handleSelectProject}
          onOpenFolder={handleOpenFolder}
          onFocusPanel={(panelId) => setPanelGridState((prev) => ({ ...prev, activePanelId: panelId }))}
          onCreateChat={() => handleCreateTypedPanel("chat")}
          onCreateTerminal={() => handleCreateTypedPanel("terminal")}
          onOpenHistory={() => setHistoryDrawerOpen(true)}
          onOpenPlans={() => setPlansModalOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <section className="workspace-panel workspace-panel-chat-first">
          {activeProjectPath && session.activeSessionId ? (
            <div className="session-header">
              <h1 className="session-title">{activeProjectPath.split(/[\\/]/).pop() ?? activeProjectPath}</h1>
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
                onOpenChanges={() => setChangesModalOpen(true)}
                onOpenPlans={() => setPlansModalOpen(true)}
                onCreatePanel={handleCreateTypedPanel}
              />
              <CommandStrip
                plans={plans.plans}
                ideaCount={0}
                schematicHealth={schematic.report ? (schematic.report.health === "complete" ? "complete" : "incomplete") : "none"}
                onOpenPlans={() => setPlansModalOpen(true)}
                collapsed={commandStripCollapsed}
                onToggleCollapse={() => setCommandStripCollapsed((v) => !v)}
              />
              <span className="status-pill session-path-pill" title={activeProjectPath}>{activeProjectPath}</span>
            </div>
          ) : null}
          <div className="workspace-scroll workspace-scroll-chat-first">
            {!activeProjectPath ? (
              <div className="empty-state">
                <TerminalSquare size={32} className="text-muted" />
                <h3>No project open</h3>
                <p>Open a folder to start managing terminals, files, source control, and plans.</p>
                <button className="btn btn-primary" type="button" onClick={handleOpenFolder}>Open project</button>
              </div>
            ) : null}
            {activeProjectPath ? (
              <PanelStatusProvider>
                <PanelGrid
                  state={panelGridState}
                  onStateChange={handlePanelGridChange}
                  renderPanel={renderPanel}
                  onCreatePanel={handleCreatePanel}
                  viewportWidth={typeof window !== "undefined" ? window.innerWidth - 80 : 1200}
                  viewportHeight={typeof window !== "undefined" ? window.innerHeight - 120 : 700}
                />
                {historyDrawerOpen ? (
                  <HistoryDrawer
                    closedPanels={panelGridState.closedPanels}
                    onReopen={handlePanelReopen}
                    onDelete={handlePanelDelete}
                    onClose={() => setHistoryDrawerOpen(false)}
                  />
                ) : null}
              </PanelStatusProvider>
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
      {changesModalOpen && activeProjectPath ? (
        <div className="modal-overlay" role="dialog" aria-label="Changes" onClick={() => setChangesModalOpen(false)}>
          <div className="modal modal-changes" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Changes</h2>
              <button className="btn-icon" type="button" title="Close (Esc)" onClick={() => setChangesModalOpen(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <SourcePanel projectPath={activeProjectPath} />
            </div>
          </div>
        </div>
      ) : null}
      {plansModalOpen && activeProjectPath ? (
        <div className="modal-overlay" role="dialog" aria-label="Plans & Ideas" onClick={() => setPlansModalOpen(false)}>
          <div className="modal modal-plans" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Plans & Ideas</h2>
              <button className="btn-icon" type="button" title="Close (Esc)" onClick={() => setPlansModalOpen(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <PlanningInspector
                sessionId={session.activeSessionId}
                projectPath={activeProjectPath}
                plans={plans.plans}
                loading={plans.loading}
                collapsed={false}
                onToggleCollapse={() => {}}
                hostContext="modal"
                onCreatePlan={() => { setPlansModalOpen(false); handleCreatePlan(); }}
                onEditPlan={(p) => { setPlansModalOpen(false); handleEditPlan(p); }}
                onFocusPlan={handleFocusPlan}
                onCopyReference={handleCopyReference}
                onOpenInTerminal={handleOpenPlanInTerminal}
                onSetPlanStatus={plans.setPlanStatus}
                onDeletePlan={plans.deletePlan}
                onOpenChatSession={(id) => { setPlansModalOpen(false); handleOpenChatSession(id); }}
                onSuggestForCategory={handleSuggestForCategory}
                activeChatSessionId={session.activeSessionId}
                showHeader={false}
              />
            </div>
          </div>
        </div>
      ) : null}
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
      <ToastStack />
      <DestinationPicker
        open={destinationPickerOpen}
        onClose={() => { setDestinationPickerOpen(false); setPendingDelivery(null); }}
        panels={flattenPanels(panelGridState.root)}
        title="Send wizard to…"
        onSelect={(choice: DestinationChoice) => {
          if (!pendingDelivery) return;
          if (choice.kind === "existing") {
            deliverPrompt({
              chatSessionId: choice.chatSessionId,
              text: pendingDelivery.text,
              mode: pendingDelivery.mode,
            });
            // Focus the panel that hosts this chat.
            setPanelGridState((prev) => ({ ...prev, activePanelId: choice.panelId }));
          } else {
            // New conversation — create a chat panel + backing tab, queue the prompt.
            handleCreateTypedPanel("chat", { text: pendingDelivery.text, mode: pendingDelivery.mode });
          }
          setPendingDelivery(null);
        }}
      />
    </div>
  );
}

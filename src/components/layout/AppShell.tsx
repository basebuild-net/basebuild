import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Info, LayoutTemplate, Settings2, TerminalSquare, X, XCircle } from "lucide-react";
import { deliverPrompt, type DeliveryAction, type PromptMode } from "../../lib/promptDelivery";
import { markStart, markEnd } from "../../lib/timing";
import { generateCategoriesAction, generateFromFinishedPlansAction, generateIdeasAction, schematicWizardAction, type PlanningAction } from "../../lib/planningActions";
import { DestinationPicker, type DestinationChoice } from "./DestinationPicker";
import { WorkspaceSplash, type RestorePhase } from "./WorkspaceSplash";
import { ProjectSwitchingOverlay } from "./ProjectSwitchingOverlay";
import { IdeaRoundGate } from "./IdeaRoundGate";
import { startIdeaRound, finishIdeaRound } from "../../lib/ideaRounds";

export type ToastKind = "success" | "warning" | "error" | "info";

const TOAST_ICONS: Record<ToastKind, { icon: typeof CheckCircle; className: string }> = {
  success: { icon: CheckCircle, className: "toast-icon-success" },
  warning: { icon: AlertTriangle, className: "toast-icon-warning" },
  error: { icon: XCircle, className: "toast-icon-error" },
  info: { icon: Info, className: "toast-icon-info" },
};

import { useSessionState } from "../../state/sessions";
import { useZoom } from "../../state/useZoom";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { ActivitySidebar } from "./ActivitySidebar";
import { ChatEnvironmentPanel } from "./ChatEnvironmentPanel";
const FileExplorerModal = lazy(() => import("./FileExplorerModal").then((m) => ({ default: m.FileExplorerModal })));
import { PlanningInspector } from "./PlanningInspector";
import type { PlanningTab } from "./PlanningInspector";
const EditPlanModal = lazy(() => import("./EditPlanModal").then((m) => ({ default: m.EditPlanModal })));
const FocusPlanModal = lazy(() => import("./FocusPlanModal").then((m) => ({ default: m.FocusPlanModal })));
const SourcePanel = lazy(() => import("../panels/SourcePanel").then((m) => ({ default: m.SourcePanel })));
const SettingsModal = lazy(() => import("./SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ProjectDescriptionModal = lazy(() => import("./ProjectDescriptionModal").then((m) => ({ default: m.ProjectDescriptionModal })));
import { PlanningIndicators, type StageKey } from "./PlanningIndicators";
import { ToastStack } from "./ToastStack";
import { useProjectSchematic } from "../../state/schematic";
import { getLastFocusedProject, revealInExplorer, setLastFocusedProject } from "../../lib/projects";
import { onPlanRunEvent } from "../../lib/planRuns";
import { generateSessionTitle, readSkill } from "../../lib/skills";
import { getWorkspaceRestoreState, saveWorkspaceRestoreState, type WorkspaceRestoreState } from "../../lib/workspace";
import { FirstRunModal } from "./FirstRunModal";
import { useFirstRun } from "../../state/first-run";
import { getLastGrounding } from "../../state/grounding";
import { createTerminal } from "../../lib/terminal";
const TerminalPanel = lazy(() => import("../panels/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const FileViewer = lazy(() => import("../panels/FileViewer").then((m) => ({ default: m.FileViewer })));
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { PanelGrid } from "../panels/PanelGrid";
import { PanelStatusProvider } from "../panels/PanelStatusContext";
const HistoryDrawer = lazy(() => import("../panels/HistoryDrawer").then((m) => ({ default: m.HistoryDrawer })));
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
const OmpTerminalTab = lazy(() => import("../panels/OmpTerminalTab").then((m) => ({ default: m.OmpTerminalTab })));
import { ModalLoading } from "./ModalLoading";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { WindowControls } from "./WindowControls";
const LogPanel = lazy(() => import("./LogPanel").then((m) => ({ default: m.LogPanel })));
import { CrashReportNotice } from "./CrashReportNotice";
const DebugPanel = lazy(() => import("../panels/DebugPanel").then((m) => ({ default: m.DebugPanel })));
import { useLogs } from "../../state/log";
import { useAccount } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import type { Plan, NewPlan, PlanFocusContext } from "../../lib/plans";
import type { IdeaCategory } from "../../lib/ideas";
import { useIdeaState } from "../../state/ideas";
import type { SessionTab, TabKind } from "../../lib/sessions";
import { deleteSession } from "../../lib/sessions";
import { renameNativeChatSession } from "../../lib/native-chat";
import { assignPlanWithProfile, type LaunchProfile } from "../../lib/planDependencies";
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
  useZoom(); // Ctrl+/-/0 keyboard shortcuts; visible - 100% + indicator removed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [gridView, setGridView] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [plansFoldSignal, setPlansFoldSignal] = useState(0);
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [plansModalOpen, setPlansModalOpen] = useState(false);
  const [plansModalTab, setPlansModalTab] = useState<PlanningTab>("plans");
  const [schematicModalOpen, setSchematicModalOpen] = useState(false);
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
  const pendingNewPanelPrompts = useRef<Map<string, { text: string; mode: PromptMode; action?: DeliveryAction }>>(new Map());
  // Destination picker state — when open, the pending prompt is held here
  // until the user picks a destination (or cancels).
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  // Plan assignment destination picker state — a ready plan + profile waiting
  // for the user to choose a chat session.
  const [pendingAssign, setPendingAssign] = useState<{ plan: Plan; profile: LaunchProfile } | null>(null);
  const [appToast, setAppToast] = useState<{ title: string; detail?: string; kind: ToastKind } | null>(null);

  // Toast helper — defined early so all handlers can use it.
  const handleShowToast = useCallback((title: string, detail?: string, kind: ToastKind = "success") => {
    setAppToast({ title, detail, kind });
    window.setTimeout(() => setAppToast(null), 4000);
  }, []);
  const [pendingDelivery, setPendingDelivery] = useState<{ text: string; mode: PromptMode; action?: DeliveryAction } | null>(null);
  // Idea round awaiting destination delivery — abandoned (finished) if the
  // user cancels the destination picker before the prompt is delivered.
  // A ref, not state: the picker fires onSelect and onClose synchronously in
  // one click, and the close handler must observe the cleared value.
  const pendingRoundRef = useRef<string | null>(null);
  const [roundGateOpen, setRoundGateOpen] = useState(false);
  // Escape-to-close for inline modals that don't have their own hook.
  useEscapeKey(changesModalOpen, () => setChangesModalOpen(false));
  useEscapeKey(plansModalOpen, () => setPlansModalOpen(false));
  useEscapeKey(schematicModalOpen, () => setSchematicModalOpen(false));
  useEscapeKey(debugPanelOpen, () => setDebugPanelOpen(false));
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
  const [projectRestoreError, setProjectRestoreError] = useState<string | null>(null);
  const [restoreRetryToken, setRestoreRetryToken] = useState(0);
  const restoreGenerationRef = useRef(0);
  // Per-type in-flight guard serializing rapid repeated creation clicks so
  // one click creates exactly one panel + one backing resource.
  const creatingInFlightRef = useRef<Set<string>>(new Set());
  // Ref indirection so openOrFocusChat (defined before handleCreateTypedPanel)
  // can call it without a forward-reference error.
  const handleCreateTypedPanelRef = useRef<(type: "chat" | "terminal" | "omp" | "schematic", pendingPrompt?: { text: string; mode: PromptMode; action?: DeliveryAction }) => void>(() => {});
  const [workspaceRestore, setWorkspaceRestore] = useState<WorkspaceRestoreState | null>(null);
  const titlePendingRef = useRef(false);
  const focusRestoreStartedRef = useRef(false);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("starting");
  const initialRestoreDoneRef = useRef(false);
  const sidebar = useProjectSidebar(activeProjectPath);
  const activeProject = sidebar.projects.find((p) => p.path === activeProjectPath);
  const session = useSessionState(activeProjectPath, activeProject?.lastActiveSessionId);
  const plans = usePlans(session.activeSessionId);
  const schematic = useProjectSchematic(activeProjectPath);
  const ideaState = useIdeaState(session.activeSessionId);
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
    // Gated by projectRestoreLoading so restore completes before session
    // hydration mutates UI state.
    if (!activeProjectPath || session.activeSessionId || projectRestoreLoading) return;
    if (session.sessions.length > 0) {
      void session.selectSession(session.sessions[0].id);
    } else if (!session.activeSession) {
      void session.createSession();
    }
  }, [activeProjectPath, session.sessions.length, session.activeSessionId, session.activeSession, session, projectRestoreLoading]);

  // Auto-create a chat tab when a session is active but has no tabs.
  // Gated on restore completion to avoid racing with tab loading:
  // without this, the effect fires after restore sets loading=false
  // but before refreshTabs loads the fixture tabs, creating a spurious
  // orphan tab.
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId || projectRestoreLoading) return;
    if (restoredProjectRef.current !== activeProjectPath) return;
    if (session.tabs.length > 0) return;
    // If the restore state has a lastSessionId, the session should already
    // have tabs — don't auto-create a spurious tab that races with the
    // tab loader and becomes a false orphan.
    if (workspaceRestore?.lastSessionId) return;
    if (session.activeSession?.title === "New Session") return;
    void session.createTab("chat", "Chat 1");
  }, [activeProjectPath, session.activeSessionId, session.tabs.length, session.activeSession?.title, session, projectRestoreLoading, workspaceRestore]);
  // Auto-create a chat panel when the panel grid is empty and a session is active.
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId || projectRestoreLoading) return;
    if (restoredProjectRef.current !== activeProjectPath) return;
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
  }, [activeProjectPath, session.activeSessionId, panelGridState.root, session.activeSession?.title, projectRestoreLoading]);


  // Auto-select the explicitly focused project on startup. Recent ordering is
  // only a fallback; focusing a project is persisted separately from list order.
  useEffect(() => {
    if (!sidebar.projectsReady || activeProjectPath || sidebar.projects.length === 0 || focusRestoreStartedRef.current) return;
    focusRestoreStartedRef.current = true;
    void getLastFocusedProject()
      .then((project) => {
        const fallback = sidebar.projects[0]?.path ?? null;
        const focusedPath = project && sidebar.projects.some((item) => item.path === project.path)
          ? project.path
          : fallback;
        if (focusedPath) setActiveProjectPath(focusedPath);
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("warn", "Failed to restore last focused project", message);
        const fallback = sidebar.projects[0]?.path;
        if (fallback) setActiveProjectPath(fallback);
      });
  }, [activeProjectPath, sidebar.projects, sidebar.projectsReady, addLog]);

  // Workspace restore splash: tracks the initial restore pipeline phases.
  // Only runs once on startup — project switches use the switching overlay.
  useEffect(() => {
    if (initialRestoreDoneRef.current) return;
    if (restorePhase === "starting") {
      setRestorePhase("detecting");
    }
    // No projects after detection → dismiss splash to show empty state.
    if (restorePhase === "detecting" && sidebar.projectsReady && sidebar.projects.length === 0 && !sidebar.pickerInFlight) {
      // Give the project list one tick to load before concluding empty.
      const timer = window.setTimeout(() => {
        if (sidebar.projects.length === 0 && !initialRestoreDoneRef.current) {
          setRestorePhase("ready");
          initialRestoreDoneRef.current = true;
        }
      }, 500);
      return () => window.clearTimeout(timer);
    }
  }, [restorePhase, sidebar.projects, sidebar.projectsReady, sidebar.pickerInFlight]);

  // Transition to "restoring" when the first project is activated.
  useEffect(() => {
    if (initialRestoreDoneRef.current) return;
    if (activeProjectPath && restorePhase === "detecting") {
      setRestorePhase("restoring");
    }
  }, [activeProjectPath, restorePhase]);

  // Transition to "ready" when the initial restore completes.
  useEffect(() => {
    if (initialRestoreDoneRef.current) return;
    if (restorePhase === "restoring" && activeProjectPath && !projectRestoreLoading) {
      setRestorePhase("ready");
      initialRestoreDoneRef.current = true;
    }
  }, [restorePhase, activeProjectPath, projectRestoreLoading]);

  useEffect(() => {
    // Flush any pending workspace save for the previous project before
    // clearing the grid. Without this, tab title changes made within the
    // 250ms debounce window are lost when switching projects.
    if (workspacePersistTimerRef.current) {
      window.clearTimeout(workspacePersistTimerRef.current);
      workspacePersistTimerRef.current = null;
      const prevProject = restoredProjectRef.current;
      if (prevProject && prevProject !== activeProjectPath) {
        void saveWorkspaceRestoreState({
          projectPath: prevProject,
          lastSessionId: session.activeSessionId,
          lastTabId: session.activeTabId,
          sideSection: workspaceRestore?.sideSection ?? "plans",
          sidebarCollapsed,
          sideCollapsed: workspaceRestore?.sideCollapsed ?? false,
          sideWidth: workspaceRestore?.sideWidth ?? 260,
          tabGridStates: serializeTabGridStates(session.tabGridStates),
          panelGrid: serializePanelGrid(panelGridState),
          updatedAt: workspaceRestore?.updatedAt ?? 0,
        }).catch((caught) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          addLog("warn", "Failed to flush workspace state on project switch", message);
        });
      }
    }
    if (!activeProjectPath) {
      addLog("debug", "Project deselected", "clearing workspace restore");
      setWorkspaceRestore(null);
      setPanelGridState(emptyGrid());
      restoredProjectRef.current = null;
      loggedOrphanIdsRef.current.clear();
      return;
    }
    // Project-keyed loading boundary: disable panel mutations until this
    // project's restore resolves. The generation token ensures a late
    // response from a prior project cannot hydrate the current grid. Setting
    // loading true synchronously here prevents the session/tab/panel effects
    // from mutating UI state before restore completes.
    const generation = ++restoreGenerationRef.current;
    markStart("project-activation");
    setProjectRestoreLoading(true);
    setPanelGridState(emptyGrid());
    setProjectRestoreError(null);
    addLog("debug", "Project selected", `${activeProjectPath} (gen=${generation})`);
    let cancelled = false;
    void getWorkspaceRestoreState(activeProjectPath).then((state) => {
      if (cancelled || generation !== restoreGenerationRef.current) {
        addLog("debug", "Restore skipped (stale)", `gen=${generation} current=${restoreGenerationRef.current}`);
        return;
      }
      setWorkspaceRestore(state);
      setSidebarCollapsed(state.sidebarCollapsed);
      restoredProjectRef.current = activeProjectPath;
      setProjectRestoreLoading(false);
      setProjectRestoreError(null);
      addLog("debug", "Workspace restored", `${activeProjectPath} panels=${flattenPanels(state.panelGrid ? parsePanelGridWithDiagnostics(state.panelGrid).state.root : null).length}`);
      markEnd("project-activation");
    }).catch((caught) => {
      if (cancelled || generation !== restoreGenerationRef.current) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      addLog("warn", "Failed to restore workspace state", message);
      setProjectRestoreLoading(false);
      setProjectRestoreError(message);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, addLog, restoreRetryToken]);
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
  // non-destructive: log a single summary, never per-tab. Re-logging on
  // project switch is expected (different project, different tabs).
  const loggedOrphanIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Don't run orphan detection while a project restore is in flight —
    // the panel grid is stale (from the previous project) and would
    // produce false orphan warnings for the new project's tabs.
    if (projectRestoreLoading) return;
    const orphans = detectOrphanedTabs(panelGridState, session.tabs);
    const newOrphans = orphans.filter((o) => !loggedOrphanIdsRef.current.has(o.tabId));
    if (newOrphans.length === 0) return;
    for (const o of newOrphans) loggedOrphanIdsRef.current.add(o.tabId);
    const byKind = newOrphans.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ");
    addLog("warn", "Orphaned session tabs recovered", `${newOrphans.length} tab(s) have no reachable panel (${breakdown}). Recover from history or delete explicitly.`);
  }, [panelGridState, session.tabs, projectRestoreLoading, addLog]);


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
    if (sidebar.isPickerInFlight()) return;
    try {
      const path = await sidebar.openFolder();
      if (path) {
        await setLastFocusedProject(path);
        setActiveProjectPath(path);
        handleShowToast("Project opened", path.split(/[\\/]/).pop() ?? path, "success");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to open project folder", message);
      handleShowToast("Failed to open project", message, "error");
    }
  }, [sidebar, addLog, handleShowToast]);
  const handleSelectProject = useCallback(
    async (path: string) => {
      // Only set the path after focus persistence succeeds — the
      // `useProjectSidebar` effect runs detection once.
      try {
        await setLastFocusedProject(path);
        setActiveProjectPath(path);
        handleShowToast("Project activated", path.split(/[\\/]/).pop() ?? path, "info");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        handleShowToast("Failed to activate project", msg, "error");
      }
    },
    [sidebar, handleShowToast],
  );

  const handleRetryRestore = useCallback(() => {
    setRestoreRetryToken((token) => token + 1);
  }, []);

  const handleRemoveProject = useCallback(
    async (path: string) => {
      await sidebar.removeProject(path);
      if (path === activeProjectPath) {
        setActiveProjectPath(null);
      }
      handleShowToast("Project removed", path.split(/[\\/]/).pop() ?? path, "info");
    },
    [sidebar, activeProjectPath, handleShowToast],
  );

  const handleRevealProject = useCallback(
    (path: string) => {
      void revealInExplorer(path);
    },
    [],
  );

  const handleCopyProjectPath = useCallback(
    (path: string) => {
      void navigator.clipboard.writeText(path);
      handleShowToast("Copied", path, "info");
    },
    [handleShowToast],
  );

  const handleClearChats = useCallback(
    async (path: string) => {
      const sessions = sidebar.sessionsByProject.get(path) ?? [];
      addLog("debug", "Clearing project chats", `${path} (${sessions.length} sessions)`);
      await Promise.all(
        sessions.map(async (s) => {
          try {
            await deleteSession(s.id);
            addLog("debug", "Deleted session", `${s.id} (${s.title})`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            addLog("error", "Failed to delete session", `${s.id}: ${msg}`);
          }
        }),
      );
      await sidebar.refreshSessions();
      handleShowToast("Chats cleared", `${sessions.length} chat${sessions.length === 1 ? "" : "s"} removed`, "info");
    },
    [sidebar, addLog, handleShowToast],
  );

  const handleCreateSession = useCallback(async () => {
    await session.createSession();
    handleShowToast("Chat created", "New chat session started.", "success");
  }, [session, handleShowToast]);
  const handleCreateTerminalTab = useCallback(async () => {
    if (!session.activeSessionId) return;
    try {
      const shell = DEFAULT_SHELL();
      const term = await createTerminal(shell, activeProjectPath ?? undefined);
      await session.createTab("terminal", `Terminal ${term.id}`, term.id);
      handleShowToast("Terminal created", `${shell} shell ready.`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      handleShowToast("Failed to create terminal", msg, "error");
    }
  }, [session, activeProjectPath, handleShowToast]);

  /** Commit a checked panel insertion. Resolves a valid live anchor (or
   *  accepts the panel as the sole root for an empty grid), verifies the new
   *  panel appears exactly once, and logs an actionable error on failure.
   *  Returns true on success. A stale `activePanelId` / anchor never becomes
   *  a silent no-op. */
  const commitInsert = useCallback(
    (panel: Panel, anchorId: string | null = null, side: DropSide = "right"): boolean => {
      if (projectRestoreLoading) {
        addLog("warn", "Panel creation blocked", "The project is still loading; please wait.");
        handleShowToast("Project still loading", "Wait for the project to finish restoring.", "warning");
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
    [panelGridState, projectRestoreLoading, addLog, handleShowToast],
  );

  const handleTerminalOutput = useCallback((data: string) => {
    setTerminalOutputBuffer((prev) => (prev + data).slice(-2500));
  }, []);


  const handleCreatePlanFromIdea = useCallback(
    async (title: string, description: string, chatSessionId: string | null) => {
      if (!session.activeSessionId) return;
      await plans.createPlan({
        title,
        description,
        status: "openspec",
        priority: 50,
        tags: chatSessionId ? [`chat:${chatSessionId}`] : [],
      });
    },
    [plans, session.activeSessionId],
  );
  const openPlanningModal = useCallback((tab: PlanningTab) => {
    addLog("debug", "Planning modal opened", `tab=${tab}`);
    markStart("modal-first-paint");
    setPlansModalTab(tab);
    setPlansModalOpen(true);
    // Measure first paint after React commits the modal.
    requestAnimationFrame(() => markEnd("modal-first-paint"));
  }, [addLog]);
  const handleOpenPlanningInspector = useCallback(() => {
    openPlanningModal("plans");
  }, [openPlanningModal]);

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
      addLog("debug", "openOrFocusChat", `draftPrompt=${draftPrompt.slice(0, 60)}... activeSession=${session.activeSessionId ?? "none"}`);
      if (!session.activeSessionId) {
        addLog("debug", "openOrFocusChat skipped", "no active session");
        return;
      }
      // Find existing chat tab (prefer active, then most recent)
      const activeChat = session.tabs.find((t) => t.id === session.activeTabId && t.kind === "chat");
      const existingChat = activeChat ?? session.tabs.filter((t) => t.kind === "chat").slice(-1)[0] ?? null;
      if (existingChat) {
        addLog("debug", "openOrFocusChat focusing existing", `tab=${existingChat.id} chatSessionId=${existingChat.chatSessionId ?? "none"}`);
        session.setActiveTabId(existingChat.id);
        if (existingChat.chatSessionId) {
          deliverPrompt({ chatSessionId: existingChat.chatSessionId, text: draftPrompt, mode: "insert" });
        } else {
          pendingNewPanelPrompts.current.set(existingChat.id, { text: draftPrompt, mode: "insert" });
        }
      } else {
        addLog("debug", "openOrFocusChat creating new", "no existing chat tab found");
        handleCreateTypedPanelRef.current("chat", { text: draftPrompt, mode: "insert" });
      }
    },
    [session],
  );
  const handleSuggestForCategory = useCallback(
    (category: IdeaCategory | null) => {
      const action = generateIdeasAction(category?.name, category?.description ?? undefined, category?.id);
      addLog("debug", "Planning action routed", action.context ?? action.type);
      setPendingDelivery({ text: action.text, mode: action.mode, action: action.action });
      setDestinationPickerOpen(true);
      // Demote the planning modal so the destination chat is visible.
      setPlansModalOpen(false);
    },
    [addLog],
  );
  const handleGenerateCategories = useCallback(
    () => {
      const action = generateCategoriesAction();
      addLog("debug", "Planning action routed", action.context ?? action.type);
      setPendingDelivery({ text: action.text, mode: action.mode });
      setDestinationPickerOpen(true);
      setPlansModalOpen(false);
      handleShowToast("Generating categories", "Pick a destination chat to deliver the prompt.", "info");
    },
    [addLog, handleShowToast],
  );
  const handleStartSchematicWizard = useCallback(
    async (section?: string) => {
      if (!session.activeSessionId) {
        handleShowToast("No active session", "Open a project first to start the schematic wizard.", "warning");
        return;
      }
      let skillBody = "";
      try {
        const skill = await readSkill("basebuild-project-schematic");
        skillBody = skill.content;
      } catch {
        skillBody = "";
      }
      const action = schematicWizardAction(skillBody, section);
      addLog("debug", "Planning action routed", action.context ?? action.type);
      setPendingDelivery({ text: action.text, mode: action.mode });
      setDestinationPickerOpen(true);
      setPlansModalOpen(false);
      handleShowToast("Schematic wizard started", section ? `Focusing: ${section}` : "Pick a destination chat to begin.", "info");
    },
    [session, addLog, handleShowToast],
  );

  const handleGenerateFromFinishedPlans = useCallback(() => {
    const grounding = getLastGrounding();
    if (!grounding || grounding.finishedPlanCount === 0) return;
    const action = generateFromFinishedPlansAction(grounding.finishedPlans, grounding.finishedPlanCount);
    addLog("debug", "Planning action routed", action.context ?? action.type);
    setPendingDelivery({ text: action.text, mode: action.mode, action: action.action });
    setDestinationPickerOpen(true);
    setPlansModalOpen(false);
    handleShowToast("Generating from finished plans", `${grounding.finishedPlanCount} finished plan${grounding.finishedPlanCount > 1 ? "s" : ""} since last schematic update.`, "info");
  }, [addLog, handleShowToast]);

  // One-click zero-input idea round: soft-gate on schematic health, start the
  // round (captures during the turn get tagged), then deliver the generation
  // prompt through the destination picker.
  const handleStartIdeaRound = useCallback(async (proceedDespiteGate = false) => {
    if (!session.activeSessionId) {
      handleShowToast("No active session", "Open a project first to run an idea round.", "warning");
      return;
    }
    const health = schematic.report?.health ?? (schematic.exists ? "partial" : "missing");
    if (health !== "complete" && !proceedDespiteGate) {
      setRoundGateOpen(true);
      return;
    }
    setRoundGateOpen(false);
    let roundId: string | null = null;
    try {
      roundId = await startIdeaRound(session.activeSessionId);
      addLog("info", "Idea round started", `round=${roundId} gate=${health}${proceedDespiteGate ? " (proceeded despite gate)" : ""}`);
    } catch (e) {
      addLog("error", "Failed to start idea round", e instanceof Error ? e.message : String(e));
      handleShowToast("Round failed to start", "Could not start the idea round. See logs.", "error");
      return;
    }
    pendingRoundRef.current = roundId;
    const action = generateIdeasAction();
    setPendingDelivery({ text: action.text, mode: action.mode, action: action.action });
    setDestinationPickerOpen(true);
    setPlansModalOpen(false);
    handleShowToast("Idea round started", "Pick a destination chat — captured ideas are collected into this round.", "info");
  }, [session.activeSessionId, schematic.report, schematic.exists, addLog, handleShowToast]);

  const handleOpenSchematic = useCallback(() => {
    addLog("debug", "Project schematic opened", activeProjectPath ?? "no project");
    setSchematicModalOpen(true);
  }, [activeProjectPath, addLog]);

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
      handleShowToast("Plan saved", `${editingPlan.referenceId} ${editingPlan.title}`, "success");
    },
    [editingPlan, plans, handleShowToast],
  );

  const handleOpenPlanInTerminal = useCallback((plan: Plan) => {
    void handleCreateTerminalTab();
    void navigator.clipboard.writeText(`#${plan.referenceId} ${plan.title}\n${plan.description}`);
  }, [handleCreateTerminalTab]);
  // handleShowToast is defined earlier (after appToast state) so all handlers can use it.

  const handleFocusPlan = useCallback((plan: Plan) => {
    setFocusingPlan(plan);
  }, []);

  const handleCopyReference = useCallback((refId: string) => {
    void navigator.clipboard.writeText(`#${refId}`);
    handleShowToast("Reference copied", `#${refId} copied to clipboard.`, "info");
  }, [handleShowToast]);

  const handleAssignPlan = useCallback((plan: Plan, profile: LaunchProfile) => {
    setPendingAssign({ plan, profile });
    setDestinationPickerOpen(true);
  }, []);


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
    (type: "chat" | "terminal" | "omp" | "schematic", pendingPrompt?: { text: string; mode: PromptMode; action?: DeliveryAction }): void => {
      addLog("debug", "Panel create requested", `type=${type} pendingPrompt=${pendingPrompt ? "yes" : "no"} activeSession=${session.activeSessionId ?? "none"}`);
      if (!session.activeSessionId) {
        addLog("debug", "Panel create skipped", "no active session");
        return;
      }
      if (projectRestoreLoading) {
        addLog("warn", "Panel creation blocked", "The project is still loading; please wait.");
        return;
      }
      // Serialize rapid repeated clicks per type.
      if (creatingInFlightRef.current.has(type)) {
        addLog("debug", "Panel create skipped", `type=${type} already in flight`);
        return;
      }
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
          addLog("debug", "Chat panel insert failed", panelId);
          releaseGuard();
          return;
        }
        addLog("debug", "Chat panel reserved", `${panelId} (Chat ${chatCount})`);
        // Acquire the chat tab after the reservation is visible.
        void (async () => {
          try {
            const tab = await session.createTab("chat", `Chat ${chatCount}`);
            if (!tab) {
              addLog("warn", "Chat tab creation returned no tab", panelId);
            } else {
              addLog("debug", "Chat tab created", `tab=${tab.id} panel=${panelId}`);
              if (pendingPrompt) {
                pendingNewPanelPrompts.current.set(tab.id, pendingPrompt);
              }
            }
            handleShowToast("Chat created", `Chat ${chatCount} ready.`, "success");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog("error", "Chat tab creation failed", message);
            setPanelGridState((prev) => removePanelFromGrid(prev, panelId));
            handleShowToast("Failed to create chat", message, "error");
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
          addLog("debug", `${baseTitle} panel insert failed`, panelId);
          releaseGuard();
          return;
        }
        addLog("debug", `${baseTitle} panel reserved`, panelId);
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
            addLog("debug", `${baseTitle} created`, `panel=${panelId} term=${term.id}`);
            handleShowToast(`${baseTitle} created`, `${shell} shell ready.`, "success");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog("error", `${baseTitle} creation failed`, message);
            setPanelGridState((prev) => removePanelFromGrid(prev, panelId));
            handleShowToast(`Failed to create ${baseTitle}`, message, "error");
          } finally {
            releaseGuard();
          }
        })();
        return;
      }
      // schematic — no backing resource, insert directly.
      const panel: Panel = { id: panelId, type: "schematic", title: "Schematic", chatSessionId: null, terminalId: null, filePath: null };
      commitInsert(panel, panelGridState.activePanelId, "right");
      addLog("debug", "Schematic panel created", panelId);
      releaseGuard();
    },
    [session, activeProjectPath, projectRestoreLoading, panelGridState, commitInsert, addLog, handleShowToast],
  );
  handleCreateTypedPanelRef.current = handleCreateTypedPanel;
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
            panelId={panel.id}
            projectPath={activeProjectPath ?? ""}
            activeSessionId={session.activeSessionId}
            chatSessionId={panel.chatSessionId ?? tab?.chatSessionId ?? null}
            chatTitle={panel.title}
            onChatSessionCreated={(chatSessionId) => {
              addLog("debug", "Chat session created", `panel=${panel.id} chatSessionId=${chatSessionId} tab=${tab?.id ?? "none"}`);
              if (tab) {
                void session.setTabChatSession(tab.id, chatSessionId);
                // Flush any prompt queued for this tab before its session existed.
                const pending = pendingNewPanelPrompts.current.get(tab.id);
                if (pending) {
                  addLog("debug", "Flushing pending prompt", `tab=${tab.id} mode=${pending.mode}`);
                  pendingNewPanelPrompts.current.delete(tab.id);
                  deliverPrompt({ chatSessionId, text: pending.text, mode: pending.mode, action: pending.action });
                }
              }
              // Also update the panel's chatSessionId in the grid so the link
              // persists across restarts, and clear the `creating` flag.
              setPanelGridState((prev) => ({
                ...prev,
                root: updatePanelInTree(prev.root, panel.id, { chatSessionId, creating: false }),
              }));
            }}
            onRenameChat={(title) => {
              setPanelGridState((prev) => ({
                ...prev,
                root: updatePanelInTree(prev.root, panel.id, { title }),
              }));
              if (tab) {
                void session.setTabTitle(tab.id, title);
              }
            }}
            onOpenPlanningInspector={handleOpenPlanningInspector}
            onOpenSchematic={handleOpenSchematic}
            onCloseChat={() => setPanelGridState((prev) => closePanel(prev, panel.id))}
            onCloseAndDeleteChat={() => setPanelGridState((prev) => deletePanelFromHistory(prev, panel.id))}
            onShowToast={handleShowToast}
            onDuplicateChat={() => {
              const newPanel = handleCreatePanel(panel.id, "right");
              commitInsert(newPanel, panel.id, "right");
            }}
            onNewChat={() => handleCreateTypedPanel("chat")}
            onOpenHistory={() => setHistoryDrawerOpen(true)}
          />
        );
      }
      if (panel.type === "terminal") {
        if (!panel.terminalId) {
          // Try to find a terminal tab by title match (legacy panels).
          const tab = session.tabs.find((t) => t.kind === "terminal" && (t.id === panel.id || t.title === panel.title));
          if (tab?.terminalId) {
            return <Suspense fallback={<ModalLoading />}><TerminalPanel terminalId={tab.terminalId} onOutput={handleTerminalOutput} /></Suspense>;
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
          <Suspense fallback={<ModalLoading />}>
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
          </Suspense>
        );
      }
      if (panel.type === "file") {
        if (!panel.filePath) return null;
        return <Suspense fallback={<ModalLoading />}><FileViewer path={panel.filePath} /></Suspense>;
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
          return <Suspense fallback={<ModalLoading />}><OmpTerminalTab terminalId={panel.terminalId} onOutput={handleTerminalOutput} onReconnect={reconnectOmp} /></Suspense>;
        }
        const tab = session.tabs.find((t) => t.kind === "omp" && (t.id === panel.id || t.title === panel.title));
        return <Suspense fallback={<ModalLoading />}><OmpTerminalTab terminalId={tab?.terminalId ?? null} onOutput={handleTerminalOutput} onReconnect={reconnectOmp} /></Suspense>;
      }
      return null;
    },
    [session, activeProjectPath, schematic.content, handleCreatePlanFromIdea, handleOpenPlanningInspector, handleOpenSchematic, handleTerminalOutput, handleStartSchematicWizard],
  );

  /** Handle panel grid state changes. */
  const handlePanelGridChange = useCallback(
    (newState: PanelGridState) => {
      setPanelGridState(repairActivePanelId(newState));
    },
    [],
  );

  /** Persist a tab rename from the panel header tab strip to the DB.
   *  The panel grid state is already updated by PanelGrid; this syncs the
   *  title to session_tabs and (for chat tabs) the native chat session so
   *  it survives project switches and restarts. */
  const handleRenameTab = useCallback(
    (panelId: string, title: string) => {
      const allPanels = flattenPanels(panelGridState.root);
      const panel = allPanels.find((p) => p.id === panelId);
      if (!panel) return;
      // Find the matching session tab — same lookup logic as renderPanel.
      const tab = session.tabs.find(
        (t) =>
          (panel.chatSessionId && t.chatSessionId === panel.chatSessionId) ||
          t.title === panel.title ||
          t.id === panelId,
      );
      if (tab) {
        void session.setTabTitle(tab.id, title);
      }
      // For chat tabs, also rename the native chat session so the
      // ChatPanel title-sync effect doesn't overwrite it on remount.
      const chatSessionId = panel.chatSessionId ?? tab?.chatSessionId ?? null;
      if (chatSessionId) {
        void renameNativeChatSession(chatSessionId, title);
      }
    },
    [panelGridState.root, session.tabs, session.setTabTitle],
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
    <PanelStatusProvider>
    <div className="app-container app-container-chat-first">
      {restorePhase !== "ready" ? <WorkspaceSplash phase={restorePhase} /> : null}
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
          onRemoveProject={handleRemoveProject}
          onOpenInExplorer={handleRevealProject}
          onCopyProjectPath={handleCopyProjectPath}
          onNewChat={() => handleCreateTypedPanel("chat")}
          onOpenFiles={() => setFileModalOpen(true)}
          onOpenChanges={() => setChangesModalOpen(true)}
          pickerInFlight={sidebar.pickerInFlight}
          onFocusPanel={(panelId) => setPanelGridState((prev) => ({ ...prev, activePanelId: panelId }))}
          onCreateChat={() => handleCreateTypedPanel("chat")}
          onOpenLogPanel={() => setLogPanelOpen(true)}
          onClearChats={handleClearChats}
          onOpenHistory={() => setHistoryDrawerOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <section className="workspace-panel workspace-panel-chat-first">
          {activeProjectPath && session.activeSessionId ? (
            <div className="session-header">
              <ChatEnvironmentPanel
                projectPath={activeProjectPath}
                sessionId={session.activeSessionId}
                plans={plans}
                planCallbacks={{
                  onEditPlan: handleEditPlan,
                  onFocusPlan: handleFocusPlan,
                  onCopyReference: handleCopyReference,
                  onOpenInTerminal: handleOpenPlanInTerminal,
                }}
                onOpenChatSession={handleOpenChatSession}
                onSuggestForCategory={handleSuggestForCategory}
                onGenerateCategories={handleGenerateCategories}
                onOpenFiles={() => setFileModalOpen(true)}
                onOpenChanges={() => setChangesModalOpen(true)}
                onOpenPlans={() => openPlanningModal("plans")}
                onCreatePanel={handleCreateTypedPanel}
              />
              <PlanningIndicators
                plans={plans.plans}
                ideas={ideaState.ideas}
                schematicHealth={schematic.report ? (schematic.report.health === "complete" ? "complete" : "incomplete") : "none"}
                onOpenStage={(stage: StageKey) => {
                  addLog("debug", "Planning stage opened", stage);
                  if (stage === "schematic") {
                    handleOpenSchematic();
                  } else if (stage === "ideas") {
                    openPlanningModal("ideas");
                  } else if (stage === "plans") {
                    openPlanningModal("plans");
                  } else {
                    openPlanningModal("flow");
                  }
                }}
                onOpenFullUI={(stage: StageKey) => {
                  if (stage === "schematic") {
                    handleOpenSchematic();
                  } else if (stage === "ideas") {
                    openPlanningModal("ideas");
                  } else if (stage === "plans") {
                    openPlanningModal("plans");
                  } else if (stage === "running") {
                    openPlanningModal("flow");
                  } else {
                    openPlanningModal("runs");
                  }
                }}
                onMarkComplete={(planId: string) => {
                  void plans.setPlanStatus(planId, "finished");
                }}
              />
            </div>
          ) : null}
          <div className="workspace-scroll workspace-scroll-chat-first">
            {!activeProjectPath ? (
              <div className="empty-state">
                <TerminalSquare size={32} className="text-muted" />
                <h3>No project open</h3>
                <p>Open a folder to start managing terminals, files, source control, and plans.</p>
                <button className="btn btn-primary" type="button" title={sidebar.pickerInFlight ? "Opening folder picker…" : "Open a project folder"} onClick={handleOpenFolder} disabled={sidebar.pickerInFlight}>Open project</button>
              </div>
            ) : null}
            {activeProjectPath && projectRestoreError ? (
              <div className="project-restore-error" role="alert">
                <h3>Project restore failed</h3>
                <p>{projectRestoreError}</p>
                <div className="empty-state-actions">
                  <button className="btn btn-primary" type="button" title="Retry project restore" onClick={handleRetryRestore}>Retry</button>
                  <button className="btn" type="button" title="Switch to another project" onClick={() => setActiveProjectPath(null)}>Switch project</button>
                </div>
              </div>
            ) : null}
            {activeProjectPath && !projectRestoreError && projectRestoreLoading ? (
              <ProjectSwitchingOverlay projectName={activeProjectPath.split(/[\\/]/).pop() ?? activeProjectPath} />
            ) : null}
            {activeProjectPath && !projectRestoreError && !projectRestoreLoading ? (
              <>
                <PanelGrid
                  state={panelGridState}
                  onStateChange={handlePanelGridChange}
                  onRenameTab={handleRenameTab}
                  renderPanel={renderPanel}
                  onCreatePanel={handleCreatePanel}
                  viewportWidth={typeof window !== "undefined" ? window.innerWidth - 80 : 1200}
                  viewportHeight={typeof window !== "undefined" ? window.innerHeight - 120 : 700}
                />
                {historyDrawerOpen ? (
                  <Suspense fallback={<ModalLoading />}>
                    <HistoryDrawer
                      activeProjectPath={activeProjectPath}
                      closedPanels={panelGridState.closedPanels}
                      onReopen={handlePanelReopen}
                      onDelete={handlePanelDelete}
                      onSelectProject={setActiveProjectPath}
                      onClose={() => setHistoryDrawerOpen(false)}
                    />
                  </Suspense>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      </main>
      <Suspense fallback={<ModalLoading />}>
        <FileExplorerModal
          projectPath={activeProjectPath}
          open={fileModalOpen}
          onClose={() => setFileModalOpen(false)}
          onOpenFile={handleOpenFileInTab}
        />
      </Suspense>
      {changesModalOpen && activeProjectPath ? (
        <div className="modal-overlay" role="dialog" aria-label="Changes" onClick={() => setChangesModalOpen(false)}>
          <div className="modal modal-changes" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Changes</h2>
              <button className="btn-icon" type="button" title="Close (Esc)" onClick={() => setChangesModalOpen(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <Suspense fallback={<ModalLoading />}><SourcePanel projectPath={activeProjectPath} /></Suspense>
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
              <Suspense fallback={<ModalLoading />}>
                <PlanningInspector
                  showHeader={false}
                  initialTab={plansModalTab}
                  sessionId={session.activeSessionId}
                  projectPath={activeProjectPath}
                  plans={plans.plans}
                  loading={plans.loading}
                  collapsed={false}
                  onGenerateFromFinishedPlans={handleGenerateFromFinishedPlans}
                  onToggleCollapse={() => {}}
                  hostContext="modal"
                  onEditPlan={(p) => { setPlansModalOpen(false); handleEditPlan(p); }}
                  onFocusPlan={handleFocusPlan}
                  onCopyReference={handleCopyReference}
                  onOpenInTerminal={handleOpenPlanInTerminal}
                  onSetPlanStatus={plans.setPlanStatus}
                  onDeletePlan={plans.deletePlan}
                  onOpenChatSession={(id) => { setPlansModalOpen(false); handleOpenChatSession(id); }}
                  onSuggestForCategory={handleSuggestForCategory}
                  onGenerateCategories={handleGenerateCategories}
                  onStartIdeaRound={() => { void handleStartIdeaRound(); }}
                  chatPanels={flattenPanels(panelGridState.root).map((p) => ({ panelId: p.id, chatSessionId: p.chatSessionId ?? null }))}
                  onAssignPlan={handleAssignPlan}
                  onShowToast={handleShowToast}
                />
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}
      {schematicModalOpen && activeProjectPath ? (
        <div className="modal-overlay" role="dialog" aria-label="Project Schematic" onClick={() => setSchematicModalOpen(false)}>
          <div className="modal modal-schematic" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Project Schematic</h2>
              <button className="btn-icon" type="button" title="Close project schematic" onClick={() => setSchematicModalOpen(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <ProjectSchematicTab
                projectPath={activeProjectPath}
                onStartWizard={handleStartSchematicWizard}
                onOpenRaw={() => setDescriptionOpen(true)}
              />
            </div>
          </div>
        </div>
      ) : null}
      <CrashReportNotice onViewReports={() => setDebugPanelOpen(true)} />
      <Suspense fallback={<ModalLoading />}><LogPanel open={logPanelOpen} onClose={() => setLogPanelOpen(false)} /></Suspense>
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
              <Suspense fallback={<ModalLoading />}><DebugPanel /></Suspense>
            </div>
          </div>
        </div>
      ) : null}
      <Suspense fallback={<ModalLoading />}>
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} projectPath={activeProjectPath} account={account} updates={updates} />
      </Suspense>
      <Suspense fallback={<ModalLoading />}>
        <EditPlanModal
          plan={editingPlan}
          open={!!editingPlan}
          onClose={() => setEditingPlan(null)}
          onSave={handleSavePlan}
        />
      </Suspense>
      <Suspense fallback={<ModalLoading />}>
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
      </Suspense>
      <Suspense fallback={<ModalLoading />}>
        <ProjectDescriptionModal
          open={descriptionOpen}
          onClose={() => setDescriptionOpen(false)}
          existingContent={schematic.content}
          onSave={schematic.write}
          onOpenFile={handleOpenSchematicFile}
        />
      </Suspense>
      <FirstRunModal
        open={!firstRun.completed && !firstRun.loading}
        onComplete={() => firstRun.complete()}
        onSkip={() => firstRun.skip()}
      />
      <ToastStack />
      {appToast ? (() => {
        const { icon: ToastIcon, className: iconClassName } = TOAST_ICONS[appToast.kind];
        return (
          <div className="toast-stack">
            <div className={`toast toast-${appToast.kind}`} role="status" aria-live="polite">
              <ToastIcon size={13} className={`toast-icon ${iconClassName}`} />
              <div className="toast-content">
                <span className="toast-title">{appToast.title}</span>
                {appToast.detail ? <span className="toast-detail">{appToast.detail}</span> : null}
              </div>
              <button
                className="toast-dismiss btn-icon"
                title="Dismiss"
                type="button"
                onClick={() => setAppToast(null)}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        );
      })() : null}
      <DestinationPicker
        open={destinationPickerOpen}
        onClose={() => {
          setDestinationPickerOpen(false);
          setPendingDelivery(null);
          setPendingAssign(null);
          // Cancelling the picker abandons a round that never got its prompt.
          if (pendingRoundRef.current && session.activeSessionId) {
            addLog("debug", "Idea round abandoned", `round=${pendingRoundRef.current}`);
            void finishIdeaRound(session.activeSessionId).catch(() => {});
            pendingRoundRef.current = null;
          }
        }}
        panels={flattenPanels(panelGridState.root)}
        title={pendingAssign ? "Assign plan to chat" : "Send to…"}
        onSelect={(choice: DestinationChoice) => {
          if (pendingAssign) {
            if (choice.kind !== "existing" || !choice.chatSessionId) {
              addLog("warn", "Assign plan", "Select an existing chat to assign a plan");
              setAppToast({ title: "Select an existing chat", detail: "New chats cannot be assigned directly.", kind: "error" });
              return;
            }
            void (async () => {
              try {
                await assignPlanWithProfile({
                  planId: pendingAssign.plan.id,
                  chatSessionId: choice.chatSessionId,
                  profile: pendingAssign.profile,
                });
                handleShowToast("Plan assigned to chat", `${pendingAssign.plan.referenceId} ${pendingAssign.plan.title}`, "success");
                setPanelGridState((prev) => ({ ...prev, activePanelId: choice.panelId }));
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                handleShowToast("Failed to assign plan", msg, "error");
              } finally {
                setPendingAssign(null);
                setDestinationPickerOpen(false);
              }
            })();
            return;
          }
          if (!pendingDelivery) {
            addLog("debug", "DestinationPicker onSelect", "no pending delivery — skipping");
            return;
          }
          if (choice.kind === "existing") {
            addLog("debug", "DestinationPicker existing", `chatSessionId=${choice.chatSessionId} panel=${choice.panelId}`);
            deliverPrompt({
              chatSessionId: choice.chatSessionId,
              text: pendingDelivery.text,
              mode: pendingDelivery.mode,
              action: pendingDelivery.action,
            });
            // Focus the panel that hosts this chat.
            setPanelGridState((prev) => ({ ...prev, activePanelId: choice.panelId }));
          } else {
            addLog("debug", "DestinationPicker new", "creating new chat panel for wizard prompt");
            // New conversation — create a chat panel + backing tab, queue the prompt.
            handleCreateTypedPanel("chat", { text: pendingDelivery.text, mode: pendingDelivery.mode, action: pendingDelivery.action });
          }
          setPendingDelivery(null);
          // Prompt delivered — the round stays active so the turn's captures
          // are tagged; it finishes on review open or next round start.
          pendingRoundRef.current = null;
        }}
      />
      <IdeaRoundGate
        open={roundGateOpen}
        health={schematic.exists ? "partial" : "missing"}
        onOpenWizard={() => { setRoundGateOpen(false); void handleStartSchematicWizard(); }}
        onProceed={() => { void handleStartIdeaRound(true); }}
        onCancel={() => setRoundGateOpen(false)}
      />
    </div>
    </PanelStatusProvider>
  );
}

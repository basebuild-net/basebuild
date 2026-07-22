import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutTemplate, Settings2, TerminalSquare, X } from "lucide-react";
import { deliverPrompt, type DeliveryAction, type PromptMode } from "../../lib/promptDelivery";
import { markStart, markEnd } from "../../lib/timing";
import { generateCategoriesAction, generateFromFinishedPlansAction, generateIdeaRoundAction, generateIdeasAction, schematicWizardAction, type PlanningAction } from "../../lib/planningActions";
import { DestinationPicker, type DestinationChoice } from "./DestinationPicker";
import { WorkspaceSplash, type RestorePhase } from "./WorkspaceSplash";
import { ProjectSwitchingOverlay } from "./ProjectSwitchingOverlay";
import { ModalPortal } from "../ModalPortal";
import { IdeaRoundGate } from "./IdeaRoundGate";
import { IdeaRoundSetupModal, type IdeaRoundSetup } from "./IdeaRoundSetupModal";
import { startIdeaRound, finishIdeaRound } from "../../lib/ideaRounds";

export type ToastKind = "success" | "warning" | "error" | "info";


import { useSessionState } from "../../state/sessions";
import { useZoom } from "../../state/useZoom";
import { usePlans } from "../../state/plans";
import { ProjectSidebar, useProjectSidebar } from "./ProjectSidebar";
import { TestRunModeModal } from "./TestRunModeModal";
import { ActivitySidebar } from "./ActivitySidebar";
import { ChatEnvironmentPanel } from "./ChatEnvironmentPanel";
import { BackgroundAgents } from "./BackgroundAgents";
const FileExplorerModal = lazy(() => import("./FileExplorerModal").then((m) => ({ default: m.FileExplorerModal })));
import { PlanningInspector } from "./PlanningInspector";
import type { PlanningTab } from "./PlanningInspector";
const EditPlanModal = lazy(() => import("./EditPlanModal").then((m) => ({ default: m.EditPlanModal })));
const FocusPlanModal = lazy(() => import("./FocusPlanModal").then((m) => ({ default: m.FocusPlanModal })));
const SourcePanel = lazy(() => import("../panels/SourcePanel").then((m) => ({ default: m.SourcePanel })));
const SettingsModal = lazy(() => import("./SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ProjectDescriptionModal = lazy(() => import("./ProjectDescriptionModal").then((m) => ({ default: m.ProjectDescriptionModal })));
import { PlanningIndicators, type StageKey } from "./PlanningIndicators";
import { TaskbarNotifications } from "./TaskbarNotifications";
import { useProjectSchematic } from "../../state/schematic";
import { getLastFocusedProject, revealInExplorer, setLastFocusedProject, testRunModeInit } from "../../lib/projects";
import { assignPlanToChat, cancelPlanRun, completePlanRun, listPlanRuns, listPlanRunsByPlan, onPlanRunEvent } from "../../lib/planRuns";
import { generateSessionTitle, readSkill } from "../../lib/skills";
import { getWorkspaceRestoreState, saveWorkspaceRestoreState, type WorkspaceRestoreState } from "../../lib/workspace";
import {
  closeSurface as closeSurfacePure,
  deleteSurfaceFromHistory as deleteSurfaceFromHistoryPure,
  emptyWorkspaceState,
  focusSurface as focusSurfacePure,
  migrateFromLegacyBlob,
  reopenSurface as reopenSurfacePure,
  removeSurfaceFromLayout as removeSurfaceFromLayoutPure,
  replaceFocusedSurface as replaceFocusedSurfacePure,
  splitFocusedSurface as splitFocusedSurfacePure,
  type SplitDirection,
  type SurfaceRecord,
  type WorkspaceState,
} from "../../lib/workspaceState";
import { panelGridToWorkspaceState, surfaceIdToPanelId } from "../../lib/workspaceBridge";
import { FirstRunModal } from "./FirstRunModal";
import { useFirstRun } from "../../state/first-run";
import { getLastGrounding } from "../../state/grounding";
import { createTerminal } from "../../lib/terminal";
const TerminalPanel = lazy(() => import("../panels/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const FileViewer = lazy(() => import("../panels/FileViewer").then((m) => ({ default: m.FileViewer })));
import { ProjectSchematicTab } from "../panels/ProjectSchematicTab";
import { ChatPanel } from "../panels/ChatPanel";
import { PanelGrid } from "../panels/PanelGrid";
import { listen } from "@tauri-apps/api/event";
import { PanelStatusProvider } from "../panels/PanelStatusContext";
const HistoryDrawer = lazy(() => import("../panels/HistoryDrawer").then((m) => ({ default: m.HistoryDrawer })));
import {
  activeTab as activeTabOfPanel,
  closePanel,
  deletePanelFromHistory,
  detectOrphanedTabs,
  emptyGrid,
  equalizeSplit,
  findParentSplit,
  flattenPanels,
  hiddenPanelsOf,
  hidePanel,
  insertPanel,
  linkHiddenPanel,
  newPanelId,
  parsePanelGrid,
  parsePanelGridWithDiagnostics,
  removePanelFromGrid,
  movePanel,
  reopenPanel,
  reopenPanelChecked,
  reopenPanelHidden,
  replaceFocusedWithHidden,
  showOnlyHiddenPanel,
  restoreStashedGroup,
  repairActivePanelId,
  resizeSplitChild,
  serializePanelGrid,
  singlePanelGrid,
  splitPanelAt,
  splitHiddenPanel,
  updatePanelInTree,
  type DropSide,
  type Panel,
  type PanelGridState,
  type PanelType,
  type SplitBranch,
} from "../../lib/panelGrid";
import { parseTabGridStates, serializeTabGridStates } from "../../lib/workspace";
import { ompStatus } from "../../lib/omp";
import { stabilityRendererHeartbeat } from "../../lib/stability";
const OmpTerminalTab = lazy(() => import("../panels/OmpTerminalTab").then((m) => ({ default: m.OmpTerminalTab })));
import { ModalLoading } from "./ModalLoading";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { WindowControls } from "./WindowControls";
import { type Notification } from "../../lib/notifications";
import { QuestionCard } from "../panels/QuestionCard";
import { nativeInteractionListPending, nativeInteractionResolve, type PendingInteraction, type QuestionAnswer } from "../../lib/interactions";
const LogPanel = lazy(() => import("./LogPanel").then((m) => ({ default: m.LogPanel })));
import { CrashReportNotice } from "./CrashReportNotice";
const DebugPanel = lazy(() => import("../panels/DebugPanel").then((m) => ({ default: m.DebugPanel })));
import { useLogs } from "../../state/log";
import { useAccount } from "../../state/account";
import type { UpdaterState } from "../../state/updater";
import { batchPromoteIdeas, setPlanStatus, type Plan, type NewPlan, type PlanFocusContext } from "../../lib/plans";
import { createIdea, ensureDefaultCategories, type Idea, type IdeaCategory } from "../../lib/ideas";
import { useIdeaState } from "../../state/ideas";
import type { SessionTab, TabKind } from "../../lib/sessions";
import { createSession, deleteSession } from "../../lib/sessions";
import { nativeChatCancel, nativeChatGet, nativeChatSend, nativeChatSetProjectModelDefault, nativeChatStart, nativeChatUpdateSessionModel, renameNativeChatSession, type ChatModelDefault } from "../../lib/native-chat";
import { assignPlanWithProfile, getLaunchProfile, validateReadiness, type LaunchProfile } from "../../lib/planDependencies";
import { isTerminalRunStatus, pipelineListRunsByProject } from "../../lib/pipeline";
import { usePlanningEvents } from "../../state/planningEvents";
import { humanizeChatTitle } from "../../lib/titles";
export type ToolId = "terminal";


/** Promise-based delay for polling loops. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

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
  const [testRunModalOpen, setTestRunModalOpen] = useState(false);
  const [testRunLogs, setTestRunLogs] = useState<string[]>([]);
  const [testRunRunning, setTestRunRunning] = useState(false);
  // Cancellation flag + run/session ids for cleanup. Refs so the async loop
  // reads the latest value without re-creating the callback on every toggle.
  const testRunCancelRef = useRef(false);
  const testRunChatSessionIdRef = useRef<string | null>(null);
  const testRunPlanRunIdRef = useRef<string | null>(null);
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
  const [appToasts, setAppToasts] = useState<{ id: string; title: string; detail?: string; kind: ToastKind }[]>([]);
  const [globalInteraction, setGlobalInteraction] = useState<PendingInteraction | null>(null);

  // Toast helper — defined early so all handlers can use it. Pushes a toast
  // to the array; ToastStack auto-removes it after 5 seconds.
  const handleShowToast = useCallback((title: string, detail?: string, kind: ToastKind = "success") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setAppToasts((prev) => [...prev, { id, title, detail, kind }]);
  }, []);
  const dismissAppToast = useCallback((id: string) => {
    setAppToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const [pendingDelivery, setPendingDelivery] = useState<{ text: string; mode: PromptMode; action?: DeliveryAction } | null>(null);
  // Idea round awaiting destination delivery — abandoned (finished) if the
  // user cancels the destination picker before the prompt is delivered.
  // A ref, not state: the picker fires onSelect and onClose synchronously in
  // one click, and the close handler must observe the cleared value.
  const pendingRoundRef = useRef<string | null>(null);
  const [roundGateOpen, setRoundGateOpen] = useState(false);
  const [roundSetupOpen, setRoundSetupOpen] = useState(false);
  // Escape-to-close for inline modals that don't have their own hook.
  useEscapeKey(changesModalOpen, () => setChangesModalOpen(false));
  useEscapeKey(plansModalOpen, () => setPlansModalOpen(false));
  useEscapeKey(schematicModalOpen, () => setSchematicModalOpen(false));
  useEscapeKey(roundSetupOpen, () => setRoundSetupOpen(false));
  useEscapeKey(debugPanelOpen, () => setDebugPanelOpen(false));
  const [focusedChatId, setFocusedChatId] = useState<string | null>(null);
  const [panelGridState, setPanelGridState] = useState<PanelGridState>(emptyGrid());
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(emptyWorkspaceState(""));
  const [backgroundChatSessionIds, setBackgroundChatSessionIds] = useState<Set<string>>(new Set());
  // Chats owned by active *pipeline* stages (e.g. OpenSpec generation). Plan
  // runs feed `backgroundChatSessionIds` via plan-run events; pipeline runs
  // have no such event payload, so they are polled on planning events.
  const [pipelineBgChatIds, setPipelineBgChatIds] = useState<Set<string>>(new Set());
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
  const plans = usePlans(session.activeSessionId, activeProjectPath);
  const schematic = useProjectSchematic(activeProjectPath);
  const ideaState = useIdeaState(session.activeSessionId, activeProjectPath);
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
  // Seed a first chat only for a genuinely empty project. Active hidden
  // surfaces intentionally leave the center empty until the user restores one
  // or presses the explicit Add chat window action.
  useEffect(() => {
    if (!activeProjectPath || !session.activeSessionId || projectRestoreLoading) return;
    if (restoredProjectRef.current !== activeProjectPath) return;
    if (panelGridState.root || hiddenPanelsOf(panelGridState).length > 0) return;
    if (session.activeSession?.title === "New Session") return;
    const newPanel: Panel = {
      id: newPanelId(),
      type: "chat",
      title: "Chat 1",
      chatSessionId: null,
      terminalId: null,
      filePath: null,
    };
    setPanelGridState((prev) => prev.root || hiddenPanelsOf(prev).length > 0 ? prev : singlePanelGrid(newPanel));
  }, [activeProjectPath, session.activeSessionId, panelGridState, session.activeSession?.title, projectRestoreLoading]);


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
  // it as a new panel in the panel grid (per `panel-grid`) and focus it.
  // Subscribed once; the existing-panel check runs inside the state updater
  // so re-emits or overlapping subscriptions can never double-insert.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onPlanRunEvent((event) => {
      const chatSessionId = event.chatSessionId;
      // Track background chat sessions for minimize-button display.
      if (chatSessionId) {
        setBackgroundChatSessionIds((prev) => {
          if (event.status === "running" || event.status === "pending") {
            if (prev.has(chatSessionId)) return prev;
            return new Set(prev).add(chatSessionId);
          }
          if (!prev.has(chatSessionId)) return prev;
          const next = new Set(prev);
          next.delete(chatSessionId);
          return next;
        });
      }
      if (event.status !== "running" || !chatSessionId) return;
      setPanelGridState((prev) => {
        // Already surfaced — just focus it (idempotent under duplicate events).
        const existingPanel = flattenPanels(prev.root).find((p) => p.id === chatSessionId || p.chatSessionId === chatSessionId);
        if (existingPanel) {
          return prev.activePanelId === existingPanel.id ? prev : { ...prev, activePanelId: existingPanel.id };
        }
        const newPanel: Panel = {
          id: chatSessionId,
          type: "chat",
          title: `Run ${chatSessionId.slice(-6)}`,
          chatSessionId,
          terminalId: null,
          filePath: null,
        };
        const result = insertPanel(prev, newPanel, { side: "right", anchorId: prev.activePanelId });
        if (!result.ok) {
          addLog("error", "Plan-run panel creation failed", result.reason);
          return prev;
        }
        return { ...result.state, activePanelId: newPanel.id };
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [addLog]);
  // Track chats owned by active pipeline stages (OpenSpec generation). The
  // set drives the background-agent tab styling and the composer gate.
  const refreshPipelineBgChats = useCallback(async () => {
    if (!activeProjectPath) {
      setPipelineBgChatIds(new Set());
      return;
    }
    try {
      const runs = await pipelineListRunsByProject(activeProjectPath);
      setPipelineBgChatIds(new Set(
        runs
          .filter((r) => (r.status === "running" || r.status === "pending") && r.sessionChatId)
          .map((r) => r.sessionChatId as string),
      ));
    } catch {
      // Transient query failure — keep the previous set.
    }
  }, [activeProjectPath]);
  useEffect(() => {
    void refreshPipelineBgChats();
  }, [refreshPipelineBgChats]);
  usePlanningEvents(refreshPipelineBgChats);
  const allBackgroundChatIds = useMemo(
    () => new Set([...backgroundChatSessionIds, ...pipelineBgChatIds]),
    [backgroundChatSessionIds, pipelineBgChatIds],
  );
  // Global interactive-request listener: when a background pipeline stage
  // (e.g. openspec generation) calls ask_user, the event arrives with the
  // workspace session ID — not a chat session ID — so no ChatPanel handles
  // it. This listener catches those and surfaces a modal so the user can
  // answer. ChatPanel filters by its own nchat_ session ID, so there's no
  // double-handling.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<{ sessionId: string; interactionId?: string }>(
      "native-chat://interactive-request",
      (event) => {
        const { sessionId } = event.payload;
        // Only handle events for workspace sessions (not chat sessions).
        // Chat sessions start with "nchat_" and are handled by ChatPanel.
        if (sessionId.startsWith("nchat_")) return;
        // Fetch pending interactions for the workspace session and show
        // the first one in a modal.
        void (async () => {
          try {
            const pending = await nativeInteractionListPending(sessionId);
            if (pending.length > 0) {
              setGlobalInteraction(pending[0]);
            }
          } catch {
            // Best-effort — the notification still points the user to act.
          }
        })();
      },
    ).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
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
  // Hydrate the versioned workspace state (active registry + visible tree +
  // history) from the same restore blob. Legacy PanelGridState blobs are
  // migrated in-memory by migrateFromLegacyBlob; v2 blobs parse directly.
  // This coexists with panelGridState during the transitional period — the
  // sidebar reads from workspaceState while the grid renderer still reads
  // from panelGridState (Phase 4 unifies the grid).
  useEffect(() => {
    if (!activeProjectPath) {
      setWorkspaceState(emptyWorkspaceState(""));
      return;
    }
    if (!workspaceRestore?.panelGrid) {
      setWorkspaceState(emptyWorkspaceState(activeProjectPath));
      return;
    }
    const result = migrateFromLegacyBlob(workspaceRestore.panelGrid, activeProjectPath);
    setWorkspaceState(result.state);
    if (result.repaired) {
      for (const d of result.diagnostics) {
        addLog("debug", "Workspace state repaired", `${d.kind}: ${d.message}`);
      }
    }
  }, [workspaceRestore, activeProjectPath, addLog]);
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
      // Defer the actual write to idle time so serializing/persisting never
      // competes with interaction paint. The 250ms debounce already coalesces
      // bursts; requestIdleCallback yields the final write to a quiet frame.
      const persist = () => {
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
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(persist, { timeout: 1000 });
      } else {
        persist();
      }
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

  const handleTestRunMode = useCallback(async (model: ChatModelDefault) => {
    // Reset cancellation + logs, mark running. The modal stays open and
    // streams progress via testRunLogs until the user closes or cancels.
    testRunCancelRef.current = false;
    testRunChatSessionIdRef.current = null;
    testRunPlanRunIdRef.current = null;
    setTestRunLogs([]);
    setTestRunRunning(true);
    handleShowToast("Test Run Mode", "Initializing test project and running the full plan lifecycle…", "info");
    // Mirror log lines to both the global log store and the modal's terminal.
    const log = (msg: string) => {
      addLog("debug", "Test Run Mode", msg);
      setTestRunLogs((prev) => [...prev, msg]);
    };
    const cancelled = () => {
      if (testRunCancelRef.current) throw new Error("Test run cancelled by user");
    };
    try {
      // ── 1. Initialize (or reuse) the test project ──────────────────────
      log("Initializing test project…");
      const projectPath = await testRunModeInit();
      cancelled();
      await sidebar.refreshProjects();

      // ── 2. Set the chosen model as the project default ─────────────────
      //    so generate_openspec (which calls resolve_model_default) uses
      //    the user's choice instead of falling back to a broken provider.
      await nativeChatSetProjectModelDefault(projectPath, model);
      cancelled();

      // ── 3. Create a workspace session + concept idea ───────────────────
      log("Creating session + idea…");
      const wsSession = await createSession(projectPath, "Test Run Mode");
      await ensureDefaultCategories(wsSession.id);
      const idea = await createIdea(
        wsSession.id,
        "Test Run Mode smoke test",
        "Automated idea created by Test Run Mode to verify the full plan lifecycle.",
      );

      // ── 4. Promote idea → plan (draft) ─────────────────────────────────
      log("Promoting idea → plan…");
      const promoteResult = await batchPromoteIdeas(wsSession.id, [idea.id]);
      if (promoteResult.errors.length > 0) {
        throw new Error(`Promote failed: ${promoteResult.errors[0].error}`);
      }
      const plan = promoteResult.created[0];
      if (!plan) throw new Error("No plan created during promotion");

      // ── 5. Move to openspec — kicks off generate_openspec pipeline ─────
      //    in the background. We must WAIT for it to finish before
      //    proceeding, otherwise the chat agent won't find any artifacts.
      log("Transitioning plan → openspec (waiting for generation)…");
      await setPlanStatus(plan.id, "openspec");

      // Poll the pipeline runs until the generate_openspec run reaches a
      // terminal status. Timeout after 120 seconds.
      const pipelineDeadline = Date.now() + 120_000;
      let openspecDone = false;
      while (Date.now() < pipelineDeadline) {
        await sleep(2000);
        cancelled();
        const runs = await pipelineListRunsByProject(projectPath);
        const openspecRun = runs.find((r) => r.kind === "generate_openspec" && r.planId === plan.id);
        if (openspecRun && isTerminalRunStatus(openspecRun.status)) {
          if (openspecRun.status !== "succeeded") {
            throw new Error(`OpenSpec generation ${openspecRun.status}: ${openspecRun.error ?? "unknown error"}`);
          }
          openspecDone = true;
          break;
        }
      }
      if (!openspecDone) throw new Error("Timed out waiting for OpenSpec generation to complete");
      log("OpenSpec generation complete");

      // ── 6. Approve: openspec → ready ───────────────────────────────────
      log("Approving plan (→ ready)…");
      await setPlanStatus(plan.id, "ready");

      // ── 7. Create a native chat session + assign the plan to it ────────
      log("Starting chat session + assigning plan…");
      const chatSession = await nativeChatStart({
        projectPath,
        title: "Test Run Mode",
        providerId: model.providerId,
        modelId: model.modelId,
        effortLevel: model.effortLevel,
      });
      testRunChatSessionIdRef.current = chatSession.id;
      const run = await assignPlanToChat(plan.id, chatSession.id);
      testRunPlanRunIdRef.current = run.id;
      log(`Run created: ${run.id} (status=${run.status})`);

      // ── 8. Send a message to start the agent loop ──────────────────────
      //    assignPlanToChat seeds an opening context message but does NOT
      //    start the agent loop. We send a message to kick it off.
      log("Sending start message to agent…");
      await nativeChatSend({
        sessionId: chatSession.id,
        content: "You are running in FULLY AUTONOMOUS test mode. Do NOT ask the user any questions. Do NOT use the ask_user tool. Make reasonable decisions on your own and proceed. Begin working on the assigned plan now. Read the OpenSpec change artifacts (proposal.md, design.md, specs/, tasks.md) and work through tasks.md top to bottom. Check off each task as you complete it. When all tasks are done, report what you finished. If you encounter ambiguity, pick the most reasonable option and continue — never stop to ask.",
        providerId: model.providerId,
        modelId: model.modelId,
        effortLevel: model.effortLevel,
      });

      // ── 9. Poll for the agent to finish, auto-resolving questions ──────
      //    The agent loop runs async. We poll the chat session's run_state:
      //    - "running" → agent is working, keep waiting
      //    - "needs_input" → agent called ask_user, creating a pending
      //      interaction that parks the loop on a channel. We must resolve
      //      it with nativeInteractionResolve (NOT send a new message) to
      //      unpark the agent. We auto-pick the recommended option or
      //      "continue" for free-text questions.
      //    - "idle" → agent finished, proceed to complete the run
      //    Timeout after 300 seconds (5 minutes) for the full agent run.
      log("Waiting for agent to finish (auto-resolving questions)…");
      const agentDeadline = Date.now() + 300_000;
      let agentDone = false;
      let autoReplyCount = 0;
      while (Date.now() < agentDeadline) {
        await sleep(3000);
        cancelled();
        const session = await nativeChatGet(chatSession.id);
        if (!session) throw new Error("Chat session disappeared during agent run");
        if (session.runState === "needs_input") {
          autoReplyCount++;
          log(`Agent needs input (auto-resolving #${autoReplyCount})…`);
          if (autoReplyCount > 20) {
            throw new Error("Agent asked for input too many times — aborting test run");
          }
          // List pending interactions and resolve them all.
          const pending = await nativeInteractionListPending(chatSession.id);
          for (const interaction of pending) {
            if (interaction.status !== "pending") continue;
            const answers: QuestionAnswer[] = interaction.questions.map((q) => {
              if (q.kind === "options" || q.kind === "multi") {
                // Pick the recommended option, or the first option.
                const idx = q.recommended ?? 0;
                const opt = q.options?.[idx]?.label ?? q.options?.[0]?.label ?? "Continue";
                return { questionId: q.id, selected: [opt] };
              }
              if (q.kind === "confirm") {
                return { questionId: q.id, selected: ["yes"] };
              }
              if (q.kind === "rating") {
                return { questionId: q.id, value: q.scale?.min ?? 1 };
              }
              // text — tell the agent to proceed autonomously.
              return { questionId: q.id, text: "Proceed autonomously. Make a reasonable decision and continue working on the plan." };
            });
            log(`Resolving interaction "${interaction.title ?? "(untitled)"}" with ${answers.length} answer(s)…`);
            await nativeInteractionResolve(interaction.id, answers);
          }
        } else if (session.runState === "idle") {
          agentDone = true;
          break;
        }
        // runState === "running" → keep polling
      }
      if (!agentDone) throw new Error("Timed out waiting for agent to finish");
      log("Agent finished");

      // ── 10. Complete the run ───────────────────────────────────────────
      log("Completing run…");
      await completePlanRun(run.id, true);

      // ── 11. Activate the test project in the sidebar ───────────────────
      await setLastFocusedProject(projectPath);
      setActiveProjectPath(projectPath);

      log("Test Run Mode complete — plan reached finished");
      handleShowToast("Test Run Mode complete", "Plan reached finished — check the Plans tab.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Test Run Mode failed", msg);
      setTestRunLogs((prev) => [...prev, `✗ ${msg}`]);
      handleShowToast("Test Run Mode failed", msg, "error");
    } finally {
      setTestRunRunning(false);
      testRunChatSessionIdRef.current = null;
      testRunPlanRunIdRef.current = null;
    }
  }, [sidebar, addLog, handleShowToast]);

  /** Cancel an in-progress Test Run Mode lifecycle. Signals the async loop
   *  to stop at its next checkpoint, then calls the backend cancel APIs so
   *  the agent loop and plan run are terminated cleanly. */
  const handleCancelTestRun = useCallback(async () => {
    testRunCancelRef.current = true;
    setTestRunLogs((prev) => [...prev, "Cancelling test run…"]);
    const sessionId = testRunChatSessionIdRef.current;
    const runId = testRunPlanRunIdRef.current;
    const tasks: Promise<unknown>[] = [];
    if (sessionId) tasks.push(nativeChatCancel(sessionId).catch((e) => addLog("warn", "nativeChatCancel failed", e instanceof Error ? e.message : String(e))));
    if (runId) tasks.push(cancelPlanRun(runId, false).catch((e) => addLog("warn", "cancelPlanRun failed", e instanceof Error ? e.message : String(e))));
    await Promise.all(tasks);
    setTestRunLogs((prev) => [...prev, "Test run cancelled."]);
    setTestRunRunning(false);
  }, [addLog]);

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
    async (idea: Idea, _chatSessionId: string | null) => {
      if (!session.activeSessionId) {
        throw new Error("Open a project before preparing a plan.");
      }
      const result = await batchPromoteIdeas(session.activeSessionId, [idea.id]);
      const created = result.created[0];
      if (!created) {
        throw new Error(result.errors[0]?.error ?? "The idea could not be promoted.");
      }

      await plans.refreshPlans();
      setPlansModalTab("plans");
      setPlansModalOpen(true);
      handleShowToast("Getting plan ready", `${created.referenceId} ${created.title}`, "info");

      void Promise.resolve(plans.setPlanStatus(created.id, "openspec"))
        .then(() => {
          handleShowToast("OpenSpec plan ready", `${created.referenceId} ${created.title}`, "success");
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          addLog("error", "OpenSpec plan preparation failed", message);
          handleShowToast("Plan preparation failed", message, "error");
        });
    },
    [plans, session.activeSessionId, addLog, handleShowToast],
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

  const handleDeleteChatPanel = useCallback(async (panelId: string, chatSessionId: string | null) => {
    if (chatSessionId && session.activeSessionId) {
      try {
        const runs = await listPlanRuns(session.activeSessionId);
        const owner = runs.find((run) =>
          run.chatSessionId === chatSessionId &&
          (run.status === "pending" || run.status === "running" || run.status === "paused")
        );
        if (owner) {
          handleShowToast(
            "Chat owns active work",
            "Keep the chat with Close, or cancel the linked run from Background agents before removing it.",
            "warning",
          );
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        handleShowToast("Could not verify chat ownership", message, "error");
        return;
      }
    }
    setPanelGridState((prev) => deletePanelFromHistory(prev, panelId));
  }, [handleShowToast, session.activeSessionId]);

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

  // Guided idea rounds keep the existing schematic soft gate, then collect a
  // bounded category scope before any provider turn or chat creation occurs.
  const handleStartIdeaRound = useCallback((proceedDespiteGate = false) => {
    if (!session.activeSessionId) {
      addLog("debug", "Idea round setup skipped", "no active session");
      handleShowToast("No active session", "Open a project first to run an idea round.", "warning");
      return;
    }
    const health = schematic.report?.health ?? (schematic.exists ? "partial" : "missing");
    if (health !== "complete" && !proceedDespiteGate) {
      addLog("debug", "Idea round soft gate opened", `health=${health}`);
      setRoundGateOpen(true);
      return;
    }
    addLog("debug", "Idea round setup opened", `health=${health}; categories=${ideaState.categories.length}`);
    setRoundGateOpen(false);
    setRoundSetupOpen(true);
  }, [session.activeSessionId, schematic.report, schematic.exists, ideaState.categories.length, addLog, handleShowToast]);

  const handleConfirmIdeaRound = useCallback(async (setup: IdeaRoundSetup) => {
    if (!session.activeSessionId) {
      addLog("debug", "Idea round confirmation skipped", "no active session");
      return;
    }
    const health = schematic.report?.health ?? (schematic.exists ? "partial" : "missing");
    const categories = ideaState.categories.filter((category) => setup.categoryIds.includes(category.id) && category.sessionId === session.activeSessionId);
    setRoundSetupOpen(false);
    let roundId: string;
    try {
      roundId = await startIdeaRound(session.activeSessionId);
      addLog("info", "Idea round started", `round=${roundId} gate=${health} categories=${categories.map((category) => category.id).join(",") || "project-wide"} ideas=${setup.ideaCount}`);
    } catch (e) {
      addLog("error", "Failed to start idea round", e instanceof Error ? e.message : String(e));
      handleShowToast("Round failed to start", "Could not start the idea round. See logs.", "error");
      return;
    }
    pendingRoundRef.current = roundId;
    const action = generateIdeaRoundAction(categories, setup.ideaCount, setup.direction);
    setPendingDelivery({ text: action.text, mode: action.mode, action: action.action });
    setDestinationPickerOpen(true);
    setPlansModalOpen(false);
    handleShowToast("Idea round ready", "Choose an existing chat or create a dedicated one.", "info");
  }, [session.activeSessionId, schematic.report, schematic.exists, ideaState.categories, addLog, handleShowToast]);

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

  /** Quick-assign from the indicators dropdown: load the saved launch profile
   *  (or a sane default) and open the destination picker. */
  const handleQuickAssignPlan = useCallback((plan: Plan) => {
    if (!activeProjectPath) return;
    void (async () => {
      let profile: LaunchProfile | null = null;
      try {
        profile = await getLaunchProfile(activeProjectPath);
      } catch {
        // fall through to defaults
      }
      handleAssignPlan(plan, profile ?? {
        projectPath: activeProjectPath,
        engine: "openspec",
        providerId: "",
        modelId: "",
        workerCount: 1,
        workspacePolicy: "isolated_worktrees",
        schedulingMode: "safe",
        finishPolicy: "hold",
        updatedAt: Date.now(),
      });
    })();
  }, [activeProjectPath, handleAssignPlan]);

  /** Approve an openspec plan from the indicators dropdown: validate readiness,
   *  then mark it ready so it can be applied to a chat. */
  const handleApprovePlan = useCallback((plan: Plan) => {
    return (async () => {
      try {
        const result = await validateReadiness(plan.id);
        if (result.errors.length > 0) {
          handleShowToast("Plan is not ready", result.errors[0], "error");
          return;
        }
        await plans.setPlanStatus(plan.id, "ready");
        handleShowToast("Plan approved", `#${plan.referenceId} is ready — apply it to a chat.`, "success");
      } catch (e) {
        handleShowToast("Approve failed", e instanceof Error ? e.message : String(e), "error");
      }
    })();
  }, [plans, handleShowToast]);

  /** Generate (draft) or regenerate (openspec) a plan's OpenSpec artifacts.
   *  The backend only runs the generate stage on a non-openspec → openspec
   *  transition, so a redo drops the plan back to draft first. */
  const handleRedoPlan = useCallback((plan: Plan) => {
    return (async () => {
      try {
        if (plan.status !== "draft") {
          await plans.setPlanStatus(plan.id, "draft");
        }
        await plans.setPlanStatus(plan.id, "openspec");
        handleShowToast(
          plan.status === "draft" ? "Generating plan" : "Redoing plan",
          "OpenSpec is generating in the background — check the agents icon in the taskbar for progress.",
          "info",
        );
      } catch (e) {
        handleShowToast("Plan generation failed", e instanceof Error ? e.message : String(e), "error");
      }
    })();
  }, [plans, handleShowToast]);


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
        await session.createTab("omp", `Oh My Pi Chat`, term.id);
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
    (type: "chat" | "terminal" | "omp" | "schematic", pendingPrompt?: { text: string; mode: PromptMode; action?: DeliveryAction }, options?: { hidden?: boolean }): void => {
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
        if (options?.hidden) {
          // Unlinked chat: add to hiddenPanels instead of the visible tree.
          setPanelGridState((prev) => ({
            ...prev,
            hiddenPanels: [pending, ...hiddenPanelsOf(prev)],
          }));
          addLog("debug", "Chat panel reserved (hidden)", `${panelId} (Chat ${chatCount})`);
        } else {
          if (!commitInsert(pending, panelGridState.activePanelId, "right")) {
            addLog("debug", "Chat panel insert failed", panelId);
            releaseGuard();
            return;
          }
          addLog("debug", "Chat panel reserved", `${panelId} (Chat ${chatCount})`);
        }
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
            setPanelGridState((prev) => {
              if (options?.hidden) {
                return { ...prev, hiddenPanels: hiddenPanelsOf(prev).filter((p) => p.id !== panelId) };
              }
              return removePanelFromGrid(prev, panelId);
            });
            handleShowToast("Failed to create chat", message, "error");
          } finally {
            releaseGuard();
          }
        })();
        return;
      }

      if (type === "terminal" || type === "omp") {
        const shell = type === "omp" ? "omp" : DEFAULT_SHELL();
        const baseTitle = type === "omp" ? "Oh My Pi Chat" : "Terminal";
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
            await session.createTab(type, type === "omp" ? "Oh My Pi Chat" : `Terminal ${term.id}`, term.id);
            // Bind the terminal id and clear `creating`.
            setPanelGridState((prev) => ({
              ...prev,
              root: updatePanelInTree(prev.root, panelId, {
                terminalId: term.id,
                title: type === "omp" ? "Oh My Pi Chat" : `Terminal ${term.id}`,
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
            backgroundAgent={(() => {
              const chatId = panel.chatSessionId ?? tab?.chatSessionId ?? null;
              return !!chatId && allBackgroundChatIds.has(chatId);
            })()}
            chatTitle={panel.title}
            schematicContent={schematic.content}
            onCreatePlanFromIdea={handleCreatePlanFromIdea}
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
              // Check both the visible tree and hidden panels.
              setPanelGridState((prev) => {
                const newRoot = updatePanelInTree(prev.root, panel.id, { chatSessionId, creating: false });
                if (newRoot !== prev.root) {
                  return { ...prev, root: newRoot };
                }
                // Panel might be in hiddenPanels — update there instead.
                const hidden = hiddenPanelsOf(prev);
                if (hidden.some((p) => p.id === panel.id)) {
                  return {
                    ...prev,
                    hiddenPanels: hidden.map((p) =>
                      p.id === panel.id ? { ...p, chatSessionId, creating: false } : p
                    ),
                  };
                }
                return prev;
              });
            }}
            onRenameChat={(title) => {
              setPanelGridState((prev) => {
                const newRoot = updatePanelInTree(prev.root, panel.id, { title });
                if (newRoot !== prev.root) return { ...prev, root: newRoot };
                const hidden = hiddenPanelsOf(prev);
                if (hidden.some((p) => p.id === panel.id)) {
                  return { ...prev, hiddenPanels: hidden.map((p) => p.id === panel.id ? { ...p, title } : p) };
                }
                return prev;
              });
              if (tab) {
                void session.setTabTitle(tab.id, title);
              }
            }}
            onOpenPlanningInspector={handleOpenPlanningInspector}
            onOpenSchematic={handleOpenSchematic}
            onCloseChat={() => setPanelGridState((prev) => closePanel(prev, panel.id))}
            onCloseAndDeleteChat={() => {
              void handleDeleteChatPanel(panel.id, panel.chatSessionId ?? null);
            }}
            onShowToast={handleShowToast}
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


  // ── Workspace bridge: convert panelGridState → WorkspaceState for the
  //    refactored single-surface PanelGrid. Surface ids are stable (panel
  //    id = surface id for single-tab panels, tab id for multi-tab). ──
  const gridWorkspaceState = useMemo(
    () => panelGridToWorkspaceState(panelGridState, activeProjectPath ?? ""),
    [panelGridState, activeProjectPath],
  );
  // The persisted panel grid is authoritative whenever it contains visible,
  // active hidden, or history panels. A v2-only workspace restore remains as
  // the compatibility fallback for older snapshots and focused tests.
  const hasPanelGridState = panelGridState.root !== null
    || hiddenPanelsOf(panelGridState).length > 0
    || panelGridState.closedPanels.length > 0;
  const sidebarWorkspaceState = useMemo(
    () => hasPanelGridState ? gridWorkspaceState : workspaceState,
    [hasPanelGridState, workspaceState, gridWorkspaceState],
  );

  const renderSurface = useCallback(
    (surface: SurfaceRecord, isActive: boolean) => {
      const panel = flattenPanels(panelGridState.root).find((p) => activeTabOfPanel(p).id === surface.id);
      if (!panel) return null;
      return renderPanel(panel, isActive);
    },
    [panelGridState.root, renderPanel],
  );

  const handleGridFocusSurface = useCallback(
    (surfaceId: string) => {
      const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
      if (!panelId) {
        addLog("debug", "Focus surface skipped", `surfaceId=${surfaceId} not found`);
        return;
      }
      setPanelGridState((prev) => (prev.activePanelId === panelId ? prev : { ...prev, activePanelId: panelId }));
    },
    [panelGridState, addLog],
  );

  const handleGridCloseSurface = useCallback(
    (surfaceId: string) => {
      const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
      if (!panelId) {
        addLog("debug", "Close surface skipped", `surfaceId=${surfaceId} not found`);
        return;
      }
      setPanelGridState((prev) => closePanel(prev, panelId));
    },
    [panelGridState, addLog],
  );

  const handleGridSplitFocused = useCallback(
    (direction: SplitDirection) => {
      const side: DropSide = direction === "horizontal" ? "right" : "bottom";
      const anchorId = panelGridState.activePanelId;
      addLog("debug", "Split focused surface", `direction=${direction} anchor=${anchorId ?? "none"}`);
      const newPanel = handleCreatePanel(anchorId, side);
      if (!commitInsert(newPanel, anchorId, side)) {
        addLog("debug", "Split focused surface failed", "commitInsert returned false");
      }
    },
    [panelGridState.activePanelId, handleCreatePanel, commitInsert, addLog],
  );


  const handleMoveSurface = useCallback(
    (surfaceId: string, targetSurfaceId: string, side: "left" | "right" | "top" | "bottom") => {
      const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
      const targetPanelId = surfaceIdToPanelId(panelGridState, targetSurfaceId);
      if (!panelId || !targetPanelId || panelId === targetPanelId) {
        addLog("debug", "Surface drag skipped", `surface=${surfaceId} target=${targetSurfaceId}`);
        return;
      }
      addLog("debug", "Surface moved", `surface=${surfaceId} target=${targetSurfaceId} side=${side}`);
      setPanelGridState((prev) => {
        if (hiddenPanelsOf(prev).some((panel) => panel.id === panelId)) {
          return linkHiddenPanel(prev, panelId, targetPanelId, side);
        }
        const root = movePanel(prev.root, panelId, targetPanelId, side);
        return root === prev.root ? prev : { ...prev, root, activePanelId: panelId };
      });
    },
    [panelGridState, addLog],
  );

  const handleResizeSplit = useCallback(
    (firstChildSurfaceId: string, deltaPx: number) => {
      const panelId = surfaceIdToPanelId(panelGridState, firstChildSurfaceId);
      if (!panelId || !panelGridState.root) return;
      const parentSplit = findParentSplit(panelGridState.root, panelId);
      if (!parentSplit) return;
      const childIndex = parentSplit.children.findIndex(
        (child) => child.kind === "leaf" && child.panel.id === panelId,
      );
      if (childIndex === -1) return;
      const totalSize = parentSplit.direction === "row"
        ? (typeof window !== "undefined" ? window.innerWidth - 80 : 1200)
        : (typeof window !== "undefined" ? window.innerHeight - 120 : 700);
      if (totalSize <= 0) return;
      const deltaFraction = deltaPx / totalSize;
      const newRoot = resizeSplitChild(panelGridState.root, parentSplit, childIndex, deltaFraction);
      setPanelGridState((prev) => ({ ...prev, root: newRoot }));
    },
    [panelGridState],
  );

  const handleEqualizeSplit = useCallback(
    (firstChildSurfaceId: string) => {
      const panelId = surfaceIdToPanelId(panelGridState, firstChildSurfaceId);
      if (!panelId || !panelGridState.root) return;
      const parentSplit = findParentSplit(panelGridState.root, panelId);
      if (!parentSplit) return;
      const newRoot = equalizeSplit(panelGridState.root, parentSplit);
      setPanelGridState((prev) => ({ ...prev, root: newRoot }));
    },
    [panelGridState],
  );


  /** Handle reopening a panel from history without disturbing the layout. */
  const handlePanelReopen = useCallback(
    (panelId: string) => {
      addLog("debug", "Surface reopened from history", panelId);
      setPanelGridState((prev) => reopenPanelHidden(prev, panelId));
    },
    [addLog],
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
  // ── Workspace surface lifecycle actions (sidebar) ──────────────────────
  // Persisted panel-grid surfaces mutate the same state the center workspace
  // renders. v2-only snapshots retain the workspace-state compatibility path.
  const handleFocusSurface = useCallback((surfaceId: string) => {
    addLog("debug", "Surface focus", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      // If the panel is in the stashed tree, restore the stashed group.
      if (panelGridState.stashedRoot && flattenPanels(panelGridState.stashedRoot).some((p) => p.id === panelId)) {
        setPanelGridState((prev) => restoreStashedGroup(prev, panelId));
      } else {
        setPanelGridState((prev) => ({ ...prev, activePanelId: panelId }));
      }
    } else {
      setWorkspaceState((prev) => focusSurfacePure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  const handleReplaceFocusedSurface = useCallback((surfaceId: string) => {
    addLog("debug", "Surface show only", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      // If the panel is in the stashed tree, restore the stashed group.
      if (panelGridState.stashedRoot && flattenPanels(panelGridState.stashedRoot).some((p) => p.id === panelId)) {
        setPanelGridState((prev) => restoreStashedGroup(prev, panelId));
      } else if (hiddenPanelsOf(panelGridState).some((panel) => panel.id === panelId)) {
        // Clicking an unlinked chat: stash the current linked group (if any)
        // and show ONLY this chat as the sole visible panel.
        setPanelGridState((prev) => showOnlyHiddenPanel(prev, panelId));
      }
    } else {
      setWorkspaceState((prev) => replaceFocusedSurfacePure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  const handleSplitFocusedSurface = useCallback((surfaceId: string, direction: SplitDirection) => {
    addLog("debug", "Surface split focused", `${surfaceId} ${direction}`);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId && hiddenPanelsOf(panelGridState).some((panel) => panel.id === panelId)) {
      setPanelGridState((prev) => splitHiddenPanel(prev, panelId, direction));
    } else {
      setWorkspaceState((prev) => splitFocusedSurfacePure(prev, surfaceId, direction));
    }
  }, [panelGridState, addLog]);

  const handleRemoveSurfaceFromLayout = useCallback((surfaceId: string) => {
    addLog("debug", "Surface remove from layout", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      setPanelGridState((prev) => hidePanel(prev, panelId));
    } else {
      setWorkspaceState((prev) => removeSurfaceFromLayoutPure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  const handleCloseSurface = useCallback((surfaceId: string) => {
    addLog("debug", "Surface close to history", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      setPanelGridState((prev) => closePanel(prev, panelId));
    } else {
      setWorkspaceState((prev) => closeSurfacePure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  const handleReopenSurface = useCallback((surfaceId: string) => {
    addLog("debug", "Surface reopen from history", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      setPanelGridState((prev) => reopenPanelHidden(prev, panelId));
    } else {
      setWorkspaceState((prev) => reopenSurfacePure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  const handleDeleteSurfaceFromHistory = useCallback((surfaceId: string) => {
    addLog("debug", "Surface delete from history", surfaceId);
    const panelId = surfaceIdToPanelId(panelGridState, surfaceId);
    if (panelId) {
      setPanelGridState((prev) => deletePanelFromHistory(prev, panelId));
    } else {
      setWorkspaceState((prev) => deleteSurfaceFromHistoryPure(prev, surfaceId));
    }
  }, [panelGridState, addLog]);

  /** Open a chat session as a visible panel in the grid: focus it when it is
   *  already surfaced, otherwise insert a new chat panel bound to the
   *  session. Panels — not backing tabs — are what the workspace renders;
   *  the old tab-only path changed nothing on screen and left orphaned tabs. */
  const handleOpenChatSession = useCallback(
    async (chatSessionId: string) => {
      if (!session.activeSessionId) return;
      // Resolve a human title for the panel; fall back to the session id tail.
      let title = `Chat ${chatSessionId.slice(-6)}`;
      try {
        const chat = await nativeChatGet(chatSessionId);
        if (chat?.title) title = humanizeChatTitle(chat.title);
      } catch {
        // Title lookup is cosmetic — keep the fallback.
      }
      setPanelGridState((prev) => {
        const existingPanel = flattenPanels(prev.root).find(
          (p) => p.id === chatSessionId || p.chatSessionId === chatSessionId,
        );
        if (existingPanel) {
          return prev.activePanelId === existingPanel.id ? prev : { ...prev, activePanelId: existingPanel.id };
        }
        // The panel may live in closed history (the user opened this chat
        // before and closed the tab). `insertPanel` rejects duplicate ids
        // against history, so reopen the history entry instead — this was a
        // silent dead-end for background agent chats after their run ended.
        const closed = prev.closedPanels.find(
          (p) => p.id === chatSessionId || p.chatSessionId === chatSessionId,
        );
        if (closed) {
          const reopened = reopenPanelChecked(prev, closed.id);
          if (!reopened.ok) {
            addLog("error", "Chat panel reopen failed", reopened.reason);
            return prev;
          }
          return { ...reopened.state, activePanelId: closed.id };
        }
        const newPanel: Panel = {
          id: chatSessionId,
          type: "chat",
          title,
          chatSessionId,
          terminalId: null,
          filePath: null,
        };
        const result = insertPanel(prev, newPanel, { side: "right", anchorId: prev.activePanelId });
        if (!result.ok) {
          addLog("error", "Chat panel creation failed", result.reason);
          return prev;
        }
        return { ...result.state, activePanelId: newPanel.id };
      });
    },
    [session.activeSessionId, addLog],
  );

  /** Open the chat hosting a plan's most recent run. Queries by plan_id
   *  (not session_id) so runs assigned from a different workspace session
   *  are still found. If the plan is "running" but no run has a chat
   *  session (zombie — execute_run crashed before linking), offer to
   *  re-assign instead of showing a dead-end toast. */
  const handleOpenPlanRunChat = useCallback(
    async (plan: Plan) => {
      try {
        const runs = await listPlanRunsByPlan(plan.id);
        const candidates = runs
          .filter((r) => r.chatSessionId)
          .sort((a, b) => {
            const activeA = a.status === "running" || a.status === "pending" ? 1 : 0;
            const activeB = b.status === "running" || b.status === "pending" ? 1 : 0;
            return activeB - activeA || b.createdAt - a.createdAt;
          });
        const run = candidates[0];
        if (run?.chatSessionId) {
          await handleOpenChatSession(run.chatSessionId);
          return;
        }
        // No chat-bound run. If the plan is running, it's a zombie — the run
        // row exists but execute_run crashed before linking a chat session.
        // Offer re-assign so the user can restart the agent.
        if (plan.status === "running") {
          handleShowToast(
            "Plan has no active chat",
            `#${plan.referenceId} is marked running but its run never linked a chat session. Re-assigning will start a fresh agent.`,
            "info",
          );
          handleQuickAssignPlan(plan);
        } else {
          handleShowToast(
            "No run chat",
            `#${plan.referenceId} has no chat session bound to a run yet.`,
            "info",
          );
        }
      } catch (e) {
        handleShowToast("Could not open run chat", e instanceof Error ? e.message : String(e), "error");
      }
    },
    [handleOpenChatSession, handleShowToast, handleQuickAssignPlan],
  );

  /** Handle notification clicks: pending_question opens the global
   *  interaction modal; plan/stage notifications open the plan focus modal. */
  const handleNotificationNavigate = useCallback(
    (n: Notification) => {
      if (n.kind === "pending_question") {
        // The entityId is the interaction ID — fetch pending interactions
        // for the active workspace session and find the matching one.
        if (!session.activeSessionId) return;
        const sid = session.activeSessionId;
        void (async () => {
          try {
            const pending = await nativeInteractionListPending(sid);
            const match = pending.find((p) => p.id === n.entityId) ?? pending[0];
            if (match) {
              setGlobalInteraction(match);
            } else {
              handleShowToast("Question resolved", "This question was already answered or cancelled.", "info");
            }
          } catch (e) {
            handleShowToast("Could not open question", e instanceof Error ? e.message : String(e), "error");
          }
        })();
      } else if (n.kind === "plan_status_changed" || n.kind === "plan_created") {
        // entityId is the plan ID — find it and open the focus modal.
        const plan = plans.plans.find((p) => p.id === n.entityId);
        if (plan) {
          setFocusingPlan(plan);
        }
      }
    },
    [session.activeSessionId, plans.plans, handleShowToast],
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
          <TaskbarNotifications onNavigate={handleNotificationNavigate} appToasts={appToasts} onDismissAppToast={dismissAppToast} />
          <BackgroundAgents
            sessionId={session.activeSessionId}
            projectPath={activeProjectPath}
            plans={plans.plans}
            onOpenChatSession={handleOpenChatSession}
            onOpenPlanning={(tab) => openPlanningModal(tab)}
          />
          <WindowControls />
        </div>
</div>
      <main
        className="app-shell app-shell-chat-first"
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      >
        <ActivitySidebar
          activeProjectPath={activeProjectPath}
          onFocusSurface={handleFocusSurface}
          workspaceState={sidebarWorkspaceState}
          onReplaceFocusedSurface={handleReplaceFocusedSurface}
          onSplitFocusedSurface={handleSplitFocusedSurface}
          onGroupSurface={handleMoveSurface}
          onRemoveSurfaceFromLayout={handleRemoveSurfaceFromLayout}
          onCloseSurface={handleCloseSurface}
          onReopenSurface={handleReopenSurface}
          onDeleteSurfaceFromHistory={handleDeleteSurfaceFromHistory}
          projects={sidebar.projects}
          account={account}
          updates={updates}
          onSelectProject={handleSelectProject}
          onOpenFolder={handleOpenFolder}
          onTestRunMode={() => setTestRunModalOpen(true)}
          onRemoveProject={handleRemoveProject}
          onOpenInExplorer={handleRevealProject}
          onCopyProjectPath={handleCopyProjectPath}
          onNewChat={() => handleCreateTypedPanel("chat", undefined, { hidden: true })}
          onOpenFiles={() => setFileModalOpen(true)}
          onOpenChanges={() => setChangesModalOpen(true)}
          pickerInFlight={sidebar.pickerInFlight}
          onCreateChat={() => handleCreateTypedPanel("chat")}
          onAddLinkedChat={() => handleGridSplitFocused("horizontal")}
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
                ompInstalled={ompInstalled}
              />
              <PlanningIndicators
                plans={plans.plans}
                sessionId={session.activeSessionId}
                projectPath={activeProjectPath}
                ideas={ideaState.ideas}
                categories={ideaState.categories}
                onGenerateMoreIdeas={() => handleStartIdeaRound()}
                onCreateIdea={async (title, description, categoryId) => {
                  await ideaState.createIdea(title, description, categoryId ?? undefined);
                  handleShowToast("Idea created", title, "success");
                }}
                onUpdateIdea={async (id, title, description, categoryId) => {
                  await ideaState.updateIdea(id, title, description, categoryId);
                  handleShowToast("Idea updated", title, "success");
                }}
                onSetIdeaStatus={async (id, status) => {
                  await ideaState.updateIdeaStatus(id, status);
                }}
                onDeleteIdea={async (id) => {
                  await ideaState.removeIdea(id);
                  handleShowToast("Idea deleted", "The idea was removed.", "info");
                }}
                onPromoteIdeas={async (ids) => {
                  await ideaState.promoteIdeas(ids);
                  await plans.refreshPlans();
                  handleShowToast(
                    ids.length === 1 ? "Idea upgraded" : "Ideas upgraded",
                    `${ids.length} draft plan${ids.length === 1 ? "" : "s"} created.`,
                    "success",
                  );
                }}
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
                onOpenPlan={handleFocusPlan}
                onOpenRunChat={(p: Plan) => void handleOpenPlanRunChat(p)}
                onAssignPlan={handleQuickAssignPlan}
                onApprovePlan={handleApprovePlan}
                onRedoPlan={handleRedoPlan}
                onDeletePlan={(planId: string) => {
                  return plans.deletePlan(planId).then(() => {
                    handleShowToast("Plan deleted", "The plan was removed.", "info");
                  }).catch((e: unknown) => {
                    handleShowToast("Delete failed", e instanceof Error ? e.message : String(e), "error");
                  });
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
                  state={gridWorkspaceState}
                  renderSurface={renderSurface}
                  onFocusSurface={handleGridFocusSurface}
                  onCloseSurface={handleGridCloseSurface}
                  onSplitFocused={handleGridSplitFocused}
                  onMoveSurface={handleMoveSurface}
                  onUnlinkSurface={handleRemoveSurfaceFromLayout}
                  onResize={handleResizeSplit}
                  onEqualize={handleEqualizeSplit}
                  viewportWidth={typeof window !== "undefined" ? window.innerWidth - 80 : 1200}
                  viewportHeight={typeof window !== "undefined" ? window.innerHeight - 120 : 700}
                  backgroundChatSessionIds={allBackgroundChatIds}
                  onAddChat={() => handleCreateTypedPanel("chat")}
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
        <ModalPortal>
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
        </ModalPortal>
      ) : null}
      {plansModalOpen && activeProjectPath ? (
        <ModalPortal>
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
        </ModalPortal>
      ) : null}
      {schematicModalOpen && activeProjectPath ? (
        <ModalPortal>
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
        </ModalPortal>
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
      <TestRunModeModal
        open={testRunModalOpen}
        onClose={() => setTestRunModalOpen(false)}
        onRun={(model) => { void handleTestRunMode(model); }}
        onCancel={() => { void handleCancelTestRun(); }}
        logs={testRunLogs}
        running={testRunRunning}
      />
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
          onCopyReference={handleCopyReference}
          onOpenInTerminal={handleOpenPlanInTerminal}
          onSetContext={(id, ctx: PlanFocusContext) => void plans.setPlanContext(id, ctx)}
          onOpenRunChat={(p) => void handleOpenPlanRunChat(p)}
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
        projectPath={activeProjectPath}
        mode={pendingAssign ? "assign" : "deliver"}
        onSelect={(choice: DestinationChoice) => {
          if (pendingAssign) {
            const assign = pendingAssign;
            // Returned to the picker so it shows a busy state until done.
            return (async () => {
              try {
                // Model confirmation: an explicit pick overrides both the
                // launch profile and the destination chat's session model.
                const profile = choice.model
                  ? { ...assign.profile, providerId: choice.model.providerId, modelId: choice.model.modelId, effortLevel: choice.model.effortLevel, updatedAt: Date.now() }
                  : assign.profile;
                let chatSessionId: string;
                let focusPanelId: string | null = null;
                if (choice.kind === "existing") {
                  chatSessionId = choice.chatSessionId;
                  focusPanelId = choice.panelId;
                  if (choice.model) {
                    await nativeChatUpdateSessionModel({
                      sessionId: chatSessionId,
                      providerId: choice.model.providerId,
                      modelId: choice.model.modelId,
                      effortLevel: choice.model.effortLevel,
                    });
                  }
                } else {
                  // New conversation — create a chat session for the plan
                  // (with the confirmed model), then assign and open it.
                  if (!activeProjectPath) throw new Error("No active project");
                  const chat = await nativeChatStart({
                    projectPath: activeProjectPath,
                    title: `Plan: ${assign.plan.title}`,
                    providerId: choice.model?.providerId ?? null,
                    modelId: choice.model?.modelId ?? null,
                    effortLevel: choice.model?.effortLevel ?? null,
                  });
                  chatSessionId = chat.id;
                }
                await assignPlanWithProfile({
                  planId: assign.plan.id,
                  chatSessionId,
                  profile,
                });
                handleShowToast("Plan assigned to chat", `${assign.plan.referenceId} ${assign.plan.title}`, "success");
                if (focusPanelId) {
                  setPanelGridState((prev) => ({ ...prev, activePanelId: focusPanelId }));
                }
                // New conversation: the plan-run "running" event inserts and
                // focuses the run panel — no extra tab here (a second surface
                // caused duplicate-panel errors and orphaned tabs).
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                handleShowToast("Failed to assign plan", msg, "error");
              } finally {
                setPendingAssign(null);
                setDestinationPickerOpen(false);
              }
            })();
          }
          if (!pendingDelivery) {
            addLog("debug", "DestinationPicker onSelect", "no pending delivery — skipping");
            return;
          }
          if (choice.kind === "existing") {
            addLog("debug", "DestinationPicker existing", `chatSessionId=${choice.chatSessionId} panel=${choice.panelId}`);
            const delivery = pendingDelivery;
            void (async () => {
              // Model confirmation for existing chats: persist the pick on the
              // session before the prompt lands. Best-effort — a failure still
              // delivers on the chat's current model.
              if (choice.model) {
                try {
                  await nativeChatUpdateSessionModel({
                    sessionId: choice.chatSessionId,
                    providerId: choice.model.providerId,
                    modelId: choice.model.modelId,
                    effortLevel: choice.model.effortLevel,
                  });
                } catch (e) {
                  addLog("warn", "Model override failed", e instanceof Error ? e.message : String(e));
                }
              }
              deliverPrompt({
                chatSessionId: choice.chatSessionId,
                text: delivery.text,
                mode: delivery.mode,
                action: delivery.action,
              });
            })();
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
      {roundSetupOpen ? (
        <IdeaRoundSetupModal
          categories={ideaState.categories.filter((cat) => cat.sessionId === session.activeSessionId)}
          onConfirm={(setup) => { void handleConfirmIdeaRound(setup); }}
          onCancel={() => {
            addLog("debug", "Idea round setup cancelled", "no round started");
            setRoundSetupOpen(false);
          }}
        />
      ) : null}
      <IdeaRoundGate
        open={roundGateOpen}
        health={schematic.exists ? "partial" : "missing"}
        onOpenWizard={() => { setRoundGateOpen(false); void handleStartSchematicWizard(); }}
        onProceed={() => { void handleStartIdeaRound(true); }}
        onCancel={() => setRoundGateOpen(false)}
      />
      {globalInteraction ? (
        <ModalPortal>
          <div className="modal-overlay" role="dialog" aria-label="Background agent question" onClick={() => setGlobalInteraction(null)}>
            <div className="modal modal-interaction" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">Background agent needs your input</span>
                <button className="btn-icon" type="button" title="Close" onClick={() => setGlobalInteraction(null)}>
                  <X size={14} />
                </button>
              </div>
              <div className="modal-body">
                <QuestionCard
                  interaction={globalInteraction}
                  onResolved={() => setGlobalInteraction(null)}
                  onCancelled={() => setGlobalInteraction(null)}
                />
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
    </PanelStatusProvider>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { usePromptDelivery } from "../../lib/promptDelivery";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { markStart, markEnd, formatRelativeTime } from "../../lib/timing";
import { usePanelStatusPublisher, type PanelStatus } from "./PanelStatusContext";
import { LogoPulse } from "../layout/LogoPulse";
import { ModalPortal } from "../ModalPortal";
import { CommandPalette } from "./CommandPalette";
import {
  BUILTIN_COMMANDS,
  buildCommandHelper,
  filterAndRank,
  formatCommandReference,
  KEYBOARD_GUIDE,
  parseCommandPayload,
  readCommandRecency,
  recordCommandUse,
  sourceLabel,
  tabComplete,
} from "../../lib/chatCommands";
import { ChatHeader } from "./ChatHeader";
import { ChatComposerControls } from "./ChatComposerControls";
import { PrRecommendationCard } from "./PrRecommendationCard";
import { QuestionCard } from "./QuestionCard";
import { InteractionWorkbench } from "./InteractionWorkbench";
import { IdeaBatchPreview, IdeaReviewWorkbench, parseIdeaBatch, type ParsedIdeaBatch, type ProposedIdea } from "./IdeaReviewWorkbench";
import { MarkdownView } from "./MarkdownView";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { OptionList } from "../layout/OptionList";
import { VoiceCallBar } from "./chat/VoiceCallBar";
import { VoiceSettingsModal } from "./chat/VoiceSettingsModal";
import { useVoiceCall } from "../../state/useVoiceCall";
import { voiceProfileGet, voiceProfileSet, type VoiceProfile } from "../../lib/voice";
import { speechText } from "./chat/chatFormat";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit2,
  FolderTree,
  Globe,
  HelpCircle,
  Key,
  LayoutGrid,
  Lightbulb,
  Link,
  Loader2,
  Mic,
  Phone,
  PhoneOff,
  Plug,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Sparkles,
  Square,
  LogOut,
  Settings2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "../../lib/app";
import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { gitBranchList, gitBranchSwitch, gitBranchCreate, gitCurrentBranch, type GitBranch } from "../../lib/git";
import { listWorkspaces } from "../../lib/workspaces";
import { prRecommend, prCreate, type PrRecommendation } from "../../lib/pullRequests";
import { onPlanRunEvent, assignPlanToChat } from "../../lib/planRuns";
import { listPlans } from "../../lib/plans";
import { nativeInteractionListAll, nativeInteractionResolve } from "../../lib/interactions";
import type { PendingInteraction } from "../../lib/interactions";
import { getApprovalMode, getRuntimeDefaults, setApprovalMode as setApprovalModeBackend, type ApprovalMode } from "../../lib/settings";
import {
  nativeChatBootstrap,
  nativeChatCancel,
  nativeChatClearMessages,
  nativeChatInputHistoryAdd,
  nativeChatInputHistoryList,
  nativeChatGet,
  nativeChatMessages,
  nativeChatSend,
  nativeChatSteer,
  nativeChatSetProjectModelDefault,
  nativeChatUpdateSessionModel,
  nativeChatStart,
  nativeChatToolEvents,
  nativeDeleteProviderCredential,
  nativeGenerateIdeas,
  nativeProviderCatalog,
  nativeProviderCatalogRefresh,
  nativeProviderRefreshOmpCredentials,
  nativeProviderLoginCancel,
  nativeProviderLoginPoll,
  nativeProviderLoginStart,
  nativeProviderLoginSubmit,
  nativeSessionLatestMetric,
  nativeSaveProviderCredential,
  nativeProviderAccountsList,
  nativeProviderAccountLogout,
  nativeProviderAccountSetLabel,
  nativeProviderAccountTest,
  nativeProviderAccountUsage,
  nativeProviderPopularity,
  renameNativeChatSession,
  type ChatModelDefault,
  type NativeChatMessage,
  type NativeModel,
  type NativeProviderCatalog,
  type NativeProvider,
  type NativeSetupRequired,
  type NativeProviderLoginState,
  type NativeToolEvent,
  type ProviderAccount,
  type ProviderAccountUsage,
} from "../../lib/native-chat";
import { resolveToolApproval } from "../../lib/native-chat";
import { buildChatTimeline, type LiveSegment } from "../../lib/chatTimeline";
import { useIdeaState } from "../../state/ideas";
import { setLastGrounding } from "../../state/grounding";
import { createIdea, type Idea } from "../../lib/ideas";
import { inspectProjectSchematic, type SchematicReport } from "../../lib/schematic";
import { schematicWizardAction } from "../../lib/planningActions";
import { readSkill } from "../../lib/skills";
import type { AgentMode } from "../../lib/sessions";
import { readModelRecency, readProviderRecency, recordModelUse, recordProviderUse } from "../../lib/modelRecency";
import { compareProviders } from "../../lib/providerRanking";
import { useLogs } from "../../state/log";

import {
  SEND_TIMEOUT_MS,
  NATIVE_PROFILE_ID,
  LOCAL_PROVIDER_ID,
  waitForProviderLoginPoll,
  CONNECTED_VIA_LABELS,
  modelDetection,
  ACCOUNT_AUTH_LABELS,
  ACCOUNT_HEALTH_LABELS,
  formatTokens,
  formatRequestRate,
  formatTokenRate,
  accountRelativeTime,
  accountConnectedLabel,
  cooldownSecondsLeft,
  providerAuthOptionsLabel,
  detectProseQuickReplies,
  formatElapsed,
  resolveAssistantLabel,
  type ManageTab,
  type LegacyChatMessage,
} from "./chat/chatFormat";
import { ThinkingBlock, UserMessageContent } from "./chat/ChatMessageParts";
import { ToolEventCard } from "./chat/ToolEventCard";
import { ChatTranscript } from "./chat/ChatTranscript";
import { ProviderManageModal } from "./chat/ProviderManageModal";
import { ProviderCatalogModal } from "./chat/ProviderCatalogModal";
type ChatPanelProps = {
  projectPath: string;
  chatSessionId?: string | null;
  onChatSessionCreated?: (id: string) => void;
  /** Panel grid id — used to publish live status to the activity sidebar. */
  panelId?: string | null;
  /** Project session id — used to persist generated ideas and seed plans. */
  activeSessionId?: string | null;
  /** Project schematic content, sent to the provider for idea generation. */
  schematicContent?: string | null;
  /** Promote a generated idea and start preparing its OpenSpec plan. */
  onCreatePlanFromIdea?: (idea: Idea, chatSessionId: string | null) => Promise<void> | void;
  /** Open the planning inspector (side panel). */
  onOpenPlanningInspector?: () => void;
  /** Open the schematic tab (focus or create). */
  onOpenSchematic?: () => void;
  /** Chat column title (for the header). If absent, a default is derived. */
  chatTitle?: string;
  /** Called when the user renames the chat in the header. */
  onRenameChat?: (title: string) => void;
  /** Close this chat panel (retain session in history). */
  onCloseChat?: () => void;
  /** Close and permanently delete the session. */
  onCloseAndDeleteChat?: () => void;
  /** Start a fresh empty chat for the current project (keeps the previous chat). */
  onNewChat?: () => void;
  /** Show a toast notification (success/warning/error/info). */
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
  /** Open the history drawer (closed panels). */
  onOpenHistory?: () => void;
  /** Called when the USER sends a message from this chat. Drives the sidebar's
   *  recency ordering — the only signal that reorders it. */
  onUserMessageSent?: () => void;
  /** True when an active background agent (plan run or pipeline stage) owns
   *  this chat — gates the composer until the user explicitly enables it. */
  backgroundAgent?: boolean;
};

export function ChatPanel({
  projectPath,
  chatSessionId,
  onChatSessionCreated,
  panelId,
  activeSessionId,
  schematicContent,
  onCreatePlanFromIdea,
  onOpenPlanningInspector,
  onOpenSchematic,
  chatTitle,
  onRenameChat,
  onCloseChat,
  onCloseAndDeleteChat,
  onNewChat,
  onShowToast,
  onOpenHistory,
  onUserMessageSent,
  backgroundAgent,
}: ChatPanelProps) {
  const [profileId, setProfileId] = useState(NATIVE_PROFILE_ID);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "refreshing" | "ready" | "stale" | "error">("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [contextUsedTokens, setContextUsedTokens] = useState(0);
  // Latest completed-turn generation stats, shown only for local providers.
  const [genStats, setGenStats] = useState<{
    tokensPerSecond: number | null;
    ttftMs: number | null;
    durationMs: number | null;
  } | null>(null);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
  // Composer gate for background-agent chats: input stays locked until the
  // user explicitly opts in, since sending into the agent's session can
  // derail its original task. Reset when the panel rebinds to another chat.
  const [bgInputUnlocked, setBgInputUnlocked] = useState(false);
  // Terminal outcome of a background agent run bound to this chat; drives
  // the sidebar status word ("finished" / "Background agent failed").
  const [bgOutcome, setBgOutcome] = useState<"succeeded" | "failed" | "cancelled" | null>(null);
  useEffect(() => {
    setBgInputUnlocked(false);
    setBgOutcome(null);
    historyIndexRef.current = -1;
    savedDraftRef.current = "";
  }, [nativeSessionId]);
  const [nativeMessages, setNativeMessages] = useState<NativeChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<NativeToolEvent[]>([]);
  // Completed live-turn segments — text/reasoning of finished agent-loop
  // iterations, kept in chronological position while the turn streams.
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([]);
  // Monotonic arrival counter shared by live tool events and flushed
  // segments; orders items within the in-flight turn.
  const liveOrderRef = useRef(0);
  const [interactions, setInteractions] = useState<PendingInteraction[]>([]);
  const [minimizedQuestions, setMinimizedQuestions] = useState<Set<string>>(() => new Set());
  const [focusedIdeaBatchId, setFocusedIdeaBatchId] = useState<string | null>(null);
  const [ideaReviewIndexes, setIdeaReviewIndexes] = useState<Record<string, number>>({});
  const minimizedIdeaBatchIdsRef = useRef(new Set<string>());
  const [legacyMessages, setLegacyMessages] = useState<LegacyChatMessage[]>([]);
  const [providerId, setProviderId] = useState(LOCAL_PROVIDER_ID);
  const [modelId, setModelId] = useState("basebuild-local-coordinator");
  const [effortLevel, setEffortLevel] = useState("medium");
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  // ─── Input history (terminal-style ArrowUp/ArrowDown navigation) ───
  // Global persistent history: last 100 sent messages across ALL sessions,
  // preserved across session clears and app restarts. Loaded from the
  // backend SQLite store on mount and refreshed after each send.
  // The index is a ref so it doesn't trigger re-renders. -1 = not browsing.
  // A saved draft ref preserves the in-progress text when the user starts
  // browsing history, so ArrowDown past the end restores it.
  const historyIndexRef = useRef(-1);
  const savedDraftRef = useRef("");
  const [userHistory, setUserHistory] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    nativeChatInputHistoryList()
      .then((entries) => {
        if (!cancelled) setUserHistory(entries);
      })
      .catch(() => {
        // Backend may not be ready on first mount; silently ignore.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [loading, setLoading] = useState(false);
  // Session hydration, distinct from the send-scoped `loading` above: while
  // messages/tool events/interactions load, the transcript has nothing to
  // render and used to sit blank until they landed.
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [interruptedRun, setInterruptedRun] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem("basebuild.debug-mode") === "true");
  const [debugEvents, setDebugEvents] = useState<Array<{ ts: number; channel: string; data: unknown }>>([]);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [setupRequired, setSetupRequired] = useState<NativeSetupRequired | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("auto");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streamPhase, setStreamPhase] = useState<"idle" | "thinking" | "streaming" | "tools">("idle");
  const [lastToolEventTime, setLastToolEventTime] = useState(0);
  const [lastToolKind, setLastToolKind] = useState("");
  const [stalled, setStalled] = useState(false);
  const [toolAgoSeconds, setToolAgoSeconds] = useState(0);
  // Live tool-call argument stream: providers emit tool-call JSON on a
  // hidden channel, so a large payload (an eight-idea propose_ideas batch)
  // used to freeze the transcript for a minute with only a blinking cursor.
  const [toolCallChars, setToolCallChars] = useState(0);
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  // Seconds since ANY streamed delta (content/reasoning/tool_call) arrived.
  // Powers the "provider is quiet" hint outside the tools phase.
  const [quietSeconds, setQuietSeconds] = useState(0);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const followLatestRef = useRef(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const streamStartRef = useRef<number | null>(null);
  const [phaseElapsed, setPhaseElapsed] = useState(0);
  const phaseStartRef = useRef<number | null>(null);
  const lastToolEventTimeRef = useRef(0);
  const streamBufRef = useRef("");
  const reasoningBufRef = useRef("");
  const toolCallCharsRef = useRef(0);
  const lastDeltaAtRef = useRef(0);
  // Idea turns can start immediately after a new chat binds. Await both
  // subscriptions before invoking the backend so the first thinking/tool
  // events cannot race ahead of the webview listeners.
  const chunkListenerReadyRef = useRef<Promise<void>>(Promise.resolve());
  const toolListenerReadyRef = useRef<Promise<void>>(Promise.resolve());
  // Publish live panel status to the activity sidebar (project status dot).
  const publishPanelStatus = usePanelStatusPublisher(panelId ?? "");
  const lastPublishedStatusRef = useRef<PanelStatus | null>(null);
  useEffect(() => {
    if (!panelId) return;
    const hasPendingAsk = interactions.some((i) => i.status === "pending");
    const status: PanelStatus = hasPendingAsk
      ? "asking"
      : streaming
        ? (streamPhase === "tools" ? "running" : streamPhase === "thinking" ? "thinking" : "streaming")
        : loading
          ? "running"
          : bgOutcome === "failed"
            ? "error"
            : bgOutcome === "succeeded"
              ? "succeeded"
              : "idle";
    if (lastPublishedStatusRef.current === status) return;
    lastPublishedStatusRef.current = status;
    publishPanelStatus(status);
  }, [panelId, interactions, streaming, streamPhase, loading, bgOutcome, publishPanelStatus]);
  // Monotonic id for the in-flight native send. Bumped on stop or on a new
  // send so a superseded send's async resolution can't revive the spinner
  // or duplicate messages.
  const activeSendRef = useRef(0);
  const firstActivityRef = useRef(true);
  // Provider connection UI.
  const [showLogin, setShowLogin] = useState(false);
  const [managedProviderId, setManagedProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [providerLoginState, setProviderLoginState] = useState<NativeProviderLoginState | null>(null);
  const [providerLoginInput, setProviderLoginInput] = useState("");
  useEffect(() => {
    if (showLogin) return;
    setProviderLoginState(null);
    setProviderLoginInput("");
  }, [showLogin]);
  // Idea generation.
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  // Grounding metadata is written to the shared store (src/state/grounding.ts).
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [showPlanningMenu, setShowPlanningMenu] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [schematicReport, setSchematicReport] = useState<SchematicReport | null>(null);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  useEffect(() => {
    if (!showProviderPicker) setProviderFilter("");
  }, [showProviderPicker]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandRecency, setCommandRecency] = useState<Record<string, number>>(() => readCommandRecency());
  const [modelRecency, setModelRecency] = useState<Record<string, number>>(() => readModelRecency());
  const [providerRecency, setProviderRecency] = useState<Record<string, number>>(() => readProviderRecency());
  const [providerPopularity, setProviderPopularity] = useState<Record<string, number>>({});
  const [commandPayloadModal, setCommandPayloadModal] = useState<{ name: string; content: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  useEscapeKey(showProviderPicker || showModelPicker, () => {
    setShowProviderPicker(false);
    setShowModelPicker(false);
  });
  useEscapeKey(commandPayloadModal !== null, () => setCommandPayloadModal(null));
  const sendTimerRef = useRef<number | null>(null);
  const assistantBufferRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Expose the native session id on the DOM for e2e tests (data-native-session-id).
  const panelRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  // Ref indirection so the loadOrCreate effect doesn't re-run when the
  // inline onChatSessionCreated callback changes identity (it's a new
  // function on every render). Without this, calling onChatSessionCreated
  // triggers a grid update → re-render → new callback → effect re-runs →
  // calls onChatSessionCreated again → infinite loop.
  const onChatSessionCreatedRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    onChatSessionCreatedRef.current = onChatSessionCreated ?? null;
  }, [onChatSessionCreated]);
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.dataset.nativeSessionId = nativeSessionId ?? "";
    }
  }, [nativeSessionId]);
  // Chat header state: branch, worktree, plan badge, agent mode, PR recommendation.
  const [branch, setBranch] = useState<string | null>(null);
  const branchRef = useRef<string | null>(null);
  branchRef.current = branch;
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<{ sessionId: string; title: string } | null>(null);
  const [assignedPlanId, setAssignedPlanId] = useState<string | null>(null);
  const [planBadge, setPlanBadge] = useState<{ referenceId: string; title: string; status: string } | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>("plan");
  const [titleLocked, setTitleLocked] = useState(false);
  const [renameSignal, setRenameSignal] = useState(0);
  const [uncommittedCount, setUncommittedCount] = useState(0);
  const [prRec, setPrRec] = useState<PrRecommendation | null>(null);
  const [showPrCard, setShowPrCard] = useState(false);
  const [showAssignPlanPicker, setShowAssignPlanPicker] = useState(false);
  const [readyPlans, setReadyPlans] = useState<{ id: string; referenceId: string; title: string; status: string }[]>([]);
  // Soft gate: load schematic health when the planning menu opens.
  useEffect(() => {
    if (showPlanningMenu && projectPath) {
      void inspectProjectSchematic(projectPath).then(setSchematicReport).catch(() => setSchematicReport(null));
    }
  }, [showPlanningMenu, projectPath]);
  const { addLog } = useLogs();
  const ideaState = useIdeaState(activeSessionId ?? null, projectPath);
  const ideaRefreshRef = useRef(ideaState.refresh);
  ideaRefreshRef.current = ideaState.refresh;
  const sessionCategories = useMemo(
    () => ideaState.categories.filter((cat) => cat.sessionId === activeSessionId),
    [ideaState.categories, activeSessionId],
  );

  const filteredModels = useMemo(() => {
    const models = catalog?.models.filter((m) => m.providerId === providerId) ?? [];
    // The left-hand provider search narrows this list too, so a provider that
    // only surfaced because one of its models matched does not then show all
    // 55 of them. The model search box wins when the user has typed in it.
    // A needle that names the provider itself leaves the list untouched:
    // typing "openai" means "show me OpenAI", not "show me ids saying openai".
    const needle = (modelFilter.trim() || providerFilter.trim()).toLowerCase();
    const ranked = models.slice().sort((a, b) => {
      const aKey = `${a.providerId}/${a.id}`;
      const bKey = `${b.providerId}/${b.id}`;
      const aRecent = modelRecency[aKey] ?? 0;
      const bRecent = modelRecency[bKey] ?? 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      return (
        Number(b.supportsTools) - Number(a.supportsTools) ||
        Number(b.supportsReasoning) - Number(a.supportsReasoning) ||
        a.label.localeCompare(b.label)
      );
    });
    if (!needle) return ranked;
    // Every model here shares one provider, so resolve it once rather than
    // per row.
    const provider = catalog?.providers.find((p) => p.id === providerId);
    const providerMatches =
      providerId.toLowerCase().includes(needle) ||
      (provider?.label.toLowerCase().includes(needle) ?? false);
    if (providerMatches) return ranked;
    return ranked.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle),
    );
  }, [catalog, modelFilter, providerFilter, providerId, modelRecency]);
  const nativeMode = profileId === NATIVE_PROFILE_ID;
  const selectedProvider = catalog?.providers.find((p) => p.id === providerId) ?? null;
  const managedProvider = catalog?.providers.find((p) => p.id === managedProviderId) ?? null;
  // Bespoke-API providers (transport_unavailable) can't chat natively until
  // an endpoint URL is stored alongside a key.
  const needsEndpointUrl = managedProvider?.status === "transport_unavailable";
  const selectedModel = catalog?.models.find((m) => m.id === modelId && m.providerId === providerId) ?? null;
  const orderedProviders = useMemo(() => {
    if (!catalog) return [];
    return catalog.providers
      .slice()
      .sort((a, b) =>
        compareProviders(a, b, { recency: providerRecency, popularity: providerPopularity }),
      );
  }, [catalog, providerRecency, providerPopularity]);
  // Global anonymous usage popularity (basebuild.net) for usage-based
  // provider ordering. Public aggregate data; failure leaves the map empty and
  // ordering falls back to curated popular-first.
  useEffect(() => {
    let cancelled = false;
    void nativeProviderPopularity()
      .then((p) => {
        if (!cancelled) setProviderPopularity(p.providers ?? {});
      })
      .catch(() => {
        /* keep curated ordering */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const visibleCatalogProviders = useMemo(() => {
    const needle = providerFilter.trim().toLowerCase();
    if (!needle) return orderedProviders;
    // One pass over the flat model list instead of a full rescan per
    // provider: the catalog carries thousands of models and this runs on
    // every keystroke.
    const matchedByModel = new Set<string>();
    for (const model of catalog?.models ?? []) {
      if (matchedByModel.has(model.providerId)) continue;
      if (`${model.id} ${model.label}`.toLowerCase().includes(needle)) {
        matchedByModel.add(model.providerId);
      }
    }
    // Providers whose own id or label matches come first. Matching only
    // through a model id or a blurb is a far weaker signal: the aggregators
    // all carry `openai/*` ids, so typing "openai" otherwise buries OpenAI
    // itself under OpenRouter, AI/ML API and friends.
    const named = orderedProviders.filter((provider) =>
      `${provider.id} ${provider.label}`.toLowerCase().includes(needle),
    );
    const namedIds = new Set(named.map((provider) => provider.id));
    const related = orderedProviders.filter(
      (provider) =>
        !namedIds.has(provider.id) &&
        (provider.detail.toLowerCase().includes(needle) || matchedByModel.has(provider.id)),
    );
    return named.concat(related);
  }, [orderedProviders, providerFilter, catalog]);
  const connectedProviders = orderedProviders.filter((provider) => provider.configured);
  const availableProviders = orderedProviders.filter((provider) => !provider.configured);
  const availableModels = useMemo(
    () => catalog?.models.filter((m) => m.providerId === providerId) ?? [],
    [catalog, providerId],
  );

  // Restore persisted session identity immediately, then hydrate catalog
  // metadata and the effective project default from one backend snapshot.
  useEffect(() => {
    let cancelled = false;
    setCatalogStatus("loading");
    setCatalogError(null);

    const storedSessionPromise = nativeSessionId
      ? nativeChatGet(nativeSessionId)
      : Promise.resolve(null);
    void storedSessionPromise
      .then((storedSession) => {
        if (cancelled || !storedSession) return;
        setProviderId(storedSession.providerId);
        setModelId(storedSession.modelId);
        setEffortLevel(storedSession.effortLevel);
        setModelNotice(null);
      })
      .catch(() => {
        // The full bootstrap below reports a single actionable error.
      });

    async function load() {
      try {
        markStart("provider-model-restore");
        addLog("debug", "Chat config loading", `projectPath=${projectPath}`);
        const [defaults, bootstrap, storedSession] = await Promise.all([
          getRuntimeDefaults(),
          nativeChatBootstrap(projectPath),
          storedSessionPromise,
        ]);
        if (cancelled) return;
        setProfileId(defaults.defaultChatProfileId ?? NATIVE_PROFILE_ID);
        setCatalog(bootstrap.catalog);
        setCatalogStatus("ready");
        const effectiveProviderId = storedSession?.providerId ?? bootstrap.resolved.providerId;
        const effectiveModelId = storedSession?.modelId ?? bootstrap.resolved.modelId;
        const effectiveEffortLevel = storedSession?.effortLevel ?? bootstrap.resolved.effortLevel;
        setProviderId(effectiveProviderId);
        setModelId(effectiveModelId);
        setEffortLevel(effectiveEffortLevel);
        setModelNotice(storedSession ? null : bootstrap.resolved.notice);
        addLog("debug", "Chat config loaded", `source=${storedSession ? "session" : bootstrap.resolved.source} provider=${effectiveProviderId} model=${effectiveModelId} models=${bootstrap.catalog.models.length}`);
        markEnd("provider-model-restore");
        void getApprovalMode(projectPath)
          .then((nextMode) => {
            if (!cancelled) setApprovalMode(nextMode);
          })
          .catch(() => {
            // Keep the conservative in-memory default when permission loading fails.
          });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to load chat config", msg);
        setCatalogStatus("error");
        setCatalogError(msg);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [addLog, projectPath, nativeSessionId]);

  // Fix model when provider changes
  useEffect(() => {
    if (!catalog) return;
    if (availableModels.length > 0 && !availableModels.some((m) => m.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [availableModels, catalog, modelId]);

  // Sync chatSessionId prop
  useEffect(() => {
    setNativeSessionId(chatSessionId ?? null);
    setFocusedIdeaBatchId(null);
    setIdeaReviewIndexes({});
    minimizedIdeaBatchIdsRef.current.clear();
  }, [chatSessionId]);
  // Load session title when the native session changes.
  useEffect(() => {
    if (!nativeSessionId) { setSessionTitle(null); return; }
    let cancelled = false;
    void nativeChatGet(nativeSessionId).then((s) => {
      if (!cancelled && s) setSessionTitle({ sessionId: nativeSessionId, title: s.title });
    });
    return () => { cancelled = true; };
  }, [nativeSessionId]);
  // Sync session title to the panel/tab title so the sidebar shows the real
  // chat title instead of the default "Chat N". Guarded to the session the
  // title was loaded for and reading the callback through a ref: a project
  // switch swaps chatSessionId (and the callback identity) before the new
  // title loads, and re-firing with the stale title renamed the wrong tab.
  const onRenameChatRef = useRef(onRenameChat);
  onRenameChatRef.current = onRenameChat;
  useEffect(() => {
    if (sessionTitle && sessionTitle.sessionId === nativeSessionId) {
      onRenameChatRef.current?.(sessionTitle.title);
    }
  }, [sessionTitle, nativeSessionId]);

  // Native mode: load or create session. Times out after 15s so the panel
  // never hangs forever in "initializing" — the user sees an actionable
  // error and can retry or close the panel.
  useEffect(() => {
    if (!nativeMode || (!nativeSessionId && !catalog)) {
      // Nothing to hydrate is a settled state, not a pending one.
      setHydrating(false);
      return;
    }
    setHydrating(true);
    let cancelled = false;
    let timer: number | undefined;
    async function loadOrCreate() {
      try {
        if (nativeSessionId) {
          setContextUsedTokens(0);
          const latestMetric = nativeSessionLatestMetric(nativeSessionId).catch(() => null);
          addLog("debug", "Chat session loading", `Loading messages for ${nativeSessionId}`);
          const [msgs, events, intrs, sessionInfo] = await Promise.all([
            nativeChatMessages(nativeSessionId),
            nativeChatToolEvents(nativeSessionId),
            nativeInteractionListAll(nativeSessionId),
            nativeChatGet(nativeSessionId),
          ]);
          if (cancelled) return;
          setNativeMessages(msgs);
          setToolEvents(events);
          setInteractions(intrs);
          setLiveSegments([]);
          // A live run can be reattached after switching panels. A run swept
          // as interrupted after process restart is shown as recoverable
          // history instead of a phantom thinking indicator.
          const isRunning = sessionInfo?.runState === "running";
          setInterruptedRun(sessionInfo?.runState === "interrupted");
          if (isRunning) {
            setStreaming(true);
            setStreamPhase("thinking");
            streamStartRef.current = Date.now();
          } else {
            setStreaming(false);
            setStreamPhase("idle");
            streamStartRef.current = null;
          }
          void latestMetric.then((metric) => {
            if (!cancelled) {
              setContextUsedTokens(metric ? metric.inputTokens + metric.outputTokens : 0);
            }
          });
          addLog("debug", "Chat session loaded", `${nativeSessionId}: ${msgs.length} messages${sessionInfo?.runState === "running" ? " (running)" : ""}`);
          return;
        }
        addLog("debug", "Chat session creating", `projectPath=${projectPath} provider=${providerId} model=${modelId}`);
        const session = await Promise.race([
          nativeChatStart({
            projectPath,
            title: "New Chat",
            providerId,
            modelId,
            effortLevel,
          }),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error("Chat session creation timed out after 15s")), 15_000);
          }),
        ]);
        markStart("first-activity-event");
        firstActivityRef.current = true;
        setToolEvents([]);
        setInteractions([]);
        setError(null);
        addLog("debug", "Chat session created", session.id);
        // Notify the shell so it can bind chatSessionId on the panel + tab
        // and clear the `creating` flag. Without this the panel stays
        // "initializing" forever. Use the ref so the loadOrCreate effect
        // doesn't depend on the callback identity (inline arrow → new fn
        // every render → infinite loop if it's in the deps array).
        onChatSessionCreatedRef.current?.(session.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to open native chat", msg);
        if (!cancelled) setError(msg);
      } finally {
        if (timer) window.clearTimeout(timer);
        if (!cancelled) setHydrating(false);
      }
    }
    void loadOrCreate();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [nativeMode, catalog, nativeSessionId, projectPath, providerId, modelId, effortLevel, addLog]);
  // Background pipeline runs persist artifacts and terminal outcomes into
  // this chat from outside any user send. Reload the transcript when the
  // backend signals an update, and settle the streaming UI on the terminal
  // outcome so the panel never shows a phantom "still waiting" state.
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    if (!nativeSessionId) return;
    const unlisten = listen<{ sessionId: string; outcome?: "succeeded" | "failed" | "cancelled" }>(
      "native-chat://transcript-updated",
      (event) => {
        if (event.payload.sessionId !== nativeSessionId) return;
        // Never clobber an in-flight user send — its own finally block reloads.
        if (!loadingRef.current) {
          void Promise.all([
            nativeChatMessages(nativeSessionId),
            nativeChatToolEvents(nativeSessionId),
          ]).then(([msgs, events]) => {
            setNativeMessages(msgs);
            setToolEvents(events);
            setLiveSegments([]);
            streamBufRef.current = "";
            reasoningBufRef.current = "";
            setStreamText("");
            setReasoningText("");
          }).catch(() => {});
        }
        const outcome = event.payload.outcome;
        if (outcome) {
          setBgOutcome(outcome);
          setStreaming(false);
          setStreamPhase("idle");
          streamStartRef.current = null;
        }
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [nativeSessionId]);


  // Native mode: listen for streamed assistant chunks for this session
  useEffect(() => {
    let renderFrame: number | null = null;
    const scheduleStreamRender = () => {
      if (renderFrame !== null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        setStreamText(streamBufRef.current);
        setReasoningText(reasoningBufRef.current);
        setToolCallChars(toolCallCharsRef.current);
      });
    };
    const unlisten = listen<{ sessionId: string; delta: string; channel?: string }>(
      "native-chat://chunk",
      (event) => {
        if (event.payload.sessionId !== nativeSessionId) return;
        const channel = event.payload.channel ?? "content";
        // Status channel: the backend signals phase transitions so the UI
        // can show a thinking indicator before the first token and clear
        // streaming text between agent-loop iterations.
        if (channel === "status") {
          const phase = event.payload.delta;
          if (phase === "thinking" || phase === "next" || phase === "tools") {
            // Iteration boundary — promote the streamed text/reasoning into
            // a completed live segment so it stays in the transcript at its
            // chronological position (before the tools that follow it)
            // instead of being discarded when the next stream starts.
            const content = streamBufRef.current;
            const reasoning = reasoningBufRef.current;
            if (content.trim().length > 0 || reasoning.trim().length > 0) {
              const order = ++liveOrderRef.current;
              setLiveSegments((prev) => [...prev, {
                id: `live-seg-${order}`,
                content,
                reasoning: reasoning.trim().length > 0 ? reasoning : null,
                createdAt: Math.floor(Date.now() / 1000),
                order,
              }]);
            }
            if (renderFrame !== null) {
              window.cancelAnimationFrame(renderFrame);
              renderFrame = null;
            }
            streamBufRef.current = "";
            reasoningBufRef.current = "";
            setStreamText("");
            setReasoningText("");
            toolCallCharsRef.current = 0;
            setToolCallChars(0);
            setPendingToolName(null);
            setStreamPhase(phase === "tools" ? "tools" : "thinking");
          }
          return;
        }
        // Tool-call argument fragments are raw JSON — don't pollute the
        // content stream (they render as tool cards via the tool-event
        // channel), but do surface progress: a large payload can stream for
        // a minute with no content deltas at all.
        if (channel === "tool_call") {
          lastDeltaAtRef.current = Date.now();
          toolCallCharsRef.current += event.payload.delta.length;
          scheduleStreamRender();
          return;
        }
        // One-shot announcement of the tool being written, emitted when the
        // provider names the tool-call slot.
        if (channel === "tool_call_name") {
          lastDeltaAtRef.current = Date.now();
          setPendingToolName(event.payload.delta);
          return;
        }
        if (channel === "reasoning") {
          lastDeltaAtRef.current = Date.now();
          reasoningBufRef.current += event.payload.delta;
          scheduleStreamRender();
          return;
        }
        // Only the content channel accumulates into the visible stream.
        // Anything else (debug frames, tool summaries, protocol markers)
        // must never leak into the transcript — the debug listener captures
        // every channel when debug mode is on.
        if (channel !== "content") return;
        lastDeltaAtRef.current = Date.now();
        streamBufRef.current += event.payload.delta;
        scheduleStreamRender();
        setStreamPhase("streaming");
      },
    );
    chunkListenerReadyRef.current = unlisten.then(() => undefined);
    return () => {
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      void unlisten.then((fn) => fn());
    };
  }, [nativeMode, nativeSessionId]);

  // Debug mode: capture all native-chat events for inspection.
  useEffect(() => {
    if (!debugMode || !nativeSessionId) return;
    const channels = [
      "native-chat://chunk",
      "native-chat://tool-event",
      "native-chat://approval-request",
      "native-chat://interactive-request",
      "native-chat://error",
      "native-chat://metrics",
    ];
    const unlisteners: Promise<() => void>[] = [];
    for (const ch of channels) {
      unlisteners.push(listen(ch, (event) => {
        setDebugEvents((prev) => {
          const next = [...prev, { ts: Date.now(), channel: ch, data: event.payload }];
          // Cap at 500 entries to avoid unbounded memory.
          return next.length > 500 ? next.slice(-500) : next;
        });
      }));
    }
    return () => {
      for (const u of unlisteners) void u.then((fn) => fn());
    };
  }, [debugMode, nativeSessionId]);

  // Native mode: listen for live tool events (approval requests + tool cards)
  useEffect(() => {
    if (!nativeMode || !nativeSessionId) return;
    const unlistenTool = listen<{
      sessionId: string;
      toolCallId?: string;
      toolName: string;
      status: string;
      summary: string;
      arguments?: string;
      diff?: string;
      decision?: string;
      ruleSource?: string;
    }>("native-chat://tool-event", (event) => {
      if (event.payload.sessionId !== nativeSessionId) return;
      lastToolEventTimeRef.current = Date.now();
      setLastToolEventTime(Date.now());
      setLastToolKind(event.payload.toolName);
      if (firstActivityRef.current) {
        firstActivityRef.current = false;
        markEnd("first-activity-event");
      }
      const id = event.payload.toolCallId ?? `te-${Date.now()}-${Math.random()}`;
      const args = event.payload.arguments ?? null;
      const diff = event.payload.diff ?? null;
      const decision = event.payload.decision ?? null;
      const ruleSource = event.payload.ruleSource ?? null;
      const liveSeq = ++liveOrderRef.current;
      setToolEvents((prev) => {
        const existing = prev.find((e) => e.id === id);
        if (existing) {
          return prev.map((e) => e.id === id ? {
            ...e,
            status: event.payload.status,
            summary: event.payload.summary,
            kind: event.payload.toolName,
            arguments: args ?? e.arguments,
            diff: diff ?? e.diff,
            decision: decision ?? e.decision,
            ruleSource: ruleSource ?? e.ruleSource,
          } : e);
        }
        return [...prev, {
          id,
          sessionId: nativeSessionId,
          messageId: null,
          kind: event.payload.toolName,
          status: event.payload.status,
          summary: event.payload.summary,
          arguments: args,
          diff,
          decision,
          ruleSource,
          sequence: liveSeq,
          createdAt: Math.floor(Date.now() / 1000),
        }];
      });
      if (event.payload.toolName === "propose_ideas") {
        const terminalError = event.payload.status === "error"
          || event.payload.status === "failed"
          || event.payload.status === "denied";
        if (!terminalError && !minimizedIdeaBatchIdsRef.current.has(id)) {
          setFocusedIdeaBatchId(id);
        }
        if (event.payload.status !== "running" && event.payload.status !== "pending") {
          void ideaRefreshRef.current();
        }
      }
    });
    toolListenerReadyRef.current = unlistenTool.then(() => undefined);
    const unlistenApproval = listen<{
      sessionId: string;
      toolCallId: string;
      toolName: string;
      command?: string;
      arguments: string;
    }>("native-chat://approval-request", (event) => {
      if (event.payload.sessionId !== nativeSessionId) return;
      // Preserve the actual tool name and arguments so the card shows
      // what the model is trying to do, not just "approval required".
      const toolName = event.payload.toolName ?? "tool";
      const args = event.payload.arguments ?? "";
      const cmd = event.payload.command ?? "";
      // Build a useful summary: tool name + key arguments (truncated).
      let summary: string;
      if (cmd) {
        summary = `${toolName}: ${cmd}`;
      } else if (args) {
        const truncated = args.length > 200 ? args.slice(0, 200) + "…" : args;
        summary = `${toolName} — ${truncated}`;
      } else {
        summary = `${toolName} approval required`;
      }
      const liveSeq = ++liveOrderRef.current;
      setToolEvents((prev) => {
        // Replace if already exists (e.g. from tool-event stream).
        const existingIdx = prev.findIndex((e) => e.id === event.payload.toolCallId);
        if (existingIdx >= 0) {
          return prev.map((e) => e.id === event.payload.toolCallId
            ? { ...e, kind: toolName, status: "pending", summary, arguments: args || e.arguments, sequence: e.sequence }
            : e);
        }
        return [...prev, {
          id: event.payload.toolCallId,
          sessionId: nativeSessionId,
          messageId: null,
          kind: toolName,
          status: "pending",
          summary,
          arguments: args || null,
          diff: null,
          decision: null,
          ruleSource: null,
          sequence: liveSeq,
          createdAt: Math.floor(Date.now() / 1000),
        }];
      });
      // An approval demands attention: after the card renders, make sure it
      // is inside the viewport regardless of current scroll position.
      window.setTimeout(() => {
        scrollRef.current
          ?.querySelector(`[data-tool-id="${CSS.escape(event.payload.toolCallId)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }, 50);
    });
    const unlistenInteraction = listen<{ sessionId: string; interactionId?: string }>(
      "native-chat://interactive-request",
      (event) => {
        if (event.payload.sessionId !== nativeSessionId) return;
        // Refresh the full interaction list (pending + answered) so history
        // reloads correctly and new questions render inline.
        void nativeInteractionListAll(nativeSessionId)
          .then((list) => setInteractions(list))
          .catch(() => { /* best-effort */ });
      },
    );
    return () => {
      void unlistenTool.then((fn) => fn());
      void unlistenApproval.then((fn) => fn());
      void unlistenInteraction.then((fn) => fn());
    };
  }, [nativeMode, nativeSessionId]);

  // Load branch + worktree state for the header display. Best-effort: if the
  // project isn't a git repo or the commands fail, the header shows no branch.
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    async function loadBranchState() {
      try {
        const [br, bl] = await Promise.all([
          gitCurrentBranch(projectPath).catch(() => null),
          gitBranchList(projectPath).catch(() => [] as GitBranch[]),
        ]);
        if (cancelled) return;
        setBranch(br);
        setBranches(bl);
        // Check for a worktree matching this chat session.
        const workspaces = await listWorkspaces(projectPath).catch(() => []);
        if (cancelled) return;
        const match = workspaces.find((w) => w.branch === br);
        setWorktreePath(match?.path ?? null);
      } catch {
        // Non-git or unsupported — leave branch/worktree null.
      }
    }
    void loadBranchState();
    return () => { cancelled = true; };
  }, [projectPath]);

  // Listen for plan-run events: when a run finishes with a worktree, load the
  // PR recommendation. When a run starts, bind the plan badge.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onPlanRunEvent((event) => {
      if (!nativeSessionId || event.chatSessionId !== nativeSessionId) return;
      if (event.status === "running") {
        // Bind the plan badge from the run's plan.
        setAssignedPlanId(event.planId);
      }
      if (event.status === "succeeded") {
        // Load PR recommendation for the finished worktree run.
        // Use branchRef so the listener doesn't need to re-register
        // when branch changes (avoids missing events during re-registration).
        const br = branchRef.current;
        if (br) {
          void prRecommend(projectPath, br)
            .then((rec) => {
              setPrRec(rec);
              setShowPrCard(true);
            })
            .catch(() => { /* non-git or no remote — no recommendation */ });
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [nativeSessionId, projectPath]);

  // Handle approval mode changes from the UI (Allow All button, settings toggle).
  const handleSetApprovalMode = useCallback(async (mode: ApprovalMode) => {
    addLog("debug", "Permission mode selected", `projectPath=${projectPath}; mode=${mode}`);
    try {
      await setApprovalModeBackend(projectPath, mode);
      setApprovalMode(mode);
      const label = mode === "auto" ? "Auto — all tools allowed" : mode === "safe" ? "Safe — always ask" : "Balanced — read-only auto, mutating asks";
      onShowToast?.("Permission mode changed", label, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to set approval mode", msg);
      onShowToast?.("Failed to change permission mode", msg, "error");
    }
  }, [projectPath, addLog, onShowToast]);
  // Handle approval resolution from the UI
  const handleResolveApproval = useCallback(async (toolCallId: string, decision: "allow" | "allow_session" | "deny") => {
    try {
      await resolveToolApproval(toolCallId, decision);
      setToolEvents((prev) => prev.map((e) => e.id === toolCallId ? { ...e, status: decision === "deny" ? "denied" : "approved" } : e));
      if (decision === "deny") {
        onShowToast?.("Tool call denied", "The agent will be notified.", "warning");
      } else if (decision === "allow_session") {
        onShowToast?.("Tool allowed for session", "All calls to this tool are approved.", "info");
      } else {
        onShowToast?.("Tool allowed", "The tool call will proceed.", "success");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to resolve approval", msg);
      onShowToast?.("Failed to resolve approval", msg, "error");
    }
  }, [addLog, onShowToast]);

  useEffect(() => {
    if (nativeMode) return;
    let cancelled = false;
    let startedId: number | null = null;
    async function start() {
      try {
        const id = await agentStart({ cwd: projectPath, profileId });
        if (cancelled) {
          void agentStop(id);
          return;
        }
        startedId = id;
        setAgentId(id);
        setError(null);
        setLegacyMessages([{ role: "system", content: "Agent session started. Type a message to begin." }]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to start agent", msg);
        setError(msg);
        setLegacyMessages([{ role: "system", content: `Failed to start agent: ${msg}` }]);
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (startedId !== null) void agentStop(startedId);
    };
  }, [nativeMode, projectPath, profileId, addLog]);

  // Legacy mode: listen for output
  useEffect(() => {
    if (nativeMode) return;
    const unlisten = listen<{ id: number; kind: string; data?: string }>("agent://output", (event) => {
      if (agentId !== null && event.payload.id !== agentId) return;
      if (event.payload.kind === "close") {
        setLoading(false);
        setLegacyMessages((prev) => [...prev, { role: "system", content: "Agent session ended." }]);
        return;
      }
      const chunk = event.payload.data ?? "";
      assistantBufferRef.current += chunk;
      setLegacyMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), { role: "assistant", content: assistantBufferRef.current }];
        }
        return [...prev, { role: "assistant", content: assistantBufferRef.current }];
      });
      setLoading(false);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [agentId, nativeMode]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      if (nativeMode) {
        if (!nativeSessionId) return;
        // Pre-check: a non-local provider without a credential can't send — show
        // an inline connect prompt and keep the draft instead of silently failing.
        if (selectedProvider && !selectedProvider.configured && selectedProvider.id !== LOCAL_PROVIDER_ID) {
          setSetupRequired({
            providerId: selectedProvider.id,
            providerLabel: selectedProvider.label,
            message: `Connect ${selectedProvider.label} to send this message. Your draft was kept.`,
          });
          setManagedProviderId(selectedProvider.id);
          setShowLogin(true);
          return;
        }
        setInput("");
        onUserMessageSent?.();
        if (chatInputRef.current) chatInputRef.current.style.setProperty("--chat-input-height", "auto");
        setError(null);
        setSetupRequired(null);
        setInterruptedRun(false);
        setLoading(true);
        setStuck(false);
        streamBufRef.current = "";
        reasoningBufRef.current = "";
        setStreamText("");
        setReasoningText("");
        setLiveSegments([]);
        setStalled(false);
        setLastToolEventTime(0);
        setLastToolKind("");
        lastToolEventTimeRef.current = 0;
        toolCallCharsRef.current = 0;
        setToolCallChars(0);
        setPendingToolName(null);
        lastDeltaAtRef.current = Date.now();
        setQuietSeconds(0);
        setStreaming(true);
        streamStartRef.current = Date.now();
        setElapsed(0);
        setStreamPhase("thinking");
        followLatestRef.current = true;
        // Claim this send. A stop or a newer send bumps activeSendRef so this
        // send's async resolution becomes a no-op instead of reviving the
        // spinner or duplicating the streamed reply.
        const gen = ++activeSendRef.current;
        const tempUserId = `temp-${Date.now()}`;
        const tempUser: NativeChatMessage = {
          id: tempUserId,
          sessionId: nativeSessionId,
          role: "user",
          content: text,
          sortOrder: Number.MAX_SAFE_INTEGER,
          providerId,
          modelId,
          effortLevel,
          createdAt: Math.floor(Date.now() / 1000),
        };
        setNativeMessages((prev) => [...prev, tempUser]);
        // Persist to global input history (fire-and-forget; non-blocking).
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          nativeChatInputHistoryAdd(trimmed).catch(() => {
            // Non-fatal: history persistence is best-effort.
          });
          setUserHistory((prev) => {
            const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 100);
            return next;
          });
        }
        try {
          const result = await nativeChatSend({ sessionId: nativeSessionId, content: text, providerId, modelId, effortLevel });
          if (activeSendRef.current !== gen) return;
          if (result.metrics) {
            setContextUsedTokens(result.metrics.inputTokens + result.metrics.outputTokens);
          }
          setModelRecency(recordModelUse(providerId, modelId));
          // Reload the full persisted transcript — a turn may persist
          // multiple assistant rows (one per agent-loop iteration) with
          // their bound tool events, so an optimistic append is not enough.
          const [msgs, events] = await Promise.all([
            nativeChatMessages(nativeSessionId),
            nativeChatToolEvents(nativeSessionId),
          ]);
          setNativeMessages(msgs);
          setToolEvents(events);
          setLiveSegments([]);
          // Refresh session title (backend auto-titles from first message).
          void nativeChatGet(nativeSessionId).then((s) => {
            if (s) setSessionTitle({ sessionId: nativeSessionId, title: s.title });
          });
          if (result.setupRequired) {
            setSetupRequired(result.setupRequired);
            setManagedProviderId(result.setupRequired.providerId);
            setShowLogin(true);
          }
        } catch (e) {
          if (activeSendRef.current !== gen) return;
          const msg = e instanceof Error ? e.message : String(e);
          addLog("error", "Failed to send native message", msg);
          try {
            const [msgs, events] = await Promise.all([
              nativeChatMessages(nativeSessionId),
              nativeChatToolEvents(nativeSessionId),
            ]);
            setNativeMessages(msgs);
            setToolEvents(events);
            setLiveSegments([]);
          } catch {
            /* ignore */
          }
        } finally {
          if (activeSendRef.current === gen) {
            // Normal completion — this send still owns the composer.
            setStreaming(false);
            setStreamText("");
            setReasoningText("");
            setStreamPhase("idle");
            streamStartRef.current = null;
            streamBufRef.current = "";
            reasoningBufRef.current = "";
            toolCallCharsRef.current = 0;
            setToolCallChars(0);
            setPendingToolName(null);
            setLoading(false);
          } else if (activeSendRef.current === gen + 1 && nativeSessionId) {
            // Stopped by the user, no newer send yet — reflect whatever the
            // backend persisted (partial reply + tool events) without touching
            // the spinner state (handleStopNative already reset it).
            try {
              const [msgs, events] = await Promise.all([
                nativeChatMessages(nativeSessionId),
                nativeChatToolEvents(nativeSessionId),
              ]);
              if (activeSendRef.current === gen + 1) {
                setNativeMessages(msgs);
                setToolEvents(events);
                setLiveSegments([]);
              }
            } catch {
              /* best-effort */
            }
          }
          // else: superseded by a newer send — leave its state untouched.
        }
        return;
      }
      if (agentId === null) return;
      setInput("");
      onUserMessageSent?.();
      setLoading(true);
      setStuck(false);
      assistantBufferRef.current = "";
      setLegacyMessages((prev) => [...prev, { role: "user", content: text }]);
      if (sendTimerRef.current) window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = window.setTimeout(() => {
        setStuck(true);
        setLoading(false);
        addLog("error", "Agent send timed out", `No response after ${SEND_TIMEOUT_MS / 1000}s.`);
      }, SEND_TIMEOUT_MS);
      try {
        await agentSend(agentId, text);
      } catch (e) {
        if (sendTimerRef.current) {
          window.clearTimeout(sendTimerRef.current);
          sendTimerRef.current = null;
        }
        setStuck(false);
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to send message to agent", msg);
        setLegacyMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
        setLoading(false);
      }
    },
    [nativeMode, nativeSessionId, selectedProvider, loading, providerId, modelId, effortLevel, agentId, addLog, setModelRecency, onUserMessageSent],
  );

  // Prompt delivery consumption — replaces the old draft-prompt props.
  // The shell queues a delivery via `deliverPrompt({ chatSessionId, text,
  // mode })`; this hook surfaces it when our native session is ready.
  // insert → set composer text + focus (no send); send → one user turn,
  // composer left empty. Tool-incapable model + wizard prompt → insert +
  // inline notice (no send).
  const { delivery, consume } = usePromptDelivery(nativeSessionId);
  // Exactly-once guard for send-mode deliveries. consume() only clears the
  // queue after the async work settles, so without this ref a stop (which
  // flips `loading` back to false while the delivered send is still in
  // flight) re-runs the effect and re-sends the same prompt.
  const attemptedDeliveryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!delivery || !nativeSessionId) return;
    if (delivery.mode === "insert") {
      setInput(delivery.text);
      consume();
      return;
    }
    // send mode — wait for catalog so the resolved provider/model is used.
    if (!catalog || loading) return;
    if (attemptedDeliveryRef.current === delivery.actionId) return;
    attemptedDeliveryRef.current = delivery.actionId;
    // Structured planning action — invoke the native command (persisted,
    // selectable idea cards) instead of sending prose to the chat agent.
    if (delivery.action?.kind === "generate_ideas") {
      consume();
      void generateIdeasRef.current?.({
        categoryIds: delivery.action.categoryIds ?? [],
        ideaCount: delivery.action.ideaCount ?? 8,
        direction: delivery.action.direction ?? undefined,
      });
      return;
    }
    void sendMessage(delivery.text.trim()).finally(() => consume());
  }, [delivery, consume, nativeSessionId, catalog, loading, sendMessage]);

  // Follow output explicitly instead of inferring pre-growth geometry from a
  // stale scroll height. Layout timing keeps the latest chunk visible before
  // paint; an intentional upward scroll opts out until the user returns.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !followLatestRef.current) return;
    el.scrollTop = el.scrollHeight;
    setIsScrolledUp(false);
  }, [nativeMessages, legacyMessages, streamText, reasoningText, streamPhase, toolEvents, interactions, loading, streaming]);

  // Track whether the user has scrolled up from the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const following = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
      followLatestRef.current = following;
      setIsScrolledUp(!following);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    followLatestRef.current = true;
    el.scrollTop = el.scrollHeight;
    setIsScrolledUp(false);
  }, []);

  // Highlight search matches in the transcript DOM.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // Clear previous marks.
    const existing = container.querySelectorAll("mark.chat-search-highlight");
    for (const mark of existing) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
    if (!searchQuery || !showSearch) {
      setSearchMatchCount(0);
      setSearchActiveIndex(0);
      return;
    }
    // Collect all text nodes before mutating.
    const query = searchQuery.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "MARK"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let textNode = walker.nextNode();
    while (textNode) {
      textNodes.push(textNode as Text);
      textNode = walker.nextNode();
    }
    // Wrap matches from end to start within each text node.
    let count = 0;
    for (const tn of textNodes) {
      if (count >= 500) break;
      const text = tn.textContent ?? "";
      const lower = text.toLowerCase();
      const indices: number[] = [];
      let pos = 0;
      while (pos < text.length && indices.length + count < 500) {
        const idx = lower.indexOf(query, pos);
        if (idx === -1) break;
        indices.push(idx);
        pos = idx + query.length;
      }
      for (let i = indices.length - 1; i >= 0; i--) {
        const idx = indices[i];
        const range = document.createRange();
        range.setStart(tn, idx);
        range.setEnd(tn, idx + query.length);
        const mark = document.createElement("mark");
        mark.className = "chat-search-highlight";
        range.surroundContents(mark);
        count++;
      }
    }
    const marks = container.querySelectorAll<HTMLElement>("mark.chat-search-highlight");
    setSearchMatchCount(marks.length);
    setSearchActiveIndex(0);
    if (marks[0]) {
      marks[0].classList.add("chat-search-highlight-active");
      marks[0].scrollIntoView({ block: "center" });
    }
  }, [searchQuery, showSearch]);

  // Update active highlight when index changes.
  useEffect(() => {
    const marks = scrollRef.current?.querySelectorAll<HTMLElement>("mark.chat-search-highlight") ?? [];
    marks.forEach((m, i) => {
      if (i === searchActiveIndex) m.classList.add("chat-search-highlight-active");
      else m.classList.remove("chat-search-highlight-active");
    });
  }, [searchActiveIndex, searchQuery, showSearch]);

  // Live elapsed timer — updates every second while streaming.
  useEffect(() => {
    if (!streaming || !streamStartRef.current) return;
    const interval = setInterval(() => {
      if (streamStartRef.current) {
        setElapsed(Math.floor((Date.now() - streamStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [streaming]);

  // Phase timer answers "how long has it been thinking/running tools?" rather
  // than showing only the total turn duration.
  useEffect(() => {
    if (!streaming || streamPhase === "idle") {
      phaseStartRef.current = null;
      setPhaseElapsed(0);
      return;
    }
    phaseStartRef.current = Date.now();
    setPhaseElapsed(0);
    const interval = window.setInterval(() => {
      if (phaseStartRef.current) {
        setPhaseElapsed(Math.floor((Date.now() - phaseStartRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [streaming, streamPhase]);

  // Stalled detection: if streaming in the tools phase and no tool event has
  // arrived for 60s, flag the turn as stalled. Also ticks the "Xs ago"
  // elapsed counter shown next to the tool names.
  useEffect(() => {
    if (!streaming) {
      setStalled(false);
      setToolAgoSeconds(0);
      setQuietSeconds(0);
      return;
    }
    const interval = window.setInterval(() => {
      const lastTime = lastToolEventTimeRef.current;
      if (streamPhase === "tools" && lastTime > 0) {
        const agoMs = Date.now() - lastTime;
        setToolAgoSeconds(Math.floor(agoMs / 1000));
        setStalled(agoMs > 60_000);
      } else {
        setStalled(false);
        setToolAgoSeconds(0);
      }
      // Quiet-provider detection outside the tools phase: deltas of every
      // channel bump lastDeltaAtRef, so a rising count means true silence.
      const lastDelta = lastDeltaAtRef.current;
      if (streamPhase !== "tools" && lastDelta > 0) {
        setQuietSeconds(Math.floor((Date.now() - lastDelta) / 1000));
      } else {
        setQuietSeconds(0);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [streaming, streamPhase]);

  // Clear stuck timer
  useEffect(() => {
    if (!loading && sendTimerRef.current) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, [loading]);

  // Ref to hold the latest handleStopNative so handleSend can call it
  // without a TDZ issue (handleStopNative is defined after handleSend).
  const stopNativeRef = useRef<() => Promise<void>>(async () => {});
  const persistSelectionRef = useRef<(providerId: string, modelId: string, effort: string) => void>(() => {});
  // Ref to handleGenerateIdeas so /idea generate can call it without a TDZ
  // issue (handleGenerateIdeas is defined after handleSend).
  const generateIdeasRef = useRef<((opts?: { categoryIds?: string[]; ideaCount?: number; direction?: string | null }) => Promise<void>) | null>(null);
  // Ref to handleClearChat so /new can clear the current chat without a TDZ
  // issue (handleClearChat is defined after handleSend).
  const clearChatRef = useRef<() => Promise<void>>(async () => {});

  // Mid-run steering. A running agent loop accepts new user turns: the backend
  // persists the message and injects it before the loop's next provider
  // request, so the user redirects the agent instead of stopping and
  // restarting it. Returns false when no run accepted the message (the turn
  // ended in the gap), leaving the draft untouched for the caller.
  const steerRunning = useCallback(async (text: string): Promise<boolean> => {
    if (!nativeMode || !nativeSessionId) return false;
    addLog("debug", "Chat steer", `session=${nativeSessionId} text=${text.slice(0, 80)}`);
    try {
      const result = await nativeChatSteer({ sessionId: nativeSessionId, content: text });
      const delivered = result.delivered ? result.message : null;
      if (!delivered) {
        addLog("debug", "Chat steer not delivered", `session=${nativeSessionId}: no active run accepted it`);
        return false;
      }
      setNativeMessages((prev) => (prev.some((m) => m.id === delivered.id) ? prev : [...prev, delivered]));
      setInput("");
      if (chatInputRef.current) chatInputRef.current.style.setProperty("--chat-input-height", "auto");
      nativeChatInputHistoryAdd(text).catch(() => {
        // Non-fatal: history persistence is best-effort.
      });
      setUserHistory((prev) => [text, ...prev.filter((h) => h !== text)].slice(0, 100));
      followLatestRef.current = true;
      addLog("debug", "Chat steer delivered", `session=${nativeSessionId} message=${delivered.id}`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to steer running chat", msg);
      setError(`Could not steer the running agent: ${msg}`);
      return false;
    }
  }, [nativeMode, nativeSessionId, addLog]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    addLog("debug", "Chat send", `text=${text.slice(0, 80)} nativeMode=${nativeMode} session=${nativeSessionId ?? "none"}`);
    if (!text) return;
    // A turn is already in flight: interject into it rather than blocking the
    // composer. Slash commands are excluded, they stay local UI actions and
    // /stop must still reach the running turn.
    if (nativeMode && nativeSessionId && (loading || streaming) && !text.startsWith("/")) {
      if (await steerRunning(text)) return;
      // No loop accepted it: the turn either just finished, or this route is a
      // plain stream with no agent loop to join. sendMessage drops sends while
      // `loading` is still settling, so name the outcome and keep the draft
      // instead of swallowing the turn.
      setCommandNotice("The running turn did not take that message: it either just finished or cannot be steered. Press Enter again to send it as a new message.");
      return;
    }
    if (nativeMode && text.startsWith("/")) {
      const [rawCommand, ...parts] = text.slice(1).split(/\s+/);
      const command = rawCommand.toLowerCase();
      const rest = parts.join(" ").trim();
      setCommandNotice(null);
      setShowCommandPalette(false);

      // Builtin-action dispatch map: commands that execute UI actions
      // immediately rather than expanding into a prompt.
      const builtinActions: Record<string, () => void | Promise<void>> = {
        login: () => {
          const provider = rest
            ? catalog?.providers.find((p) => p.id.toLowerCase() === rest.toLowerCase() || p.label.toLowerCase() === rest.toLowerCase())
            : null;
          if (provider) {
            if (provider.id !== LOCAL_PROVIDER_ID) {
              setManagedProviderId(provider.id);
              setShowLogin(true);
              setShowProviderPicker(false);
            } else {
              setProviderId(provider.id);
              setShowLogin(false);
            }
          } else {
            setShowProviderPicker(true);
            setShowLogin(false);
          }
          setCommandNotice(provider ? `Opening login for ${provider.label}…` : "Opening provider chooser…");
        },
        model: () => {
          setModelFilter(rest);
          setShowModelPicker(true);
          setShowProviderPicker(false);
          setCommandNotice(rest ? `Model picker filtered to "${rest}"` : "Model picker opened.");
        },
        provider: () => {
          setModelFilter("");
          setShowProviderPicker(true);
          setShowModelPicker(false);
          if (rest) {
            const match = catalog?.providers.find(
              (p) => p.id.toLowerCase().includes(rest.toLowerCase()) || p.label.toLowerCase().includes(rest.toLowerCase()),
            );
            if (match) {
              setProviderId(match.id);
              const providerModels = catalog?.models.filter((m) => m.providerId === match.id) ?? [];
              const currentIsValid = providerModels.some((m) => m.id === modelId);
              if (!currentIsValid && providerModels[0]) setModelId(providerModels[0].id);
              persistSelectionRef.current(match.id, modelId, effortLevel);
              setCommandNotice(`Switched to ${match.label}.`);
            } else {
              setCommandNotice(`No provider matching "${rest}". Use /provider to browse all providers.`);
            }
          } else {
            setCommandNotice("Provider picker opened.");
          }
        },
        clear: () => {
          if (nativeMessages.length > 0 || toolEvents.length > 0) {
            setShowClearConfirm(true);
            setCommandNotice("Confirm clearing this chat.");
          } else {
            setNativeMessages([]);
            setToolEvents([]);
            setStreamText("");
            setReasoningText("");
            setStreamPhase("idle");
            setCommandNotice("Chat is already empty.");
          }
        },
        new: () => {
          // /new clears the CURRENT chat in place (not a new tab/session).
          void clearChatRef.current();
          setCommandRecency(recordCommandUse("new"));
        },
        stop: () => {
          if (loading || streaming) {
            void stopNativeRef.current();
            setCommandNotice("Stopped the current request.");
          } else {
            setCommandNotice("Nothing is running.");
          }
        },
        commands: () => {
          const ref = formatCommandReference(BUILTIN_COMMANDS);
          const inChat = ref.filter((r) => r.category === "in-chat");
          const ui = ref.filter((r) => r.category === "ui");
          const fmt = (r: typeof ref[number]) => `/${r.name} — ${r.description} [${r.usage}]`;
          setCommandNotice(
            `In-Chat (${inChat.length}): ${inChat.map(fmt).join("  |  ")}  ||  UI (${ui.length}): ${ui.map(fmt).join("  |  ")}`,
          );
        },
        help: () => {
          const ref = formatCommandReference(BUILTIN_COMMANDS);
          const inChat = ref.filter((r) => r.category === "in-chat");
          const ui = ref.filter((r) => r.category === "ui");
          setCommandNotice(
            `In-Chat: ${inChat.map((r) => `/${r.name}`).join(", ")}  |  UI: ${ui.map((r) => `/${r.name}`).join(", ")}  —  ${KEYBOARD_GUIDE.join(" ")}`,
          );
        },
        mcp: () => {
          // MCP management is opened via Settings — show a notice.
          setCommandNotice("MCP servers are managed in Settings.");
        },
        plan: () => {
          setCommandNotice(rest ? `Plan: ${rest}` : "Plan commands: list, run <ref>, status");
        },
        idea: () => {
          if (rest === "generate") {
            void generateIdeasRef.current?.();
            setCommandNotice("Generating ideas…");
          } else if (rest === "promote") {
            setCommandNotice("Pick an idea in the Ideas panel to promote it to a plan.");
          } else {
            setCommandNotice("Idea commands: generate, promote");
          }
        },
        // schematic removed from builtinActions — all subcommands are
        // handled after the builtinActions dispatch because wizard/create/
        // update inject a skill into the chat (expandsToPrompt), and
        // view/inspect are handled there too for cohesion.
      };

      if (command in builtinActions) {
        await builtinActions[command]();
        setCommandRecency(recordCommandUse(command));
        setInput("");
        return;
      }

      // /models refresh — special-cased because it's async.
      if (command === "models" && rest.toLowerCase() === "refresh") {
        setCatalogStatus(catalog ? "refreshing" : "loading");
        setCatalogError(null);
        try {
          const refreshed = await nativeProviderCatalogRefresh({ force: true });
          setCatalog(refreshed);
          setCatalogStatus("ready");
          setCommandNotice("Model catalog refreshed.");
          setCommandRecency(recordCommandUse("models refresh"));
          setInput("");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setCatalogStatus(catalog ? "stale" : "error");
          setCatalogError(msg);
          setCommandNotice(`Model refresh failed: ${msg}`);
          addLog("error", "Failed to refresh model catalog", msg);
        }
        return;
      }

      // /skill:<name> — inject skill content into the chat.
      if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        if (skillName) {
          try {
            const skill = await readSkill(skillName);
            const wrapped = `<command name="/${command}">\n${skill.content}\n</command>${rest ? "\n" + rest : ""}`;
            await sendMessage(wrapped);
            setCommandRecency(recordCommandUse(command));
            setInput("");
            return;
          } catch {
            setCommandNotice(`Skill '${skillName}' not found.`);
            return;
          }
        }
      }

      // /schematic — in-chat skill injection (wizard) or UI action (view/inspect).
      if (command === "schematic") {
        // wizard / create / update / bare — inject the project-schematic
        // skill into the chat so the agent runs the guided interview inline.
        if (rest === "" || rest === "wizard" || rest === "create" || rest === "update") {
          addLog("debug", "Schematic wizard started", `subcommand=${rest || "wizard"} model=${selectedModel?.label ?? modelId}`);
          try {
            const skill = await readSkill("basebuild-project-schematic");
            const action = schematicWizardAction(skill.content, undefined);
            const wrapped = `<command name="/schematic${rest ? " " + rest : ""}">\n${action.text}\n</command>`;
            await sendMessage(wrapped);
            setCommandRecency(recordCommandUse("schematic"));
            setInput("");
            return;
          } catch {
            addLog("error", "Schematic wizard failed", "Failed to load basebuild-project-schematic skill");
            setCommandNotice("Failed to load the schematic skill. Check that the basebuild-project-schematic skill is installed.");
            return;
          }
        }
        // view — open the schematic tab (UI action).
        if (rest === "view") {
          onOpenSchematic?.();
          setCommandNotice("Opening schematic tab…");
          setCommandRecency(recordCommandUse("schematic"));
          setInput("");
          return;
        }
        // inspect — show health summary (diagnostic).
        if (rest === "inspect") {
          if (projectPath) {
            try {
              const report = await inspectProjectSchematic(projectPath);
              if (!report.exists) {
                setCommandNotice("No schematic found. Use /schematic to start the wizard.");
              } else {
                const filled = report.sections.filter((s) => s.state === "filled").length;
                const total = report.sections.length;
                setCommandNotice(`Schematic health: ${report.health} (${filled}/${total} sections filled).`);
              }
            } catch {
              setCommandNotice("Failed to inspect schematic.");
            }
          } else {
            setCommandNotice("Open a project to inspect its schematic.");
          }
          setCommandRecency(recordCommandUse("schematic"));
          setInput("");
          return;
        }
        // Unknown subcommand — show available options.
        setCommandNotice(`Unknown /schematic subcommand: ${rest}. Use /schematic wizard, /schematic view, or /schematic inspect.`);
        setInput("");
        return;
      }

      // Unknown command fallthrough: show notice + send-as-text action.
      setCommandNotice(`Unknown slash command: /${command}. Send as text or use /commands to see all available commands.`);
      return;
    }
    await sendMessage(text);
  }, [input, nativeMode, nativeSessionId, steerRunning, sendMessage, catalog, addLog, nativeMessages, toolEvents, loading, streaming, onNewChat, effortLevel, modelId, onOpenSchematic, projectPath, selectedModel]);

  // Voice call. The provider/model used for voice is a preference of its own:
  // the point is to dictate to a fast conversational model while typed work
  // stays on whatever the composer is set to.
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void voiceProfileGet()
      .then((profile) => {
        if (!cancelled) setVoiceProfile(profile);
      })
      .catch((err) => addLog("warn", "Voice profile unavailable", String(err)));
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  // A transcript is just a typed message that arrived by microphone: it steers
  // a turn already in flight, otherwise it opens a new one. Barge-in therefore
  // needs no separate path, it reuses the composer's steering route.
  const handleVoiceTranscript = useCallback(
    async (text: string) => {
      addLog("info", "Voice transcript", text.slice(0, 120));
      if (nativeMode && nativeSessionId && (loading || streaming)) {
        if (await steerRunning(text)) return;
      }
      await sendMessage(text);
    },
    [addLog, nativeMode, nativeSessionId, loading, streaming, steerRunning, sendMessage],
  );

  const voice = useVoiceCall({ profile: voiceProfile, onTranscript: handleVoiceTranscript, addLog });
  const { callActive: voiceCallActive, speak: voiceSpeak } = voice;
  const voiceReady = nativeMode && !!nativeSessionId;

  // Read each finished assistant reply aloud exactly once, and only during a
  // call. Keyed on content rather than index so a re-render cannot repeat a
  // sentence the user already heard.
  const spokenMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceCallActive || streaming || loading) return;
    const last = [...nativeMessages].reverse().find((m) => m.role === "assistant" && m.content.trim());
    if (!last || spokenMessageRef.current === last.content) return;
    spokenMessageRef.current = last.content;
    voiceSpeak(speechText(last.content));
  }, [nativeMessages, streaming, loading, voiceCallActive, voiceSpeak]);

  // Starting a call swaps the session onto the voice profile's provider/model
  // and remembers what was there, so hanging up puts the composer back exactly
  // where the user left it.
  const preVoiceSelectionRef = useRef<{ providerId: string; modelId: string; effort: string } | null>(null);
  const startVoiceCall = useCallback(async () => {
    if (voiceProfile?.providerId && voiceProfile.modelId) {
      preVoiceSelectionRef.current = { providerId, modelId, effort: effortLevel };
      setProviderId(voiceProfile.providerId);
      setModelId(voiceProfile.modelId);
      persistSelectionRef.current(voiceProfile.providerId, voiceProfile.modelId, voiceProfile.effortLevel || effortLevel);
      addLog("info", "Voice model applied", `${voiceProfile.providerId}/${voiceProfile.modelId}`);
    }
    await voice.startCall();
  }, [voiceProfile, providerId, modelId, effortLevel, setProviderId, setModelId, addLog, voice]);

  const endVoiceCall = useCallback(() => {
    voice.endCall();
    const previous = preVoiceSelectionRef.current;
    if (previous) {
      setProviderId(previous.providerId);
      setModelId(previous.modelId);
      persistSelectionRef.current(previous.providerId, previous.modelId, previous.effort);
      preVoiceSelectionRef.current = null;
      addLog("debug", "Voice model restored", `${previous.providerId}/${previous.modelId}`);
    }
  }, [voice, setProviderId, setModelId, addLog]);

  // Merged chronological timeline (messages + tool events + interactions).
  // Memoized so it is rebuilt only when the underlying lists change — not on
  // every render or stream delta tick (streamText renders separately).
  const chatTimeline = useMemo(
    () => buildChatTimeline(nativeMessages, toolEvents, interactions, liveSegments),
    [nativeMessages, toolEvents, interactions, liveSegments],
  );

  // Message action rail handlers.
  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      onShowToast?.("Copied to clipboard", "Message source copied.", "success");
    } catch {
      onShowToast?.("Copy failed", "Clipboard unavailable.", "error");
    }
  }, [onShowToast]);

  const handleCopyConversation = useCallback(async () => {
    const events = chatTimeline;
    if (events.length === 0) return;
    const lines: string[] = [];
    for (const ev of events) {
      if (ev.kind === "user" || ev.kind === "assistant" || ev.kind === "system") {
        const ts = ev.createdAt ? new Date(ev.createdAt * 1000).toISOString() : "";
        lines.push(`### ${ev.kind.toUpperCase()}${ts ? ` (${ts})` : ""}\n\n${ev.content}`);
        if (ev.reasoning) lines.push(`\n> **Reasoning:** ${ev.reasoning}`);
      } else if (ev.kind === "tool") {
        lines.push(`\n**Tool: ${ev.event.kind}** — ${ev.event.summary} (${ev.event.status})`);
      } else if (ev.kind === "interaction") {
        lines.push(`\n**Interaction: ${ev.interaction.id}** (status: ${ev.interaction.status})`);
      }
      lines.push("");
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      onShowToast?.("Copied conversation", "Full transcript copied as markdown.", "success");
    } catch {
      onShowToast?.("Copy failed", "Clipboard unavailable.", "error");
    }
  }, [chatTimeline, onShowToast]);

  const handleRetryMessage = useCallback(async () => {
    // Find the last user message content.
    const lastUser = [...nativeMessages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    await sendMessage(lastUser.content);
  }, [nativeMessages, sendMessage]);

  const handleEditAndResend = useCallback(() => {
    // Prefill the composer with the last user message and focus it.
    const lastUser = [...nativeMessages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setInput(lastUser.content);
    chatInputRef.current?.focus();
  }, [nativeMessages]);

  const handleStopAgent = useCallback(async () => {
    if (sendTimerRef.current) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    setStuck(false);
    setLoading(false);
    if (agentId !== null) {
      try {
        await agentStop(agentId);
      } catch {
        /* ignore */
      }
      setAgentId(null);
    }
    setLegacyMessages((prev) => [...prev, { role: "system", content: "Agent session stopped. Reloading..." }]);
    window.setTimeout(() => {
      void (async () => {
        try {
          const id = await agentStart({ cwd: projectPath, profileId });
          setAgentId(id);
          setLegacyMessages([{ role: "system", content: "Agent session restarted." }]);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 500);
  }, [agentId, projectPath, profileId]);
  // Forcefully stop the in-flight native chat turn: cancel the backend run,
  // invalidate the in-flight send so its resolution can't revive the spinner,
  // and immediately free the composer so the user can send again. Preserves
  // the partial stream text and reasoning so the user can read what was
  // generated before they stopped — the text clears on the next send.
  const handleStopNative = useCallback(async () => {
    if (!nativeSessionId) return;
    // Bump the generation first so the in-flight send()'s finally treats this
    // as a user stop (gen + 1) and reloads persisted partial output.
    activeSendRef.current += 1;
    setStreaming(false);
    streamStartRef.current = null;
    setElapsed(0);
    setStuck(false);
    setLoading(false);
    try {
      await nativeChatCancel(nativeSessionId);
    } catch (e) {
      addLog("error", "Failed to stop chat run", e instanceof Error ? e.message : String(e));
    }
  }, [nativeSessionId, addLog]);
  stopNativeRef.current = handleStopNative;

  // Delete persisted messages and tool events for the current session.
  // Preserves the session record and provider/model/effort selection.
  const handleClearChat = useCallback(async () => {
    setShowClearConfirm(false);
    if (!nativeSessionId) {
      setNativeMessages([]);
      setToolEvents([]);
      setLiveSegments([]);
      setStreamText("");
      setReasoningText("");
      setStreamPhase("idle");
      setCommandNotice("Chat cleared.");
      setCommandRecency(recordCommandUse("clear"));
      return;
    }
    try {
      const deleted = await nativeChatClearMessages(nativeSessionId);
      setNativeMessages([]);
      setToolEvents([]);
      setLiveSegments([]);
      setStreamText("");
      setReasoningText("");
      setStreamPhase("idle");
      setCommandNotice(`Cleared ${deleted} message${deleted === 1 ? "" : "s"}.`);
      setCommandRecency(recordCommandUse("clear"));
      addLog("debug", "Chat cleared", `sessionId=${nativeSessionId}; deleted=${deleted}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCommandNotice(`Failed to clear chat: ${msg}`);
      addLog("error", "Failed to clear chat messages", msg);
    }
  }, [nativeSessionId, addLog]);
  clearChatRef.current = handleClearChat;

  const refreshCatalog = useCallback(async (force = false, targetProviderId?: string) => {
    setCatalogStatus(catalog ? "refreshing" : "loading");
    setCatalogError(null);
    try {
      const refreshed = force
        ? await nativeProviderCatalogRefresh({ providerId: targetProviderId ?? null, force: true })
        : await nativeProviderCatalog();
      setCatalog(refreshed);
      setCatalogStatus("ready");
      return refreshed;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setCatalogStatus(catalog ? "stale" : "error");
      setCatalogError(message);
      addLog("error", "Failed to refresh provider catalog", message);
      return null;
    }
  }, [addLog, catalog]);




  const pollProviderLogin = useCallback(
    async (targetProviderId: string, providerLabel: string) => {
      for (let attempt = 0; attempt < 800; attempt += 1) {
        await waitForProviderLoginPoll();
        const state = await nativeProviderLoginPoll(targetProviderId);
        setProviderLoginState(state);
        if (state.complete) {
          const refreshed = await nativeProviderRefreshOmpCredentials(targetProviderId);
          setCatalog(refreshed);
          setShowLogin(false);
          setSetupRequired(null);
          setError(null);
          onShowToast?.("Provider connected", `${providerLabel} is now ready.`, "success");
          return;
        }
        if (state.error) {
          throw new Error(state.error);
        }
        if (state.status === "waiting_input" || state.status === "cancelled") {
          return;
        }
      }
      throw new Error("Provider sign-in timed out.");
    },
    [onShowToast],
  );

  const handleProviderLogin = useCallback(async () => {
    if (!managedProvider) return;
    setSavingCred(true);
    setLoginError(null);
    setProviderLoginInput("");
    try {
      const state = await nativeProviderLoginStart(managedProvider.id);
      setProviderLoginState(state);
      await pollProviderLogin(managedProvider.id, managedProvider.label);
    } catch (loginFailure) {
      const message = loginFailure instanceof Error ? loginFailure.message : String(loginFailure);
      setLoginError(message);
      onShowToast?.("Failed to connect", message, "error");
    } finally {
      setSavingCred(false);
    }
  }, [onShowToast, pollProviderLogin, managedProvider]);

  const submitProviderLoginInput = useCallback(async () => {
    if (!managedProvider || !providerLoginInput.trim()) return;
    setSavingCred(true);
    setLoginError(null);
    try {
      const state = await nativeProviderLoginSubmit(
        managedProvider.id,
        providerLoginInput.trim(),
      );
      setProviderLoginState(state);
      setProviderLoginInput("");
      await pollProviderLogin(managedProvider.id, managedProvider.label);
    } catch (loginFailure) {
      const message = loginFailure instanceof Error ? loginFailure.message : String(loginFailure);
      setLoginError(message);
      onShowToast?.("Failed to connect", message, "error");
    } finally {
      setSavingCred(false);
    }
  }, [onShowToast, pollProviderLogin, providerLoginInput, managedProvider]);

  const refreshFromOmp = useCallback(async () => {
    if (!managedProvider) return;
    setSavingCred(true);
    setLoginError(null);
    try {
      const refreshed = await nativeProviderRefreshOmpCredentials(managedProvider.id);
      setCatalog(refreshed);
      if (!refreshed.providers.some((provider) => provider.id === managedProvider.id && provider.configured)) {
        setLoginError(`No ${managedProvider.label} credential was found. Run /login in Oh My Pi, then try again.`);
        return;
      }
      setShowLogin(false);
      setManagedProviderId(null);
      setSetupRequired(null);
      setError(null);
      onShowToast?.("Provider connected", `${managedProvider.label} was imported from Oh My Pi.`, "success");
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setLoginError(message);
      onShowToast?.("Failed to refresh provider", message, "error");
    } finally {
      setSavingCred(false);
    }
  }, [onShowToast, managedProvider]);

  // Cancel the in-flight OAuth flow (backend worker thread stops polling and
  // the frontend poll loop exits on the "cancelled" status). Best-effort: a
  // missing session just means nothing was running.
  const cancelProviderLogin = useCallback(async () => {
    if (!managedProvider) return;
    try {
      const state = await nativeProviderLoginCancel(managedProvider.id);
      setProviderLoginState(state);
    } catch {
      // No active sign-in — nothing to cancel.
    }
  }, [managedProvider]);

  // Close the connect modal; abandons any in-flight sign-in. `backToCatalog`
  // reopens the provider & model catalog modal the user came from.
  const closeLoginModal = useCallback(
    (backToCatalog = false) => {
      if (providerLoginState && !providerLoginState.complete && providerLoginState.status !== "error") {
        void cancelProviderLogin();
      }
      setShowLogin(false);
      setManagedProviderId(null);
      setLoginError(null);
      if (backToCatalog) setShowProviderPicker(true);
    },
    [cancelProviderLogin, providerLoginState],
  );

  const [confirmLogoutProvider, setConfirmLogoutProvider] = useState<{ id: string; label: string } | null>(null);
  // Per-provider account list for the Manage modal. Refetched on open and
  // after any login/logout/test. accountRowsById is a lookup so usage rows
  // (which carry only accountId) can be labelled.
  const [accountRows, setAccountRows] = useState<ProviderAccount[]>([]);
  const [accountRowsLoading, setAccountRowsLoading] = useState(false);
  const [testingAccountId, setTestingAccountId] = useState<string | null>(null);
  const [accountUsage, setAccountUsage] = useState<ProviderAccountUsage[]>([]);
  const [accountUsageWindow, setAccountUsageWindow] = useState<number>(604800);
  const [accountUsageLoading, setAccountUsageLoading] = useState(false);
  // Manage-modal navigation + the API key entry sub-modal.
  const [manageTab, setManageTab] = useState<ManageTab>("accounts");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  const refreshAccountRows = useCallback(async (providerId: string) => {
    setAccountRowsLoading(true);
    try {
      const rows = await nativeProviderAccountsList(providerId);
      setAccountRows(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to load provider accounts", msg);
      setAccountRows([]);
    } finally {
      setAccountRowsLoading(false);
    }
  }, [addLog]);

  const refreshAccountUsage = useCallback(async (providerId: string, windowSecs: number) => {
    setAccountUsageLoading(true);
    try {
      const rows = await nativeProviderAccountUsage(providerId, windowSecs);
      setAccountUsage(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to load per-account usage", msg);
      setAccountUsage([]);
    } finally {
      setAccountUsageLoading(false);
    }
  }, [addLog]);

  // Refetch account rows + usage whenever the Manage modal opens (showLogin
  // true) or the managed provider changes while open.
  useEffect(() => {
    if (!showLogin || !managedProvider || managedProvider.id === LOCAL_PROVIDER_ID) return;
    void refreshAccountRows(managedProvider.id);
    void refreshAccountUsage(managedProvider.id, accountUsageWindow);
  }, [showLogin, managedProvider, refreshAccountRows, refreshAccountUsage, accountUsageWindow]);

  // Landing tab on open: accounts when any are attached, connect otherwise.
  // Keyed on the provider id (not the derived provider object) so catalog
  // refreshes while the modal is open never yank the user to another tab.
  useEffect(() => {
    if (!showLogin || !managedProviderId) return;
    const provider = catalog?.providers.find((p) => p.id === managedProviderId);
    setManageTab((provider?.accountCount ?? 0) > 0 ? "accounts" : "connect");
    setShowApiKeyModal(false);
    setApiKey("");
    setBaseUrl("");
  }, [showLogin, managedProviderId]);

  // Open the API key sub-modal with a clean slate; bespoke providers get the
  // suggested endpoint URL prefilled so "needs base URL" is a one-field fix.
  const openApiKeyModal = useCallback(() => {
    if (!managedProvider) return;
    setLoginError(null);
    setApiKey("");
    setBaseUrl(
      managedProvider.status === "transport_unavailable"
        ? (managedProvider.defaultBaseUrl ?? "")
        : "",
    );
    setShowApiKeyModal(true);
  }, [managedProvider]);

  // Provider-wide totals for the usage tab summary row.
  const usageTotals = useMemo(() => ({
    requests: accountUsage.reduce((n, r) => n + r.requests, 0),
    input: accountUsage.reduce((n, r) => n + r.inputTokens, 0),
    output: accountUsage.reduce((n, r) => n + r.outputTokens, 0),
    cost: accountUsage.reduce((n, r) => n + (r.costTotal ?? 0), 0),
  }), [accountUsage]);

  // Save the API key as a connected account. Keeps the Manage modal open and
  // lands on the Accounts tab so the new account is immediately visible.
  const handleSaveCredential = useCallback(async () => {
    const target = managedProviderId ?? providerId;
    if (!apiKey.trim() || !target) return;
    setSavingCred(true);
    try {
      const providerLabel = managedProvider?.label ?? target;
      await nativeSaveProviderCredential({
        providerId: target,
        label: providerLabel,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || null,
      });
      await refreshCatalog();
      await Promise.all([
        refreshAccountRows(target),
        refreshAccountUsage(target, accountUsageWindow),
      ]);
      setShowApiKeyModal(false);
      setManageTab("accounts");
      setSetupRequired(null);
      setApiKey("");
      setBaseUrl("");
      setError(null);
      setLoginError(null);
      onShowToast?.("Provider connected", `${providerLabel} is now ready.`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to save provider credential", msg);
      setLoginError(msg);
      onShowToast?.("Failed to connect", msg, "error");
    } finally {
      setSavingCred(false);
    }
  }, [apiKey, baseUrl, providerId, managedProviderId, managedProvider, accountUsageWindow, refreshCatalog, refreshAccountRows, refreshAccountUsage, addLog, onShowToast]);

  // Reset transient account state when the modal closes so a reopen starts fresh.
  useEffect(() => {
    if (showLogin) return;
    setAccountRows([]);
    setAccountUsage([]);
    setTestingAccountId(null);
  }, [showLogin]);
  const handleAccountLogout = useCallback(async (accountId: string, accountLabel: string) => {
    setConfirmLogoutProvider(null);
    try {
      await nativeProviderAccountLogout(accountId);
      if (managedProvider) {
        await Promise.all([
          refreshAccountRows(managedProvider.id),
          refreshAccountUsage(managedProvider.id, accountUsageWindow),
        ]);
      }
      await refreshCatalog();
      addLog("debug", "Account logged out", `account=${accountId}`);
      onShowToast?.("Logged out", `${accountLabel} removed from the local store.`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to log out of account", msg);
      onShowToast?.("Failed to log out", msg, "error");
    }
  }, [accountUsageWindow, addLog, onShowToast, refreshAccountRows, refreshAccountUsage, refreshCatalog, managedProvider]);

  const handleAccountTest = useCallback(async (account: ProviderAccount) => {
    setTestingAccountId(account.id);
    try {
      const updated = await nativeProviderAccountTest(account.id);
      setAccountRows((prev) => prev.map((row) => (row.id === account.id ? updated : row)));
      addLog("debug", "Account tested", `account=${account.id}; health=${updated.health}`);
      onShowToast?.(
        "Account tested",
        `${account.label}: ${updated.health === "healthy" ? "healthy" : (updated.lastError ?? updated.health)}`,
        updated.health === "healthy" ? "success" : "warning",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Account test failed", msg);
      onShowToast?.("Account test failed", msg, "error");
    } finally {
      setTestingAccountId(null);
    }
  }, [addLog, onShowToast]);

  // Provider-wide logout (used by the "Log out all" affordance when 2+
  // accounts are attached): removes every account row + the legacy slot.
  const handleProviderLogout = useCallback(async (targetId: string, targetLabel: string) => {
    setConfirmLogoutProvider(null);
    try {
      await nativeDeleteProviderCredential(targetId);
      await refreshCatalog();
      if (managedProvider) {
        await Promise.all([
          refreshAccountRows(managedProvider.id),
          refreshAccountUsage(managedProvider.id, accountUsageWindow),
        ]);
      }
      addLog("debug", "Provider logged out", `provider=${targetId}`);
      onShowToast?.("Logged out", `${targetLabel} credential removed from the local store.`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", "Failed to log out of provider", msg);
      onShowToast?.("Failed to log out", msg, "error");
    }
  }, [accountUsageWindow, addLog, onShowToast, refreshAccountRows, refreshAccountUsage, refreshCatalog, managedProvider]);

  const openApiKeyUrl = useCallback((url: string) => {
    return openUrl(url).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to open API key URL", msg);
      setLoginError(msg);
    });
  }, [addLog]);

  // Persist provider/model/effort to both the session record (so it survives
  // restart) and the project default (so new sessions inherit it). The session
  // update is best-effort — if it fails (e.g. session not yet created), the
  // project default still captures the selection.
  const persistSelection = useCallback(
    (nextProviderId: string, nextModelId: string, nextEffort: string) => {
      const next: ChatModelDefault = { providerId: nextProviderId, modelId: nextModelId, effortLevel: nextEffort };
      void nativeChatSetProjectModelDefault(projectPath, next);
      if (nativeSessionId) {
        void nativeChatUpdateSessionModel({
          sessionId: nativeSessionId,
          providerId: nextProviderId,
          modelId: nextModelId,
          effortLevel: nextEffort,
        }).catch((e) => {
          addLog("warn", "Failed to persist session model selection", e instanceof Error ? e.message : String(e));
        });
      }
    },
    [projectPath, nativeSessionId, addLog],
  );

  // Escape closes the topmost surface: the API key sub-modal when open,
  // otherwise the manage modal (abandoning any in-flight sign-in).
  useEscapeKey(showApiKeyModal, () => setShowApiKeyModal(false));
  useEscapeKey(showLogin && !showApiKeyModal, () => closeLoginModal());
  persistSelectionRef.current = persistSelection;

  const handleGenerateIdeas = useCallback(async (opts?: { categoryIds?: string[]; ideaCount?: number; direction?: string | null }) => {
    addLog("debug", "Idea generation requested", `chat=${nativeSessionId ?? "none"} planningSession=${activeSessionId ?? "none"}`);
    if (!nativeSessionId || generatingIdeas) {
      addLog("debug", "Idea generation skipped", !nativeSessionId ? "chat session unavailable" : "generation already running");
      return;
    }
    if (!activeSessionId) {
      addLog("debug", "Idea generation skipped", "planning session unavailable");
      setError("Open a project session to save generated ideas.");
      return;
    }
    // Guard: non-local provider without a credential can't generate — show
    // connect prompt instead of silently failing.
    if (selectedProvider && !selectedProvider.configured && selectedProvider.id !== LOCAL_PROVIDER_ID) {
      setSetupRequired({
        providerId: selectedProvider.id,
        providerLabel: selectedProvider.label,
        message: `Connect ${selectedProvider.label} to generate ideas.`,
      });
      setManagedProviderId(selectedProvider.id);
      setShowLogin(true);
      return;
    }

    const ideaCount = Math.min(8, Math.max(5, opts?.ideaCount ?? 8));
    const categoryIds = (opts?.categoryIds ?? []).filter(
      (id) => ideaState.categories.find((c) => c.id === id)?.sessionId === activeSessionId,
    );
    const direction = opts?.direction?.trim() ?? "";
    const categoryNames = categoryIds
      .map((id) => ideaState.categories.find((category) => category.id === id)?.name)
      .filter((name): name is string => !!name);
    const scope = categoryNames.length > 0 ? categoryNames.join(", ") : "project-wide";
    const invocationSummary = direction
      ? `${direction}\n\n${ideaCount} ideas · ${scope}`
      : `Auto-generate ${ideaCount} ${scope} ideas.`;
    const displayMessage = `<command name="/skill:basebuild-planning">\n${invocationSummary}\n</command>`;

    try {
      await Promise.all([chunkListenerReadyRef.current, toolListenerReadyRef.current]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addLog("error", "Idea activity listeners unavailable", message);
      setError("Chat activity streaming is unavailable. Reopen the chat and try again.");
      return;
    }
    setGeneratingIdeas(true);
    setError(null);
    setSetupRequired(null);
    // Render the compact skill invocation before starting provider work. The
    // persisted transcript replaces this optimistic row when the turn settles.
    const tempUser: NativeChatMessage = {
      id: `temp-idea-${Date.now()}`,
      sessionId: nativeSessionId,
      role: "user",
      content: displayMessage,
      sortOrder: Number.MAX_SAFE_INTEGER,
      providerId,
      modelId,
      effortLevel,
      createdAt: Math.floor(Date.now() / 1000),
    };
    setNativeMessages((current) => [...current, tempUser]);
    streamBufRef.current = "";
    reasoningBufRef.current = "";
    setStreamText("");
    setReasoningText("");
    setLiveSegments([]);
    setStalled(false);
    setLastToolEventTime(0);
    setLastToolKind("");
    lastToolEventTimeRef.current = 0;
    toolCallCharsRef.current = 0;
    setToolCallChars(0);
    setPendingToolName(null);
    lastDeltaAtRef.current = Date.now();
    setQuietSeconds(0);
    setStreaming(true);
    streamStartRef.current = Date.now();
    setElapsed(0);
    setStreamPhase("thinking");
    followLatestRef.current = true;
    // Claim this generation. A stop or a newer send bumps activeSendRef so
    // this generation's async resolution becomes a no-op instead of reviving
    // the spinner or duplicating the streamed reply.
    const gen = ++activeSendRef.current;
    try {
      const result = await nativeGenerateIdeas({
        sessionId: nativeSessionId,
        planningSessionId: activeSessionId,
        schematic: schematicContent ?? null,
        providerId,
        modelId,
        effortLevel,
        categoryIds,
        ideaCount,
        displayMessage,
        direction: direction || null,
      });
      if (activeSendRef.current !== gen) return;
      if (result.setupRequired) {
        setSetupRequired(result.setupRequired);
        setShowLogin(result.setupRequired.message.startsWith("Connect "));
      }
      setLastGrounding(result.grounding ?? null);
      await ideaState.refresh();
      // Reload the persisted compact invocation, assistant segments, and
      // expandable native-tool arguments.
      const [msgs, events] = await Promise.all([
        nativeChatMessages(nativeSessionId),
        nativeChatToolEvents(nativeSessionId),
      ]);
      if (activeSendRef.current !== gen) return;
      setNativeMessages(msgs);
      setToolEvents(events);
      setLiveSegments([]);
    } catch (e) {
      if (activeSendRef.current !== gen) return;
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to generate ideas", msg);
      setError(msg);
      // Reload whatever the backend persisted (the compact skill invocation
      // is saved before provider work begins).
      try {
        const [msgs, events] = await Promise.all([
          nativeChatMessages(nativeSessionId),
          nativeChatToolEvents(nativeSessionId),
        ]);
        if (activeSendRef.current !== gen) return;
        setNativeMessages(msgs);
        setToolEvents(events);
        setLiveSegments([]);
      } catch {
        /* ignore */
      }
    } finally {
      if (activeSendRef.current === gen) {
        setStreaming(false);
        setStreamText("");
        setReasoningText("");
        setStreamPhase("idle");
        streamStartRef.current = null;
        streamBufRef.current = "";
        reasoningBufRef.current = "";
        toolCallCharsRef.current = 0;
        setToolCallChars(0);
        setPendingToolName(null);
      }
      setGeneratingIdeas(false);
    }
  }, [nativeSessionId, generatingIdeas, activeSessionId, selectedProvider, ideaState, providerId, modelId, effortLevel, schematicContent, addLog]);
  generateIdeasRef.current = handleGenerateIdeas;

  const handleGenerateForCategory = useCallback(async (categoryId: string | undefined) => {
    if (!nativeSessionId || generatingIdeas) return;
    setShowCategoryPicker(false);
    void generateIdeasRef.current?.({ categoryIds: categoryId ? [categoryId] : [], ideaCount: 8 });
  }, [nativeSessionId, generatingIdeas]);


  const handlePromoteIdea = useCallback(
    async (idea: Idea) => {
      try {
        if (!onCreatePlanFromIdea) {
          throw new Error("Plan promotion is unavailable in this chat.");
        }
        await onCreatePlanFromIdea(idea, nativeSessionId);
        await ideaState.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to promote idea to plan", message);
        onShowToast?.("Could not prepare plan", message, "error");
        throw e;
      }
    },
    [onCreatePlanFromIdea, ideaState, addLog, nativeSessionId, onShowToast],
  );
  const handleRejectIdea = useCallback(
    async (idea: Idea) => {
      try {
        await ideaState.rejectIdea(idea.id);
        onShowToast?.("Idea passed", idea.title, "info");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        onShowToast?.("Could not reject idea", message, "error");
        throw e;
      }
    },
    [ideaState, onShowToast],
  );
  const handleDeferIdea = useCallback(
    async (idea: Idea) => {
      try {
        await ideaState.updateIdeaStatus(idea.id, "archived");
        onShowToast?.("Idea deferred", idea.title, "info");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        onShowToast?.("Could not defer idea", message, "error");
        throw e;
      }
    },
    [ideaState, onShowToast],
  );
  // Recovery for proposals whose original propose_ideas capture failed:
  // persist them into the planning session so decisions unlock. The batch
  // category is only forwarded when it still exists — a stale category id is
  // one of the ways the original capture can fail.
  const handleCaptureProposal = useCallback(
    async (proposal: ProposedIdea, categoryId: string | null) => {
      try {
        if (!activeSessionId) {
          throw new Error("Open a project session to save ideas.");
        }
        const validCategory = categoryId && ideaState.categories.some((cat) => cat.id === categoryId)
          ? categoryId
          : undefined;
        await createIdea(
          activeSessionId,
          proposal.title,
          proposal.description,
          validCategory,
          proposal.grounding,
          proposal.anchor,
        );
        await ideaState.refresh();
        onShowToast?.("Idea saved", proposal.title, "info");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to save proposal to ideas", message);
        onShowToast?.("Could not save idea", message, "error");
        throw e;
      }
    },
    [activeSessionId, ideaState, addLog, onShowToast],
  );
  // ── Chat header handlers ──
  const handleRename = useCallback((title: string) => {
    setTitleLocked(true);
    if (nativeSessionId) {
      setSessionTitle({ sessionId: nativeSessionId, title });
      void renameNativeChatSession(nativeSessionId, title);
    }
    onRenameChat?.(title);
  }, [onRenameChat, nativeSessionId]);

  const handleSwitchBranch = useCallback(async (name: string) => {
    if (!projectPath || !branch || name === branch) return;
    try {
      await gitBranchSwitch(projectPath, name);
      setBranch(name);
      const workspaces = await listWorkspaces(projectPath).catch(() => []);
      const match = workspaces.find((w) => w.branch === name);
      setWorktreePath(match?.path ?? null);
      onShowToast?.("Branch switched", `Now on ${name}`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to switch branch", msg);
      onShowToast?.("Failed to switch branch", msg, "error");
    }
  }, [projectPath, branch, addLog, onShowToast]);

  const handleCreateBranch = useCallback(async (name: string) => {
    if (!projectPath || !name) return;
    try {
      await gitBranchCreate(projectPath, name);
      await gitBranchSwitch(projectPath, name);
      setBranch(name);
      setBranches(await gitBranchList(projectPath).catch(() => []));
      onShowToast?.("Branch created", `Created and switched to ${name}`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to create branch", msg);
      onShowToast?.("Failed to create branch", msg, "error");
    }
  }, [projectPath, addLog, onShowToast]);

  const handleOpenAssignPlan = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const plans = await listPlans(activeSessionId);
      const ready = plans
        .filter((p) => p.status === "ready")
        .map((p) => ({ id: p.id, referenceId: p.referenceId, title: p.title, status: p.status }));
      setReadyPlans(ready);
      setShowAssignPlanPicker(true);
    } catch (e) {
      addLog("error", "Failed to list plans for assignment", e instanceof Error ? e.message : String(e));
    }
  }, [activeSessionId, addLog]);

  const handleAssignPlan = useCallback(async (planId: string) => {
    if (!planId || !nativeSessionId) return;
    setShowAssignPlanPicker(false);
    try {
      await assignPlanToChat(planId, nativeSessionId);
      setAssignedPlanId(planId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to assign plan to chat", msg);
      setError(msg);
    }
  }, [nativeSessionId, addLog]);

  const handleCreatePullRequest = useCallback(() => {
    setShowPrCard(true);
  }, []);

  const handleDismissPr = useCallback(() => {
    setShowPrCard(false);
  }, []);
  const renderMessages = nativeMode ? nativeMessages : legacyMessages;
  const bgGateActive = !!backgroundAgent && !bgInputUnlocked;
  const inputDisabled = bgGateActive || (nativeMode ? !nativeSessionId : agentId === null);
  // A native turn in flight still accepts input: the message is injected into
  // the running loop instead of queued behind it, so the send control stays
  // live. Only tools-capable routes run the agent loop; a plain streaming
  // route (OMP RPC, local coordinator) has no loop to join, so it still locks.
  const steerable =
    nativeMode && !!nativeSessionId && (loading || streaming) && (selectedModel?.supportsTools ?? false);
  const sendDisabled = bgGateActive || !input.trim() || (nativeMode ? !nativeSessionId : agentId === null) || (loading && !steerable);

  const modelName = selectedModel?.label ?? modelId;
  // Local providers surface real per-request generation stats after each turn.
  const isLocalProvider = providerId.startsWith("local-");
  // Routing badge next to the model: Basebuild's native transport vs the OMP
  // RPC bridge (OMP-imported credentials). Local + API-key providers are native.
  const routeVia: "native" | "omp" | null = !selectedProvider?.configured
    ? null
    : selectedProvider.connectedVia === "omp"
      ? "omp"
      : "native";
  useEffect(() => {
    if (!isLocalProvider || !nativeSessionId || streaming) {
      return;
    }
    let cancelled = false;
    void nativeSessionLatestMetric(nativeSessionId)
      .then((metric) => {
        if (cancelled) return;
        setGenStats(
          metric
            ? { tokensPerSecond: metric.tokensPerSecond, ttftMs: metric.ttftMs, durationMs: metric.durationMs }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setGenStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isLocalProvider, nativeSessionId, streaming, nativeMessages.length]);
  // Pending ask_user questions own the composer until resolved or explicitly
  // minimized. A minimized question becomes a compact preview; restoring it
  // returns to the same page and draft answers.
  const pendingInteractions = interactions.filter((i) => i.status === "pending");
  const activeQuestions = pendingInteractions.filter((i) => !minimizedQuestions.has(i.id));
  const minimizedPending = pendingInteractions.filter((i) => minimizedQuestions.has(i.id));
  const focusedIdeaEvent = focusedIdeaBatchId
    ? toolEvents.find((event) => event.id === focusedIdeaBatchId && event.kind === "propose_ideas")
    : undefined;
  let focusedIdeaBatch: { event: NativeToolEvent; batch: ParsedIdeaBatch } | null = null;
  if (focusedIdeaEvent?.arguments) {
    try {
      const batch = parseIdeaBatch(JSON.parse(focusedIdeaEvent.arguments));
      if (batch) focusedIdeaBatch = { event: focusedIdeaEvent, batch };
    } catch {
      focusedIdeaBatch = null;
    }
  }
  const latestIdeaToolId = [...toolEvents]
    .reverse()
    .find((event) => event.kind === "propose_ideas")
    ?.id ?? null;
  const minimizeQuestion = (id: string) => {
    addLog("debug", "Question minimized", id);
    setMinimizedQuestions((prev) => new Set(prev).add(id));
  };
  const restoreQuestion = (id: string) => {
    addLog("debug", "Question reopened", id);
    setMinimizedQuestions((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  return (
    <div className="chat-panel" ref={panelRef} tabIndex={-1} onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
    }}>
      <div aria-live="polite" aria-atomic="true" className="sr-only" >
        {streaming ? `Agent is responding${streamPhase === "tools" ? " — running tools" : streamPhase === "thinking" ? " — thinking" : ""}` : ""}
      </div>
      {showPrCard && prRec ? (
        <PrRecommendationCard
          projectPath={projectPath}
          recommendation={prRec}
          onDismiss={handleDismissPr}
        />
      ) : null}
      {showAssignPlanPicker ? (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setShowAssignPlanPicker(false)} title="Close plan picker">
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title="Assign a ready plan">
            <div className="modal-header">
              <h2>Assign plan</h2>
              <button className="btn-icon" type="button" title="Close plan picker" onClick={() => setShowAssignPlanPicker(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body stack">
              {readyPlans.length === 0 ? (
                <p className="text-muted text-sm">No ready plans.</p>
              ) : null}
              {readyPlans.map((p) => (
                <button
                  key={p.id}
                  className="btn"
                  type="button"
                  title={`Assign "${p.title}" (${p.referenceId}) to this chat`}
                  onClick={() => void handleAssignPlan(p.id)}
                >
                  <span>{p.title}</span>
                  <span className="text-muted text-sm plan-status-inline">{p.status}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
      {/* Pinned chat header — 28-32px, never scrolls out of view */}
      <ChatHeader
        runState={streaming ? "running" : loading ? "queued" : "idle"}
        contextUsed={contextUsedTokens}
        contextLimit={selectedModel?.contextWindow ?? null}
        onOpenCommands={() => {
          addLog("debug", "Command palette opened via header", `sessionId=${activeSessionId ?? "none"}`);
          setShowCommandPalette(true);
          setInput("/");
          window.requestAnimationFrame(() => chatInputRef.current?.focus());
        }}
        debugMode={debugMode}
        onToggleDebug={() => {
          const next = !debugMode;
          addLog("debug", "Chat debug mode toggled", `enabled=${next}`);
          setDebugMode(next);
          localStorage.setItem("basebuild.debug-mode", String(next));
        }}
        canCopyConversation={nativeMessages.length > 0}
        onCopyConversation={() => {
          addLog("debug", "Copy conversation selected", `sessionId=${nativeSessionId ?? "none"}`);
          void handleCopyConversation();
        }}
        agentMode={agentMode}
        onToggleAgentMode={() => setAgentMode((m) => (m === "build" ? "plan" : "build"))}
        planBadge={planBadge}
        onOpenPlan={() => { /* focus the plan in the side panel */ }}
        branch={branch}
        worktreePath={worktreePath}
        branches={branches}
        onSwitchBranch={handleSwitchBranch}
        onCreateBranch={handleCreateBranch}
        onToggleHistory={() => onOpenHistory?.()}
        onStashAndSwitch={handleSwitchBranch}
        onDiscardAndSwitch={handleSwitchBranch}
        uncommittedCount={uncommittedCount}
        onRenameAction={() => setRenameSignal((n) => n + 1)}
        onAssignPlan={handleOpenAssignPlan}
        onCloseChat={() => onCloseChat?.()}
        onCloseAndDelete={() => onCloseAndDeleteChat?.()}
        prRecommendation={prRec ? { branch: prRec.branch, ahead: prRec.ahead, behind: prRec.behind, changedFiles: prRec.changedFiles } : null}
        onCreatePullRequest={handleCreatePullRequest}
        projectPath={projectPath}
        sessionId={nativeSessionId}
        onCopySessionId={() => {
          if (nativeSessionId) {
            void navigator.clipboard.writeText(nativeSessionId);
            onShowToast?.("Chat ID copied", nativeSessionId, "info");
          }
        }}
        onStartVoiceCall={voice.support.mic && voiceReady ? () => {
          if (voice.callActive) endVoiceCall();
          else void startVoiceCall();
        } : null}
        voiceCallActive={voice.callActive}
      />
      {/* Messages area */}
      <ChatTranscript
        scrollRef={scrollRef}
        chatInputRef={chatInputRef}
        nativeMode={nativeMode}
        chatTimeline={chatTimeline}
        debugMode={debugMode}
        ideas={ideaState.ideas}
        catalog={catalog}
        selectedModel={selectedModel}
        modelId={modelId}
        providerId={providerId}
        streaming={streaming}
        loading={loading}
        hydrating={hydrating}
        renderMessages={renderMessages}
        reasoningText={reasoningText}
        streamText={streamText}
        streamPhase={streamPhase}
        phaseElapsed={phaseElapsed}
        elapsed={elapsed}
        toolCallChars={toolCallChars}
        pendingToolName={pendingToolName}
        quietSeconds={quietSeconds}
        toolEvents={toolEvents}
        stalled={stalled}
        toolAgoSeconds={toolAgoSeconds}
        lastToolKind={lastToolKind}
        interruptedRun={interruptedRun}
        stuck={stuck}
        interactions={interactions}
        minimizedIdeaBatchIdsRef={minimizedIdeaBatchIdsRef}
        handleResolveApproval={handleResolveApproval}
        handleSetApprovalMode={handleSetApprovalMode}
        setInteractions={setInteractions}
        setFocusedIdeaBatchId={setFocusedIdeaBatchId}
        setCommandPayloadModal={setCommandPayloadModal}
        setInput={setInput}
        handleCopyMessage={handleCopyMessage}
        handleRetryMessage={handleRetryMessage}
        handleEditAndResend={handleEditAndResend}
        handleStopNative={handleStopNative}
        handleStopAgent={handleStopAgent}
        sendMessage={sendMessage}
      />
      {/* Sticky approval bar — always visible above the composer whenever a
          tool call is awaiting approval, independent of scroll position or
          streaming state. The in-transcript card can scroll out of view when
          the model streamed text before the tool call; this bar guarantees
          the Allow/Deny actions are always reachable. */}
      {nativeMode ? (() => {
        const pending = toolEvents.filter((e) => e.status === "pending");
        if (pending.length === 0) return null;
        const names = pending.map((e) => e.kind.replace(/_/g, " ")).join(", ");
        const resolveAll = (decision: "allow" | "allow_session" | "deny") =>
          pending.forEach((e) => void handleResolveApproval(e.id, decision));
        return (
          <div className="chat-approval-bar" title={`Approval required: ${names}`}>
            <span className="chat-approval-bar-label">
              <span className="chat-approval-bar-icon" aria-hidden="true">🔐</span>
              Approve <strong>{names}</strong>?
            </span>
            <div className="chat-approval-bar-actions">
              <button className="btn btn-sm btn-primary" type="button" title="Allow this tool call once" onClick={() => resolveAll("allow")}>Allow Once</button>
              <button className="btn btn-sm" type="button" title="Allow all calls to this tool for this session" onClick={() => resolveAll("allow_session")}>Allow Session</button>
              <button className="btn btn-sm" type="button" title="Deny this tool call" onClick={() => resolveAll("deny")}>Deny</button>
              <button className="btn btn-sm chat-approval-bar-auto" type="button" title="Switch to Auto mode: allow all tool calls without asking. Change back in Settings." onClick={() => void handleSetApprovalMode("auto")}>Allow All (Auto)</button>
            </div>
          </div>
        );
      })() : null}
      {/* Pending-question previews remain beside the composer. Active questions
          replace the composer below; resolved/cancelled questions remain in
          transcript history. */}
      {nativeMode ? (
        <>
          {minimizedPending.map((intr) => (
            <button
              className="chat-question-preview"
              type="button"
              key={`preview-${intr.id}`}
              title="Reopen the agent's question"
              onClick={() => restoreQuestion(intr.id)}
            >
              <HelpCircle size={13} className="chat-question-preview-icon" />
              <span className="chat-question-preview-text">
                {intr.title ?? intr.questions[0]?.prompt ?? "Agent is asking a question"}
              </span>
              <span className="chat-question-preview-action">Answer</span>
            </button>
          ))}
        </>
      ) : null}
      {/* Scroll-to-bottom button */}
      {isScrolledUp ? (
        <button
          className="chat-scroll-bottom-btn"
          type="button"
          title="Scroll to bottom of conversation"
          onClick={scrollToBottom}
        >
          <ChevronDown size={16} />
        </button>
      ) : null}
      {/* In-conversation search bar */}
      {showSearch ? (
        <div className="chat-search-bar">
          <input
            className="chat-search-input"
            type="text"
            autoFocus
            placeholder="Search conversation…"
            value={searchQuery}
            onChange={(e) => {
              const q = e.target.value;
              setSearchQuery(q);
              if (!q) { setSearchMatchCount(0); setSearchActiveIndex(0); return; }
              const els = scrollRef.current?.querySelectorAll<HTMLElement>("mark.chat-search-highlight") ?? [];
              setSearchMatchCount(els.length);
              setSearchActiveIndex(0);
              if (els[0]) els[0].scrollIntoView({ block: "center" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSearch(false);
                setSearchQuery("");
                setSearchMatchCount(0);
                chatInputRef.current?.focus();
              } else if (e.key === "Enter") {
                e.preventDefault();
                const els = scrollRef.current?.querySelectorAll<HTMLElement>("mark.chat-search-highlight") ?? [];
                if (els.length === 0) return;
                const next = e.shiftKey
                  ? (searchActiveIndex - 1 + els.length) % els.length
                  : (searchActiveIndex + 1) % els.length;
                setSearchActiveIndex(next);
                els[next].scrollIntoView({ block: "center" });
              }
            }}
            title="Search messages and tool cards — Enter for next, Shift+Enter for prev, Escape to close"
          />
          <span className="chat-search-count" title="Match count">
            {searchMatchCount > 0 ? `${searchActiveIndex + 1}/${searchMatchCount}` : "0/0"}
          </span>
          <button className="chat-search-btn" type="button" title="Previous match (Shift+Enter)" onClick={() => {
            const els = scrollRef.current?.querySelectorAll<HTMLElement>("mark.chat-search-highlight") ?? [];
            if (els.length === 0) return;
            const prev = (searchActiveIndex - 1 + els.length) % els.length;
            setSearchActiveIndex(prev);
            els[prev].scrollIntoView({ block: "center" });
          }}>
            <ChevronUp size={12} />
          </button>
          <button className="chat-search-btn" type="button" title="Next match (Enter)" onClick={() => {
            const els = scrollRef.current?.querySelectorAll<HTMLElement>("mark.chat-search-highlight") ?? [];
            if (els.length === 0) return;
            const next = (searchActiveIndex + 1) % els.length;
            setSearchActiveIndex(next);
            els[next].scrollIntoView({ block: "center" });
          }}>
            <ChevronDown size={12} />
          </button>
          <button className="chat-search-btn" type="button" title="Close search (Escape)" onClick={() => {
            setShowSearch(false);
            setSearchQuery("");
            setSearchMatchCount(0);
            chatInputRef.current?.focus();
          }}>
            <X size={12} />
          </button>
        </div>
      ) : null}

      {/* Model default notice (unavailable default fell back) */}
      {nativeMode && modelNotice ? (
        <div className="chat-notice-bar" title={modelNotice}>
          <AlertCircle size={12} />
          <span className="text-sm">{modelNotice}</span>
          <button className="btn-icon btn-icon-sm" title="Dismiss" type="button" onClick={() => setModelNotice(null)}>
            <X size={11} />
          </button>
        </div>
      ) : null}

      {/* Error bar */}
      {error ? (
        <div className="chat-error-bar">
          <AlertCircle size={12} />
          <span className="text-sm">{error}</span>
          <button
            className="btn btn-sm"
            type="button"
            title="Retry creating the chat session"
            onClick={() => {
              setError(null);
              setNativeSessionId(null);
            }}
          >
            <RefreshCw size={12} /> Retry
          </button>
          <button className="btn-icon btn-icon-sm" title="Clear error" type="button" onClick={() => setError(null)}>
            <X size={11} />
          </button>
        </div>
      ) : null}

      {/* Setup-required bar (no credential for the chosen provider) */}
      {nativeMode && setupRequired && !showLogin ? (
        <div className="chat-setup-bar">
          <AlertCircle size={12} />
          <span className="text-sm">{setupRequired.message}</span>
          {selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID ? (
            <button
              className="btn btn-sm"
              type="button"
              title={`Log in to ${setupRequired.providerLabel}`}
              onClick={() => {
                setLoginError(null);
                setManagedProviderId(setupRequired.providerId);
                setShowLogin(true);
              }}
            >
              <Key size={11} /> Log in
            </button>
          ) : (
            <button
              className="btn-icon btn-icon-sm"
              type="button"
              title="Dismiss"
              onClick={() => setSetupRequired(null)}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ) : null}

      {/* Provider manage modal: tabbed — Accounts | Connect | Usage. The API
          key entry lives in its own sub-modal so the tabs stay scannable. */}
      {nativeMode && showLogin && managedProvider && managedProvider.id !== LOCAL_PROVIDER_ID ? (
        <ProviderManageModal
          managedProvider={managedProvider}
          catalog={catalog}
          needsEndpointUrl={needsEndpointUrl}
          manageTab={manageTab}
          accountRows={accountRows}
          accountRowsLoading={accountRowsLoading}
          testingAccountId={testingAccountId}
          savingCred={savingCred}
          providerLoginState={providerLoginState}
          providerLoginInput={providerLoginInput}
          accountUsageWindow={accountUsageWindow}
          accountUsageLoading={accountUsageLoading}
          accountUsage={accountUsage}
          usageTotals={usageTotals}
          loginError={loginError}
          showApiKeyModal={showApiKeyModal}
          apiKey={apiKey}
          baseUrl={baseUrl}
          closeLoginModal={closeLoginModal}
          setManageTab={setManageTab}
          openApiKeyModal={openApiKeyModal}
          handleAccountTest={handleAccountTest}
          setConfirmLogoutProvider={setConfirmLogoutProvider}
          handleProviderLogin={handleProviderLogin}
          cancelProviderLogin={cancelProviderLogin}
          setProviderLoginInput={setProviderLoginInput}
          submitProviderLoginInput={submitProviderLoginInput}
          openApiKeyUrl={openApiKeyUrl}
          refreshFromOmp={refreshFromOmp}
          setManagedProviderId={setManagedProviderId}
          setAccountUsageWindow={setAccountUsageWindow}
          setShowApiKeyModal={setShowApiKeyModal}
          setApiKey={setApiKey}
          setBaseUrl={setBaseUrl}
          handleSaveCredential={handleSaveCredential}
        />
      ) : null}

      {/* Log-out confirmation: per-account when an account id is passed,
          provider-wide (all accounts + legacy slot) when the provider id is
          passed (used by "Log out all"). Destructive in both cases. */}
      <ConfirmDialog
        open={confirmLogoutProvider !== null}
        title={`Log out of ${confirmLogoutProvider?.label ?? "provider"}?`}
        message={
          confirmLogoutProvider && managedProvider && confirmLogoutProvider.id === managedProvider.id
            ? `This removes every stored ${confirmLogoutProvider?.label ?? ""} credential from Basebuild's local credential store and blocks Oh My Pi re-import until the next explicit login. Chats using this provider will stop working until you log in again.`
            : `This removes the stored ${confirmLogoutProvider?.label ?? ""} credential from Basebuild's local credential store. Other accounts on this provider stay connected.`
        }
        confirmLabel="Log out"
        destructive
        onConfirm={() => {
          if (!confirmLogoutProvider || !managedProvider) return;
          if (confirmLogoutProvider.id === managedProvider.id) {
            void handleProviderLogout(confirmLogoutProvider.id, confirmLogoutProvider.label);
          } else {
            void handleAccountLogout(confirmLogoutProvider.id, confirmLogoutProvider.label);
          }
        }}
        onCancel={() => setConfirmLogoutProvider(null)}
      />

      {/* Command payload modal: shows the full injected skill/command body. */}
      {commandPayloadModal ? (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setCommandPayloadModal(null)} title="Close command payload">
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title={`${commandPayloadModal.name} payload`}>
            <div className="modal-header">
              <h2>{commandPayloadModal.name}</h2>
              <button
                className="btn-icon"
                title="Close"
                type="button"
                onClick={() => setCommandPayloadModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body command-payload-body" onClick={(e) => e.stopPropagation()} title="Full injected command payload">
              <pre className="command-payload-pre">{commandPayloadModal.content}</pre>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {/* Composer footer: always visible, never clipped */}
      <div className="chat-input-area">
        {nativeMode ? (
          <>
            {showPlanningMenu ? (
              <ModalPortal>
              <div className="modal-overlay" onClick={() => setShowPlanningMenu(false)} title="Close ideas menu">
                <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title="Idea actions">
                  <div className="modal-header">
                    <h2>Ideas</h2>
                    <button className="btn-icon" type="button" title="Close ideas menu" onClick={() => setShowPlanningMenu(false)}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="modal-body stack">
                    {schematicReport && schematicReport.health !== "complete" && (
                      <button
                        className="btn"
                        type="button"
                        title={`Schematic ${schematicReport.health}: incomplete sections may lead to ungrounded generation — click to open the schematic`}
                        onClick={() => {
                          setShowPlanningMenu(false);
                          onOpenSchematic?.();
                        }}
                      >
                        <AlertCircle size={11} />
                        <span>Schematic {schematicReport.health}</span>
                        <span className="text-muted text-sm">Fix</span>
                      </button>
                    )}
                    <button
                      className="btn"
                      type="button"
                      title="Quick freeform idea generation in the chat"
                      disabled={generatingIdeas || !nativeSessionId}
                      onClick={() => {
                        setShowPlanningMenu(false);
                        void handleGenerateIdeas();
                      }}
                    >
                      <Sparkles size={11} />
                      <span>Quick ideas</span>
                    </button>
                    <button
                      className="btn"
                      type="button"
                      title="Pick a category and generate ideas for it"
                      onClick={() => {
                        setShowPlanningMenu(false);
                        setShowCategoryPicker(true);
                      }}
                    >
                      <FolderTree size={11} />
                      <span>By category…</span>
                    </button>
                    <button
                      className="btn"
                      type="button"
                      title="Open the planning inspector"
                      onClick={() => {
                        setShowPlanningMenu(false);
                        onOpenPlanningInspector?.();
                      }}
                    >
                      <LayoutGrid size={11} />
                      <span>Planning inspector</span>
                    </button>
                  </div>
                </div>
              </div>
              </ModalPortal>
            ) : null}
            {showCategoryPicker ? (
              <ModalPortal>
              <div className="modal-overlay" onClick={() => setShowCategoryPicker(false)} title="Close category picker">
                <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title="Pick a category">
                  <div className="modal-header">
                    <h2>Pick a category</h2>
                    <button className="btn-icon" type="button" title="Close category picker" onClick={() => setShowCategoryPicker(false)}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="modal-body stack">
                    {sessionCategories.length === 0 ? (
                      <p className="text-muted text-sm">No categories yet.</p>
                    ) : null}
                    {sessionCategories.map((cat) => (
                      <button
                        key={cat.id}
                        className="btn"
                        type="button"
                        title={`Generate ideas for ${cat.name}`}
                        disabled={generatingIdeas}
                        onClick={() => void handleGenerateForCategory(cat.id)}
                      >
                        <span className="chat-picker-item-label">{cat.name}</span>
                        <span className="text-muted text-sm">{cat.description}</span>
                      </button>
                    ))}
                    <button
                      className="btn"
                      type="button"
                      title="Freeform generation (no category)"
                      disabled={generatingIdeas}
                      onClick={() => void handleGenerateForCategory(undefined)}
                    >
                      <span>Freeform</span>
                      <span className="text-muted text-sm">No specific category</span>
                    </button>
                  </div>
                </div>
              </div>
              </ModalPortal>
            ) : null}
            {(showProviderPicker || showModelPicker) ? (
              <ProviderCatalogModal
                catalog={catalog}
                catalogStatus={catalogStatus}
                catalogError={catalogError}
                connectedProviders={connectedProviders}
                providerFilter={providerFilter}
                setProviderFilter={setProviderFilter}
                visibleCatalogProviders={visibleCatalogProviders}
                providerId={providerId}
                setProviderId={setProviderId}
                setProviderRecency={setProviderRecency}
                modelId={modelId}
                setModelId={setModelId}
                setModelRecency={setModelRecency}
                modelFilter={modelFilter}
                setModelFilter={setModelFilter}
                selectedProvider={selectedProvider}
                filteredModels={filteredModels}
                modelRecency={modelRecency}
                effortLevel={effortLevel}
                persistSelection={persistSelection}
                setSetupRequired={setSetupRequired}
                setModelNotice={setModelNotice}
                setShowProviderPicker={setShowProviderPicker}
                setShowModelPicker={setShowModelPicker}
                setLoginError={setLoginError}
                setManagedProviderId={setManagedProviderId}
                setShowLogin={setShowLogin}
                refreshCatalog={refreshCatalog}
                addLog={addLog}
              />
            ) : null}
            {showVoiceSettings && voiceProfile ? (
              <VoiceSettingsModal
                profile={voiceProfile}
                catalog={catalog}
                onClose={() => setShowVoiceSettings(false)}
                onSave={(next) => {
                  addLog("debug", "Voice settings saved", `engine=${next.sttEngine} mode=${next.mode}`);
                  setVoiceProfile(next);
                  setShowVoiceSettings(false);
                  void voiceProfileSet(next)
                    .then((saved) => setVoiceProfile(saved))
                    .catch((err) => addLog("error", "Voice settings save failed", String(err)));
                }}
              />
            ) : null}
            {commandNotice ? (
              <div className="chat-command-notice">
                <span>{commandNotice}</span>
                {input.trim().startsWith("/") ? (
                  <button className="btn btn-sm" type="button" title="Send this slash-prefixed text as a normal message" onClick={() => void sendMessage(input.trim())}>
                    Send as text
                  </button>
                ) : null}
                <button className="btn-icon btn-icon-sm" type="button" title="Dismiss command notice" onClick={() => setCommandNotice(null)}>
                  <X size={11} />
                </button>
              </div>
            ) : null}
            {showCommandPalette && nativeMode ? (
              <CommandPalette
                input={input}
                open={showCommandPalette}
                recency={commandRecency}
                activeIndex={paletteActiveIndex}
                onActiveIndexChange={setPaletteActiveIndex}
                onPick={(text) => {
                  setInput(text);
                  setShowCommandPalette(false);
                }}
              />
            ) : null}
            {showClearConfirm ? (
              <ModalPortal>
              <div className="modal-overlay" onClick={() => setShowClearConfirm(false)} title="Cancel clear chat">
                <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title="Confirm clear chat">
                  <div className="modal-header">
                    <h2>Clear chat?</h2>
                    <button className="btn-icon" type="button" title="Cancel" onClick={() => setShowClearConfirm(false)}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="modal-body stack">
                    <p className="text-sm">This will delete all messages and tool events in this chat. The chat session and its provider/model/effort selection are preserved. This cannot be undone.</p>
                    <div className="row gap-sm">
                      <button
                        className="btn"
                        type="button"
                        title="Cancel and keep the chat as-is"
                        onClick={() => setShowClearConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        title="Delete all messages and tool events in this chat"
                        onClick={() => void handleClearChat()}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              </ModalPortal>
            ) : null}
          </>
        ) : null}
        {activeQuestions.length === 0 && !focusedIdeaBatch ? (
        <div className="chat-composer-box">
          {voice.callActive ? (
            <VoiceCallBar
              state={voice.state}
              level={voice.level}
              muted={voice.muted}
              error={voice.error}
              profile={voiceProfile}
              modelName={modelName}
              onToggleMute={voice.toggleMute}
              onEnd={endVoiceCall}
              onOpenSettings={() => setShowVoiceSettings(true)}
            />
          ) : null}
          {bgGateActive ? (
            <button
              className="chat-bg-agent-gate"
              type="button"
              title="Enable the chat input for this session — the background agent keeps running either way"
              onClick={() => setBgInputUnlocked(true)}
            >
              <Bot size={12} className="chat-bg-agent-gate-icon" />
              <span>
                A background agent is running. Click here to enable the chat input —
                interrupting may cause the background agent to fail its original task.
              </span>
            </button>
          ) : null}
          <div className="chat-composer-textarea-wrap">
            <textarea
              ref={chatInputRef}
              className="input chat-input"
              aria-label="Chat message input"
              placeholder={
                !nativeMode
                  ? "Agent not connected. Click retry above to start."
                  : steerable
                    ? "Steer the agent while it works… (Enter to send)"
                    : "Type a message… (Enter to send, Shift+Enter for newline)"
              }
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                if (nativeMode && val.trimStart().startsWith("/")) {
                  setShowCommandPalette(true);
                } else if (showCommandPalette) {
                  setShowCommandPalette(false);
                }
                setPaletteActiveIndex(0);
                const el = e.target;
                el.style.setProperty("--chat-input-height", "auto");
                el.style.setProperty("--chat-input-height", `${Math.min(el.scrollHeight, 360)}px`);
                // Typing manually exits history browsing.
                historyIndexRef.current = -1;
                savedDraftRef.current = "";
              }}
              onKeyDown={(e) => {
                if (showCommandPalette && nativeMode) {
                  const query = input.trim().slice(1);
                  const ranked = filterAndRank(BUILTIN_COMMANDS, query, commandRecency);
                  if (e.key === "ArrowDown" && ranked.length > 0) {
                    e.preventDefault();
                    setPaletteActiveIndex((i) => (i + 1) % ranked.length);
                    return;
                  }
                  if (e.key === "ArrowUp" && ranked.length > 0) {
                    e.preventDefault();
                    setPaletteActiveIndex((i) => (i - 1 + ranked.length) % ranked.length);
                    return;
                  }
                  if (e.key === "Tab" && ranked.length > 0) {
                    e.preventDefault();
                    const cmd = ranked[paletteActiveIndex];
                    if (cmd) {
                      setInput(tabComplete(cmd));
                      setShowCommandPalette(false);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setShowCommandPalette(false);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && ranked.length > 0) {
                    e.preventDefault();
                    void handleSend();
                    return;
                  }
                }
                // ─── Terminal-style input history (ArrowUp/ArrowDown) ───
                // ArrowUp recalls older messages when the input is empty or
                // already browsing history. If the user has typed text and
                // isn't browsing, ArrowUp does nothing (lets cursor move up
                // in multi-line text). ArrowDown moves forward through
                // history; past the newest entry restores the saved draft.
                if (!showCommandPalette && nativeMode && userHistory.length > 0) {
                  if (e.key === "ArrowUp" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    const ta = e.currentTarget;
                    const atFirstLine = ta.selectionStart === 0 && ta.selectionEnd === 0;
                    const browsing = historyIndexRef.current >= 0;
                    const inputEmpty = input.length === 0;
                    if ((atFirstLine || browsing) && (inputEmpty || browsing)) {
                      e.preventDefault();
                      if (!browsing) {
                        savedDraftRef.current = input;
                        historyIndexRef.current = 0;
                      } else if (historyIndexRef.current < userHistory.length - 1) {
                        historyIndexRef.current += 1;
                      }
                      const entry = userHistory[historyIndexRef.current];
                      if (entry !== undefined) {
                        setInput(entry);
                        requestAnimationFrame(() => {
                          if (chatInputRef.current) {
                            chatInputRef.current.selectionStart = chatInputRef.current.value.length;
                            chatInputRef.current.selectionEnd = chatInputRef.current.value.length;
                            const el = chatInputRef.current;
                            el.style.setProperty("--chat-input-height", "auto");
                            el.style.setProperty("--chat-input-height", `${Math.min(el.scrollHeight, 360)}px`);
                          }
                        });
                      }
                      return;
                    }
                  }
                  if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    const ta = e.currentTarget;
                    const valueLen = ta.value.length;
                    const atLastLine = ta.selectionStart === valueLen && ta.selectionEnd === valueLen;
                    const browsing = historyIndexRef.current >= 0;
                    if (browsing && atLastLine) {
                      e.preventDefault();
                      if (historyIndexRef.current > 0) {
                        historyIndexRef.current -= 1;
                        const entry = userHistory[historyIndexRef.current];
                        if (entry !== undefined) {
                          setInput(entry);
                          requestAnimationFrame(() => {
                            if (chatInputRef.current) {
                              chatInputRef.current.selectionStart = chatInputRef.current.value.length;
                              chatInputRef.current.selectionEnd = chatInputRef.current.value.length;
                              const el = chatInputRef.current;
                              el.style.setProperty("--chat-input-height", "auto");
                              el.style.setProperty("--chat-input-height", `${Math.min(el.scrollHeight, 360)}px`);
                            }
                          });
                        }
                      } else {
                        // Past the newest entry — restore saved draft.
                        historyIndexRef.current = -1;
                        setInput(savedDraftRef.current);
                        savedDraftRef.current = "";
                        requestAnimationFrame(() => {
                          if (chatInputRef.current) {
                            chatInputRef.current.selectionStart = chatInputRef.current.value.length;
                            chatInputRef.current.selectionEnd = chatInputRef.current.value.length;
                            const el = chatInputRef.current;
                            el.style.setProperty("--chat-input-height", "auto");
                            el.style.setProperty("--chat-input-height", `${Math.min(el.scrollHeight, 360)}px`);
                          }
                        });
                      }
                      return;
                    }
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  historyIndexRef.current = -1;
                  savedDraftRef.current = "";
                  void handleSend();
                }
              }}
              rows={2}
              disabled={inputDisabled}
              title={!nativeMode ? "Chat input: start the agent to enable sending" : steerable ? "Chat input: the agent is working, press Enter to steer it mid-turn" : "Chat input: type a message and press Enter to send"}
            />
          </div>
          <div className="chat-composer-controls">
            {nativeMode ? (
              <div className="chat-composer-controls-left">
                <ChatComposerControls
                  modelChip={modelName}
                  modelId={modelId}
                  modelCatalogStatus={catalogStatus}
                  modelCatalogError={catalogError}
                  onPickModel={() => {
                    addLog("debug", "Provider catalog modal opened", `sessionId=${activeSessionId ?? "none"}; focus=models`);
                    setShowModelPicker(true);
                    setShowProviderPicker(false);
                  }}
                  effortChip={effortLevel}
                  effortOptions={(catalog?.effortLevels ?? [])
                    .filter((effort) => selectedModel?.supportedEfforts.includes(effort.id) ?? false)
                    .map((effort) => ({ id: effort.id, label: effort.label }))}
                  onChangeEffort={(effort) => {
                    addLog("debug", "Chat effort selected", `sessionId=${nativeSessionId ?? "none"}; effort=${effort}`);
                    setEffortLevel(effort);
                    persistSelection(providerId, modelId, effort);
                  }}
                  permissionMode={approvalMode}
                  onChangePermission={(mode) => void handleSetApprovalMode(mode)}
                />
                {routeVia ? (
                  <span
                    className={`chat-route-badge is-${routeVia}`}
                    title={
                      routeVia === "omp"
                        ? "This chat routes through the Oh My Pi (OMP) RPC bridge — some Basebuild tools may be unavailable."
                        : "This chat uses Basebuild's native transport (first-party) — full tool support."
                    }
                  >
                    {routeVia === "omp" ? "OMP" : "Native"}
                  </span>
                ) : null}
                {isLocalProvider && genStats ? (
                  <span className="chat-gen-stats" title="Local generation stats from the last completed turn">
                    <span className="chat-gen-stats-label">Local</span>
                    {genStats.tokensPerSecond != null ? <span>{genStats.tokensPerSecond.toFixed(1)} tok/s</span> : null}
                    {genStats.ttftMs != null ? <span>{genStats.ttftMs} ms TTFT</span> : null}
                    {genStats.durationMs != null ? <span>{(genStats.durationMs / 1000).toFixed(1)}s</span> : null}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="chat-composer-controls-right">
              {nativeMode && loading ? (
                <button
                  className="btn chat-send-btn chat-stop-btn"
                  type="button"
                  title="Stop the agent and unlock the composer"
                  onClick={() => void handleStopNative()}
                >
                  <Square size={13} />
                </button>
              ) : null}
              {voice.support.mic ? (
                <>
                  <button
                    className={`btn chat-send-btn chat-voice-btn${voice.state === "capturing" && !voice.callActive ? " is-capturing" : ""}`}
                    type="button"
                    title={
                      voiceReady
                        ? "Push to talk: hold and speak, release to send"
                        : "Start a chat session before dictating"
                    }
                    disabled={!voiceReady || voice.callActive}
                    onPointerDown={() => void voice.beginPushToTalk()}
                    onPointerUp={() => voice.endPushToTalk()}
                    onPointerLeave={() => voice.endPushToTalk()}
                  >
                    <Mic size={14} />
                  </button>
                  <button
                    className={`btn chat-send-btn chat-call-btn${voice.callActive ? " is-active" : ""}`}
                    type="button"
                    title={
                      voice.callActive
                        ? "Hang up the voice call"
                        : "Start a voice call: continuous listening, hands free, talk over the agent to interrupt"
                    }
                    disabled={!voiceReady}
                    onClick={() => {
                      if (voice.callActive) endVoiceCall();
                      else void startVoiceCall();
                    }}
                  >
                    {voice.callActive ? <PhoneOff size={14} /> : <Phone size={14} />}
                  </button>
                </>
              ) : null}
              <button
                className="btn btn-primary chat-send-btn"
                type="button"
                title={steerable ? "Steer the running agent: your message is injected into the turn in progress" : "Send message"}
                disabled={sendDisabled}
                onClick={() => void handleSend()}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
        ) : (
          <div className="chat-interaction-workbench-slot">
            {activeQuestions.length > 0 ? activeQuestions.map((interaction) => (
              <InteractionWorkbench
                key={interaction.id}
                interaction={interaction}
                onMinimize={() => minimizeQuestion(interaction.id)}
                onResolved={(resolved) => setInteractions((current) => current.map((item) => item.id === resolved.id ? resolved : item))}
                onCancelled={(id) => setInteractions((current) => current.map((item) => item.id === id ? { ...item, status: "cancelled" } : item))}
                onAction={(action, detail) => addLog(action.endsWith("failed") ? "error" : "debug", action, detail)}
                onDraftChange={(answers, currentPage) => setInteractions((current) => current.map((item) => item.id === interaction.id ? { ...item, draftAnswers: answers, currentPage } : item))}
              />
            )) : focusedIdeaBatch ? (
              <IdeaReviewWorkbench
                {...focusedIdeaBatch.batch}
                toolId={focusedIdeaBatch.event.id}
                status={focusedIdeaBatch.event.status}
                ideas={ideaState.ideas}
                projectPath={projectPath}
                currentIndex={ideaReviewIndexes[focusedIdeaBatch.event.id] ?? 0}
                showContinue={focusedIdeaBatch.event.id === latestIdeaToolId}
                onCurrentIndexChange={(index) => setIdeaReviewIndexes((current) => ({ ...current, [focusedIdeaBatch.event.id]: index }))}
                onMinimize={() => {
                  minimizedIdeaBatchIdsRef.current.add(focusedIdeaBatch.event.id);
                  setFocusedIdeaBatchId(null);
                  addLog("debug", "Idea review minimized", focusedIdeaBatch.event.id);
                }}
                onPromote={handlePromoteIdea}
                onReject={handleRejectIdea}
                onDefer={handleDeferIdea}
                onCapture={handleCaptureProposal}
                onContinue={(categoryId) => {
                  minimizedIdeaBatchIdsRef.current.add(focusedIdeaBatch.event.id);
                  setFocusedIdeaBatchId(null);
                  void generateIdeasRef.current?.({
                    categoryIds: categoryId ? [categoryId] : [],
                    ideaCount: 8,
                    direction: "Find more grounded, distinct improvements. Avoid semantic duplicates and explain each estimate.",
                  });
                }}
                onReviewed={() => {
                  minimizedIdeaBatchIdsRef.current.add(focusedIdeaBatch.event.id);
                  setFocusedIdeaBatchId(null);
                  addLog("debug", "Idea batch review completed", focusedIdeaBatch.event.id);
                }}
              />
            ) : null}
          </div>
        )}
        {debugMode ? (
          <div className="chat-debug-panel" title="Raw event stream from the model and agent loop">
            <button
              type="button"
              className="chat-debug-panel-toggle"
              title={debugExpanded ? "Collapse debug event stream" : "Expand debug event stream"}
              onClick={() => setDebugExpanded(!debugExpanded)}
            >
              {debugExpanded ? "▼" : "▶"} Debug Event Stream ({debugEvents.length})
            </button>
            {debugExpanded ? (
              <div className="chat-debug-panel-body">
                {/* Session info row with copy button */}
                <div className="chat-debug-session-info" title="Current chat session id — click to copy">
                  <span className="chat-debug-session-label">session</span>
                  <code className="chat-debug-session-id">{nativeSessionId ?? "none"}</code>
                  <button
                    type="button"
                    className="btn-icon btn-icon-sm chat-debug-copy-btn"
                    title="Copy session id"
                    onClick={() => void navigator.clipboard.writeText(nativeSessionId ?? "")}
                  >
                    <Copy size={10} />
                  </button>
                </div>
                {debugEvents.length === 0 ? (
                  <div className="chat-debug-empty text-muted text-sm">No events yet. Send a message to see raw event data.</div>
                ) : (
                  <div className="chat-debug-event-list">
                    {debugEvents.slice(-100).map((e, i) => (
                      <div key={i} className="chat-debug-event">
                        <div className="chat-debug-event-header">
                          <span className="chat-debug-event-ts">{new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}</span>
                          <span className="chat-debug-event-channel">{e.channel}</span>
                          <button
                            type="button"
                            className="btn-icon btn-icon-sm chat-debug-copy-btn"
                            title="Copy this event"
                            onClick={() => void navigator.clipboard.writeText(
                              typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2),
                            )}
                          >
                            <Copy size={9} />
                          </button>
                        </div>
                        <pre className="chat-debug-event-data">{typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                )}
                <div className="chat-debug-actions">
                  <button
                    type="button"
                    className="btn btn-sm chat-debug-copy-all"
                    title="Copy all debug events to clipboard"
                    disabled={debugEvents.length === 0}
                    onClick={() => {
                      const text = debugEvents.map((e) =>
                        `[${new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}] ${e.channel}\n${
                          typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)
                        }`,
                      ).join("\n\n");
                      void navigator.clipboard.writeText(text);
                    }}
                  >
                    <Copy size={10} /> Copy All
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm chat-debug-clear"
                    title="Clear debug event log"
                    onClick={() => setDebugEvents([])}
                  >Clear</button>
                </div>
              </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
  );
}

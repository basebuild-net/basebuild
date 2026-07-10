import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePromptDelivery } from "../../lib/promptDelivery";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { markStart, markEnd } from "../../lib/timing";
import { ChatComposerRail } from "./ChatComposerRail";
import { ChatContextStrip } from "./ChatContextStrip";
import { CommandPalette } from "./CommandPalette";
import {
  BUILTIN_COMMANDS,
  buildCommandHelper,
  filterAndRank,
  tabComplete,
  formatCommandReference,
  KEYBOARD_GUIDE,
  readCommandRecency,
  recordCommandUse,
  sourceLabel,
} from "../../lib/chatCommands";
import { ChatHeader } from "./ChatHeader";
import { PrRecommendationCard } from "./PrRecommendationCard";
import { QuestionCard } from "./QuestionCard";
import { MarkdownView } from "./MarkdownView";
import {
  AlertCircle,
  BarChart3,
  Brain,
  Bug,
  Copy,
  Edit2,
  FolderTree,
  Key,
  LayoutGrid,
  Lightbulb,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Unplug,
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
  nativeChatCancel,
  nativeChatClearMessages,
  nativeChatGet,
  nativeChatMessages,
  nativeChatModelDefault,
  nativeChatSend,
  nativeChatSetProjectModelDefault,
  nativeChatUpdateSessionModel,
  nativeChatStart,
  nativeChatToolEvents,
  nativeDeleteProviderCredential,
  nativeGenerateIdeas,
  nativeProviderCatalog,
  nativeProviderCatalogRefresh,
  nativeProviderLoginCancel,
  nativeProviderLoginPoll,
  nativeProviderLoginStart,
  nativeRequestMetricsSummary,
  nativeSaveProviderCredential,
  type ChatModelDefault,
  type NativeChatMessage,
  type NativeProviderCatalog,
  type NativeRequestMetricsSummary,
  type NativeSetupRequired,
  type NativeToolEvent,
} from "../../lib/native-chat";
import { resolveToolApproval } from "../../lib/native-chat";
import { useIdeaState } from "../../state/ideas";
import type { Idea } from "../../lib/ideas";
import { inspectProjectSchematic, type SchematicReport } from "../../lib/schematic";
import { schematicWizardAction } from "../../lib/planningActions";
import { readSkill } from "../../lib/skills";
import type { AgentMode } from "../../lib/sessions";
import { useLogs } from "../../state/log";

const SEND_TIMEOUT_MS = 45_000;
const NATIVE_PROFILE_ID = "basebuild-native";
const LOCAL_PROVIDER_ID = "basebuild-local";
const LOGIN_POLL_MS = 1500;

type LegacyChatMessage = { role: "user" | "assistant" | "system"; content: string };

/**
 * Detect enumerated quick-reply options in a completed assistant message.
 * Conservative: only matches `^[A-H][).:\s]\s` patterns or explicit
 * "reply with X/Y" phrasing. Skips content inside code fences. Returns
 * at most 8 option labels.
 */
function detectProseQuickReplies(content: string): string[] {
  // Strip code fences so we don't match code blocks.
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  const lines = stripped.split("\n");
  const options: string[] = [];
  const optionPattern = /^([A-H])[)\.:]\s+(.+)/;
  for (const line of lines) {
    const m = line.match(optionPattern);
    if (m) {
      const label = `${m[1]}. ${m[2].trim()}`;
      if (label.length <= 80 && !options.includes(label)) {
        options.push(label);
      }
    }
    if (options.length >= 8) break;
  }
  // Also check for "reply with X/Y/Z" phrasing.
  if (options.length === 0) {
    const replyMatch = stripped.match(/reply with\s+([A-Za-z0-9 ]+(?:\/[A-Za-z0-9 ]+)+)/i);
    if (replyMatch) {
      const parts = replyMatch[1].split("/").map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.length <= 40 && !options.includes(part)) options.push(part);
      }
    }
  }
  return options;
}

type ChatPanelProps = {
  projectPath: string;
  chatSessionId?: string | null;
  onChatSessionCreated?: (id: string) => void;
  /** Project session id — used to persist generated ideas and seed plans. */
  activeSessionId?: string | null;
  /** Project schematic content, sent to the provider for idea generation. */
  schematicContent?: string | null;
  /** Promote a generated idea into the plan pipeline (owned by AppShell). */
  onCreatePlanFromIdea?: (title: string, description: string, chatSessionId: string | null) => Promise<void> | void;
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
  /** Duplicate this chat panel beside the current one. */
  onDuplicateChat?: () => void;
  /** Start a fresh empty chat for the current project (keeps the previous chat). */
  onNewChat?: () => void;
  /** Show a toast notification (success/warning/error/info). */
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
};

function formatMetric(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="chat-thinking-block" title="Model thinking — click to expand">
      <button
        className="chat-thinking-toggle"
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain size={11} />
        {expanded ? "▼" : "▶"} Thinking…
      </button>
      {expanded ? (
        <MarkdownView text={text} className="chat-thinking-content" />
      ) : null}
    </div>
  );
}

// Module-level expansion state for tool cards. Keyed by tool event id,
// survives re-renders during streaming so a card the user expanded stays
// expanded as the event updates from pending → running → success.
const toolCardExpanded = new Map<string, boolean>();

function ToolEventCard({ event, onResolveApproval, debugMode, onSetApprovalMode }: { event: NativeToolEvent; onResolveApproval?: (decision: "allow" | "allow_session" | "deny") => void; debugMode?: boolean; onSetApprovalMode?: (mode: "safe" | "balanced" | "auto") => void; }) {
  const [expanded, setExpanded] = useState(() => toolCardExpanded.get(event.id) ?? false);
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      toolCardExpanded.set(event.id, next);
      return next;
    });
  }, [event.id]);

  const isRunning = event.status === "running" || event.status === "pending";
  const isError = event.status === "error" || event.status === "denied";
  const isApproval = event.status === "pending";
  const isCommand = event.kind === "run_command" || event.kind === "command";
  const isEdit = event.kind === "edit_file" || event.kind === "write_file";
  const isMetrics = event.kind === "request_metrics";
  const icon = isApproval ? "🔐" : isCommand ? "▶" : isEdit ? "✎" : isMetrics ? "📊" : "🔧";
  const statusClass = isRunning ? "running" : isError ? "error" : event.status === "success" || event.status === "recorded" || event.status === "allow" ? "success" : "info";
  const showExpanded = expanded || isApproval || event.status === "running";

  // Prefer the structured diff field from the backend; fall back to
  // parsing the summary for legacy events that predate the diff column.
  const hasDiff = isEdit && (event.diff != null || /^\+|-/m.test(event.summary));
  const diffText = event.diff ?? (hasDiff ? event.summary : "");
  const diffLines = diffText.split("\n").filter((l) => l.length > 0);

  const timeStr = event.createdAt
    ? new Date(event.createdAt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  // Parse arguments for structured display.
  const parsedArgs = (() => {
    if (!event.arguments) return null;
    try {
      return JSON.parse(event.arguments);
    } catch {
      return null;
    }
  })();

  // Extract key fields from parsed args depending on tool kind.
  const argDisplay = (() => {
    if (!parsedArgs) return null;
    if (isCommand) {
      const cmd = typeof parsedArgs === "object" && parsedArgs !== null && "command" in parsedArgs
        ? String(parsedArgs.command)
        : null;
      return cmd ? { label: "Command", value: cmd } : null;
    }
    if (isEdit) {
      const path = typeof parsedArgs === "object" && parsedArgs !== null && "path" in parsedArgs
        ? String(parsedArgs.path)
        : null;
      return path ? { label: "File", value: path } : null;
    }
    // Generic: look for common fields.
    if (typeof parsedArgs === "object" && parsedArgs !== null) {
      for (const key of ["path", "file", "filePath", "directory", "dir", "pattern", "query", "url", "command"]) {
        if (key in parsedArgs) {
          return { label: key.charAt(0).toUpperCase() + key.slice(1), value: String(parsedArgs[key]) };
        }
      }
    }
    return null;
  })();

  // Approval provenance: how was this tool call decided?
  const provenance = (() => {
    if (!event.decision) return null;
    const dec = event.decision;
    if (dec === "approved") {
      return event.ruleSource ? `Allowed by rule: ${event.ruleSource}` : "Allowed by user";
    }
    if (dec === "denied") {
      return event.ruleSource ? `Denied by rule: ${event.ruleSource}` : "Denied by user";
    }
    if (dec === "auto") return "Auto-approved (session mode)";
    if (dec === "pending") return "Approval pending";
    return dec;
  })();

  return (
    <div className={`tool-card tool-card-${statusClass}${isApproval ? " tool-card-approval" : ""}`} title={`${event.kind}: ${event.status}${timeStr ? ` at ${timeStr}` : ""}${provenance ? ` — ${provenance}` : ""}`}>
      <div className="tool-card-header" onClick={() => { if (!isApproval) toggleExpanded(); }} role={isApproval ? undefined : "button"} tabIndex={isApproval ? -1 : 0}>
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-name">{event.kind.replace(/_/g, " ")}</span>
        {argDisplay ? <code className="tool-card-arg-value" title={`${argDisplay.label}: ${argDisplay.value}`}>{argDisplay.value}</code> : null}
        <span className={`tool-card-status tool-card-status-${statusClass}`}>{event.status}</span>
        {timeStr ? <span className="tool-card-time text-muted">{timeStr}</span> : null}
        {!isApproval ? <span className="tool-card-expand">{expanded ? "▼" : "▶"}</span> : null}
      </div>
      {showExpanded ? (
        <div className="tool-card-body">
          {argDisplay ? (
            <div className="tool-card-arg-detail" title={`${argDisplay.label} passed to this tool`}>
              <span className="tool-card-arg-label">{argDisplay.label}:</span>
              <code className="tool-card-arg-code">{argDisplay.value}</code>
            </div>
          ) : null}
          {parsedArgs ? (
            <div className="tool-card-args-full" title="Full arguments JSON">
              <span className="tool-card-arg-label">Full args:</span>
              <pre className="tool-card-args-json">{JSON.stringify(parsedArgs, null, 2)}</pre>
            </div>
          ) : null}
          {hasDiff ? (
            <pre className="tool-card-diff" title="Unified line diff (added/removed lines)">
              {diffLines.map((line, i) => (
                <span key={i} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : "diff-ctx"}>{line}{"\n"}</span>
              ))}
            </pre>
          ) : !isApproval ? (
            <pre className="tool-card-summary">{event.summary}</pre>
          ) : null}
          {provenance ? (
            <div className="tool-card-provenance text-muted text-sm" title={`Decision: ${event.decision}${event.ruleSource ? ` — rule: ${event.ruleSource}` : ""}`}>
              {provenance}
            </div>
          ) : null}
          {debugMode ? (
            <div className="tool-card-debug" title="Raw event data (debug mode)">
              <span className="tool-card-debug-label">Debug:</span>
              <pre className="tool-card-debug-data">{JSON.stringify(event, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {!showExpanded && event.summary ? (
        <div className="tool-card-summary-truncated text-muted text-sm">{event.summary.slice(0, 120)}{event.summary.length > 120 ? "…" : ""}</div>
      ) : null}
      {isApproval && isRunning && onResolveApproval ? (
        <div className="tool-card-actions tool-card-approval-actions">
          <button className="btn btn-sm btn-primary" title="Allow this tool call once" type="button" onClick={() => onResolveApproval("allow")}>Allow Once</button>
          <button className="btn btn-sm" title="Allow all calls to this tool for this session" type="button" onClick={() => onResolveApproval("allow_session")}>Allow Session</button>
          <button className="btn btn-sm" title="Deny this tool call" type="button" onClick={() => onResolveApproval("deny")}>Deny</button>
          {onSetApprovalMode ? (
            <button className="btn btn-sm tool-card-allow-all" title="Switch to Auto mode: allow all tool calls without asking. You can change this back in Settings." type="button" onClick={() => onSetApprovalMode("auto")}>Allow All (Auto)</button>
          ) : null}
        </div>
      ) : null}
      {isApproval && isRunning && !onResolveApproval ? (
        <div className="tool-card-actions text-muted text-sm" title="Approval resolution is not available for this event">
          <span>Approval pending — waiting for resolution</span>
        </div>
      ) : null}
    </div>
  );
}
export function ChatPanel({
  projectPath,
  chatSessionId,
  onChatSessionCreated,
  activeSessionId,
  schematicContent,
  onCreatePlanFromIdea,
  onOpenPlanningInspector,
  onOpenSchematic,
  chatTitle,
  onRenameChat,
  onCloseChat,
  onCloseAndDeleteChat,
  onDuplicateChat,
  onNewChat,
  onShowToast,
}: ChatPanelProps) {
  const [profileId, setProfileId] = useState(NATIVE_PROFILE_ID);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [metrics, setMetrics] = useState<NativeRequestMetricsSummary | null>(null);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
  const [nativeMessages, setNativeMessages] = useState<NativeChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<NativeToolEvent[]>([]);
  const [interactions, setInteractions] = useState<PendingInteraction[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<LegacyChatMessage[]>([]);
  const [providerId, setProviderId] = useState(LOCAL_PROVIDER_ID);
  const [modelId, setModelId] = useState("basebuild-local-coordinator");
  const [effortLevel, setEffortLevel] = useState("medium");
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem("basebuild.debug-mode") === "true");
  const [debugEvents, setDebugEvents] = useState<Array<{ ts: number; channel: string; data: unknown }>>([]);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [setupRequired, setSetupRequired] = useState<NativeSetupRequired | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("balanced");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streamPhase, setStreamPhase] = useState<"idle" | "thinking" | "streaming" | "tools">("idle");
  const [elapsed, setElapsed] = useState(0);
  const streamStartRef = useRef<number | null>(null);
  const streamBufRef = useRef("");
  const reasoningBufRef = useRef("");
  // Monotonic id for the in-flight native send. Bumped on stop or on a new
  // send so a superseded send's async resolution can't revive the spinner
  // or duplicate messages.
  const activeSendRef = useRef(0);
  const firstActivityRef = useRef(true);
  // Provider connection UI.
  const [showLogin, setShowLogin] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [loginPolling, setLoginPolling] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginTimerRef = useRef<number | null>(null);
  // Idea generation.
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [showPlanningMenu, setShowPlanningMenu] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [schematicReport, setSchematicReport] = useState<SchematicReport | null>(null);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandRecency, setCommandRecency] = useState<Record<string, number>>(() => readCommandRecency());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  useEscapeKey(showProviderPicker || showModelPicker, () => {
    setShowProviderPicker(false);
    setShowModelPicker(false);
  });
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
  const [assignedPlanId, setAssignedPlanId] = useState<string | null>(null);
  const [planBadge, setPlanBadge] = useState<{ referenceId: string; title: string; status: string } | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>("plan");
  const [titleLocked, setTitleLocked] = useState(false);
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
  const ideaState = useIdeaState(activeSessionId ?? null);

  const filteredModels = useMemo(() => {
    const models = catalog?.models.filter((m) => m.providerId === providerId) ?? [];
    const needle = modelFilter.trim().toLowerCase();
    const ranked = models.slice().sort((a, b) =>
      Number(b.supportsTools) - Number(a.supportsTools) ||
      Number(b.supportsReasoning) - Number(a.supportsReasoning) ||
      a.label.localeCompare(b.label),
    );
    if (!needle) return ranked;
    return ranked.filter((model) => {
      const provider = catalog?.providers.find((p) => p.id === model.providerId);
      return (
        model.id.toLowerCase().includes(needle) ||
        model.label.toLowerCase().includes(needle) ||
        model.providerId.toLowerCase().includes(needle) ||
        (provider?.label.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [catalog, modelFilter, providerId]);
  const nativeMode = profileId === NATIVE_PROFILE_ID;
  const selectedProvider = catalog?.providers.find((p) => p.id === providerId) ?? null;
  const selectedModel = catalog?.models.find((m) => m.id === modelId && m.providerId === providerId) ?? null;
  const orderedProviders = useMemo(() => {
    if (!catalog) return [];
    return catalog.providers.slice().sort((a, b) =>
      Number(b.configured) - Number(a.configured) ||
      Number(b.id === providerId) - Number(a.id === providerId) ||
      a.label.localeCompare(b.label),
    );
  }, [catalog, providerId]);
  const connectedProviders = orderedProviders.filter((provider) => provider.configured);
  const availableProviders = orderedProviders.filter((provider) => !provider.configured);
  const availableModels = useMemo(
    () => catalog?.models.filter((m) => m.providerId === providerId) ?? [],
    [catalog, providerId],
  );
  // A non-local provider without a credential is a degraded active adapter.
  const providerDegraded = !!(selectedProvider && !selectedProvider.configured);

  // Load config on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        markStart("provider-model-restore");
        addLog("debug", "Chat config loading", `projectPath=${projectPath}`);
        const [defaults, cat, met, resolved, storedSession, mode] = await Promise.all([
          getRuntimeDefaults(),
          nativeProviderCatalog(),
          nativeRequestMetricsSummary(),
          nativeChatModelDefault(projectPath),
          nativeSessionId ? nativeChatGet(nativeSessionId) : Promise.resolve(null),
          getApprovalMode(projectPath).catch(() => "balanced" as ApprovalMode),
        ]);
        setProfileId(defaults.defaultChatProfileId ?? NATIVE_PROFILE_ID);
        setApprovalMode(mode);
        setCatalog(cat);
        setMetrics(met);
        const effectiveProviderId = storedSession?.providerId ?? resolved.providerId;
        const effectiveModelId = storedSession?.modelId ?? resolved.modelId;
        const effectiveEffortLevel = storedSession?.effortLevel ?? resolved.effortLevel;
        setProviderId(effectiveProviderId);
        setModelId(effectiveModelId);
        setEffortLevel(effectiveEffortLevel);
        setModelNotice(storedSession ? null : resolved.notice);
        addLog("debug", "Chat config loaded", `source=${storedSession ? "session" : resolved.source} provider=${effectiveProviderId} model=${effectiveModelId} models=${cat.models.length}`);
        markEnd("provider-model-restore");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to load chat config", msg);
        setError(msg);
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
  }, [chatSessionId]);

  // Native mode: load or create session. Times out after 15s so the panel
  // never hangs forever in "initializing" — the user sees an actionable
  // error and can retry or close the panel.
  useEffect(() => {
    if (!nativeMode || !catalog) return;
    let cancelled = false;
    let timer: number | undefined;
    async function loadOrCreate() {
      try {
        if (nativeSessionId) {
          addLog("debug", "Chat session loading", `Loading messages for ${nativeSessionId}`);
          const [msgs, events, intrs] = await Promise.all([
            nativeChatMessages(nativeSessionId),
            nativeChatToolEvents(nativeSessionId),
            nativeInteractionListAll(nativeSessionId),
          ]);
          if (cancelled) return;
          setNativeMessages(msgs);
          setToolEvents(events);
          setInteractions(intrs);
          addLog("debug", "Chat session loaded", `${nativeSessionId}: ${msgs.length} messages`);
          return;
        }
        addLog("debug", "Chat session creating", `projectPath=${projectPath} provider=${providerId} model=${modelId}`);
        const session = await Promise.race([
          nativeChatStart({
            projectPath,
            title: "Native Chat",
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
      }
    }
    void loadOrCreate();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [nativeMode, catalog, nativeSessionId, projectPath, providerId, modelId, effortLevel, addLog]);

  // Native mode: listen for streamed assistant chunks for this session
  useEffect(() => {
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
          if (phase === "thinking" || phase === "next") {
            // Starting a new provider stream — clear previous iteration's
            // text so each iteration gets a fresh streaming block.
            streamBufRef.current = "";
            reasoningBufRef.current = "";
            setStreamText("");
            setReasoningText("");
            setStreamPhase("thinking");
          } else if (phase === "tools") {
            setStreamPhase("tools");
          }
          return;
        }
        // Tool-call argument fragments are raw JSON — don't pollute the
        // content stream. They render as tool cards via the tool-event
        // channel instead.
        if (channel === "tool_call") return;
        if (channel === "reasoning") {
          reasoningBufRef.current += event.payload.delta;
          setReasoningText(reasoningBufRef.current);
          setStreamPhase((prev) => prev === "thinking" ? "streaming" : prev);
          return;
        }
        streamBufRef.current += event.payload.delta;
        setStreamText(streamBufRef.current);
        setStreamPhase("streaming");
      },
    );
    return () => {
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
      if (firstActivityRef.current) {
        firstActivityRef.current = false;
        markEnd("first-activity-event");
      }
      const id = event.payload.toolCallId ?? `te-${Date.now()}-${Math.random()}`;
      const args = event.payload.arguments ?? null;
      const diff = event.payload.diff ?? null;
      const decision = event.payload.decision ?? null;
      const ruleSource = event.payload.ruleSource ?? null;
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
          sequence: prev.length + 1,
          createdAt: Math.floor(Date.now() / 1000),
        }];
      });
    });
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
          sequence: prev.length + 1,
          createdAt: Math.floor(Date.now() / 1000),
        }];
      });
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
          setShowLogin(true);
          return;
        }
        setInput("");
        setError(null);
        setSetupRequired(null);
        setLoading(true);
        setStuck(false);
        streamBufRef.current = "";
        reasoningBufRef.current = "";
        setStreamText("");
        setReasoningText("");
        setStreaming(true);
        streamStartRef.current = Date.now();
        setElapsed(0);
        setStreamPhase("thinking");
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
        try {
          const result = await nativeChatSend({ sessionId: nativeSessionId, content: text, providerId, modelId, effortLevel });
          if (activeSendRef.current !== gen) return;
          setNativeMessages((prev) => {
            const base = prev.filter((m) => m.id !== tempUserId);
            const next = [...base, result.userMessage];
            if (result.assistantMessage) next.push(result.assistantMessage);
            return next;
          });
          // Reload tool events from the result
          if (result.toolEvents.length > 0 && nativeSessionId) {
            setToolEvents(await nativeChatToolEvents(nativeSessionId));
          }
          if (result.setupRequired) {
            setSetupRequired(result.setupRequired);
            setShowLogin(true);
          }
          setMetrics(await nativeRequestMetricsSummary());
        } catch (e) {
          if (activeSendRef.current !== gen) return;
          const msg = e instanceof Error ? e.message : String(e);
          addLog("error", "Failed to send native message", msg);
          try {
            setNativeMessages(await nativeChatMessages(nativeSessionId));
            setToolEvents(await nativeChatToolEvents(nativeSessionId));
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
            setLoading(false);
          } else if (activeSendRef.current === gen + 1 && nativeSessionId) {
            // Stopped by the user, no newer send yet — reflect whatever the
            // backend persisted (partial reply + tool events) without touching
            // the spinner state (handleStopNative already reset it).
            try {
              const msgs = await nativeChatMessages(nativeSessionId);
              const events = await nativeChatToolEvents(nativeSessionId);
              if (activeSendRef.current === gen + 1) {
                setNativeMessages(msgs);
                setToolEvents(events);
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
    [nativeMode, nativeSessionId, selectedProvider, loading, providerId, modelId, effortLevel, agentId, addLog],
  );

  // Prompt delivery consumption — replaces the old draft-prompt props.
  // The shell queues a delivery via `deliverPrompt({ chatSessionId, text,
  // mode })`; this hook surfaces it when our native session is ready.
  // insert → set composer text + focus (no send); send → one user turn,
  // composer left empty. Tool-incapable model + wizard prompt → insert +
  // inline notice (no send).
  const { delivery, consume } = usePromptDelivery(nativeSessionId);
  useEffect(() => {
    if (!delivery || !nativeSessionId) return;
    if (delivery.mode === "insert") {
      setInput(delivery.text);
      consume();
      return;
    }
    // send mode — wait for catalog so the resolved provider/model is used.
    if (!catalog || loading) return;
    void sendMessage(delivery.text.trim()).then(() => consume());
  }, [delivery, consume, nativeSessionId, catalog, loading, sendMessage]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [nativeMessages, legacyMessages, streamText, reasoningText, streamPhase]);

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

  // Clear stuck timer
  useEffect(() => {
    if (!loading && sendTimerRef.current) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, [loading]);

  // Cleanup login poll timer on unmount
  useEffect(() => {
    return () => {
      if (loginTimerRef.current) window.clearTimeout(loginTimerRef.current);
    };
  }, []);
  // Ref to hold the latest handleStopNative so handleSend can call it
  // without a TDZ issue (handleStopNative is defined after handleSend).
  const stopNativeRef = useRef<() => Promise<void>>(async () => {});
  const persistSelectionRef = useRef<(providerId: string, modelId: string, effort: string) => void>(() => {});
  // Ref to handleGenerateIdeas so /idea generate can call it without a TDZ
  // issue (handleGenerateIdeas is defined after handleSend).
  const generateIdeasRef = useRef<(() => Promise<void>) | null>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    addLog("debug", "Chat send", `text=${text.slice(0, 80)} nativeMode=${nativeMode} session=${nativeSessionId ?? "none"}`);
    if (!text) return;
    // Composer answer routing: if there's a pending text/free-text question,
    // capture the next send as the answer (unless escaped with /send).
    const pendingInteraction = interactions.find((i) => i.status === "pending");
    if (nativeMode && pendingInteraction) {
      const textQuestion = pendingInteraction.questions.find(
        (q) => q.kind === "text" || (q.kind === "options" && q.allowFreeText),
      );
      if (textQuestion) {
        // /send escape: send as a normal message instead of answering.
        if (text.startsWith("/send ")) {
          setInput(text.slice(6));
          return;
        }
        // Route the text as the answer.
        try {
          const answers = pendingInteraction.questions.map((q) => ({
            questionId: q.id,
            selected: q.kind === "text" || (q.kind === "options" && q.allowFreeText)
              ? undefined
              : [],
            text: q.id === textQuestion.id ? text : undefined,
          }));
          const resolved = await nativeInteractionResolve(pendingInteraction.id, answers);
          setInteractions((prev) => prev.map((i) => i.id === resolved.id ? resolved : i));
          setInput("");
        } catch (e) {
          addLog("error", "Failed to submit answer", e instanceof Error ? e.message : String(e));
        }
        return;
      }
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
            setProviderId(provider.id);
            setShowLogin(provider.id !== LOCAL_PROVIDER_ID);
            setShowProviderPicker(false);
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
          if (onNewChat) {
            onNewChat();
            setCommandNotice("Starting a new chat…");
          } else {
            setCommandNotice("New chat is not available in this context.");
          }
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
        setCatalogRefreshing(true);
        try {
          const refreshed = await nativeProviderCatalogRefresh({ force: true });
          setCatalog(refreshed);
          setCommandNotice("Model catalog refreshed.");
          setCommandRecency(recordCommandUse("models refresh"));
          setInput("");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setCommandNotice(`Model refresh failed: ${msg}`);
          addLog("error", "Failed to refresh model catalog", msg);
        } finally {
          setCatalogRefreshing(false);
        }
        return;
      }

      // /skill:<name> — inject skill content into the chat.
      if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        if (skillName) {
          try {
            const skill = await readSkill(skillName);
            const prompt = `${skill.content}\n\n${rest}`;
            await sendMessage(prompt);
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
            await sendMessage(action.text);
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
  }, [input, nativeMode, sendMessage, catalog, addLog, interactions, nativeMessages, toolEvents, loading, streaming, onNewChat, effortLevel, modelId, onOpenSchematic, projectPath, selectedModel]);

  // Message action rail handlers.
  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      onShowToast?.("Copied to clipboard", "Message source copied.", "success");
    } catch {
      onShowToast?.("Copy failed", "Clipboard unavailable.", "error");
    }
  }, [onShowToast]);

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
  // and immediately free the composer so the user can send again.
  const handleStopNative = useCallback(async () => {
    if (!nativeSessionId) return;
    // Bump the generation first so the in-flight send()'s finally treats this
    // as a user stop (gen + 1) and reloads persisted partial output.
    activeSendRef.current += 1;
    setStreaming(false);
        streamStartRef.current = null;
        setElapsed(0);
    setStreamText("");
    setReasoningText("");
    setStreamPhase("idle");
    streamBufRef.current = "";
    reasoningBufRef.current = "";
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

  const refreshCatalog = useCallback(async (force = false, targetProviderId?: string) => {
    setCatalogRefreshing(true);
    try {
      const refreshed = force
        ? await nativeProviderCatalogRefresh({ providerId: targetProviderId ?? null, force: true })
        : await nativeProviderCatalog();
      setCatalog(refreshed);
      return refreshed;
    } catch (e) {
      addLog("error", "Failed to refresh provider catalog", e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setCatalogRefreshing(false);
    }
  }, [addLog]);

  const handleSaveCredential = useCallback(async () => {
    if (!apiKey.trim() || !providerId) return;
    setSavingCred(true);
    try {
      const providerLabel = selectedProvider?.label ?? providerId;
      await nativeSaveProviderCredential({
        providerId,
        label: providerLabel,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || null,
      });
      await refreshCatalog();
      setShowLogin(false);
      setSetupRequired(null);
      setApiKey("");
      setBaseUrl("");
      setError(null);
      onShowToast?.("Provider connected", `${selectedProvider?.label ?? providerId} is now ready.`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to save provider credential", msg);
      setLoginError(msg);
      onShowToast?.("Failed to connect", msg, "error");
    } finally {
      setSavingCred(false);
    }
  }, [apiKey, baseUrl, providerId, selectedProvider, refreshCatalog, addLog, onShowToast]);

  const stopLoginPoll = useCallback(() => {
    if (loginTimerRef.current) {
      window.clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
    setLoginPolling(false);
  }, []);

  const startWebLogin = useCallback(async () => {
    if (!selectedProvider) return;
    setLoginError(null);
    setLoginPolling(true);
    const pid = selectedProvider.id;
    const poll = async () => {
      try {
        const res = await nativeProviderLoginPoll(pid);
        if (res.status === "pending") {
          loginTimerRef.current = window.setTimeout(() => void poll(), LOGIN_POLL_MS);
        } else if (res.status === "success") {
          stopLoginPoll();
          await refreshCatalog();
          setShowLogin(false);
          setSetupRequired(null);
          setError(null);
        } else {
          setLoginError(res.message ?? "Provider login did not complete.");
          stopLoginPoll();
        }
      } catch (e) {
        setLoginError(e instanceof Error ? e.message : String(e));
        stopLoginPoll();
      }
    };
    try {
      await nativeProviderLoginStart(pid);
      loginTimerRef.current = window.setTimeout(() => void poll(), LOGIN_POLL_MS);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e));
      stopLoginPoll();
    }
  }, [selectedProvider, refreshCatalog, stopLoginPoll]);

  const cancelWebLogin = useCallback(() => {
    if (selectedProvider) void nativeProviderLoginCancel(selectedProvider.id);
    stopLoginPoll();
  }, [selectedProvider, stopLoginPoll]);

  const openApiKeyUrl = useCallback((url: string) => {
    return openUrl(url).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to open API key URL", msg);
      setLoginError(msg);
    });
  }, [addLog]);
  const handleDisconnect = useCallback(async () => {
    if (!selectedProvider) return;
    try {
      await nativeDeleteProviderCredential(selectedProvider.id);
      await refreshCatalog();
      onShowToast?.("Provider disconnected", `${selectedProvider.label} credential removed.`, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to disconnect provider", msg);
      onShowToast?.("Failed to disconnect", msg, "error");
    }
  }, [selectedProvider, refreshCatalog, addLog, onShowToast]);

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
  persistSelectionRef.current = persistSelection;

  const handleGenerateIdeas = useCallback(async () => {
    if (!nativeSessionId || generatingIdeas) return;
    setGeneratingIdeas(true);
    setError(null);
    try {
      const result = await nativeGenerateIdeas({
        sessionId: nativeSessionId,
        schematic: schematicContent ?? null,
        providerId,
        modelId,
        effortLevel,
      });
      if (result.setupRequired) {
        setSetupRequired(result.setupRequired);
        // Only the login form applies to a specific non-local provider; for the
        // local coordinator, show the setup bar prompting to pick a provider.
        setShowLogin(!!selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID);
      }
      // The unified backend captures ideas via the propose_ideas tool during
      // the chat turn. Some code paths (and tests) still return ideas
      // directly in the result — create them locally if the backend didn't.
      if (result.ideas && result.ideas.length > 0 && activeSessionId) {
        for (const idea of result.ideas) {
          try {
            await ideaState.createIdea(idea.title, idea.description ?? "", undefined);
          } catch {
            // ignore duplicate or creation errors
          }
        }
      } else if (activeSessionId) {
        await ideaState.refresh();
      } else {
        setError("Open a project session to save generated ideas.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to generate ideas", msg);
      setError(msg);
    } finally {
      setGeneratingIdeas(false);
    }
  }, [nativeSessionId, generatingIdeas, schematicContent, providerId, modelId, effortLevel, activeSessionId, ideaState, addLog, selectedProvider]);
  useEffect(() => {
    generateIdeasRef.current = handleGenerateIdeas;
  }, [handleGenerateIdeas]);

  const handleGenerateForCategory = useCallback(async (categoryId: string | undefined) => {
    if (!nativeSessionId || generatingIdeas) return;
    setShowCategoryPicker(false);
    setGeneratingIdeas(true);
    setError(null);
    try {
      const result = await nativeGenerateIdeas({
        sessionId: nativeSessionId,
        schematic: schematicContent ?? undefined,
        providerId,
        modelId,
        effortLevel,
        categoryId: categoryId ?? null,
      });
      if (result.setupRequired) {
        setSetupRequired(result.setupRequired);
        setShowLogin(!!selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID);
        return;
      }
      await ideaState.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to generate ideas for category", msg);
      setError(msg);
    } finally {
      setGeneratingIdeas(false);
    }
  }, [nativeSessionId, generatingIdeas, schematicContent, providerId, modelId, effortLevel, ideaState, addLog, selectedProvider]);


  const handlePromoteIdea = useCallback(
    async (idea: Idea) => {
      try {
        await onCreatePlanFromIdea?.(idea.title, idea.description, nativeSessionId);
        await ideaState.updateIdeaStatus(idea.id, "picked");
      } catch (e) {
        addLog("error", "Failed to promote idea to plan", e instanceof Error ? e.message : String(e));
      }
    },
    [onCreatePlanFromIdea, ideaState, addLog, nativeSessionId],
  );
  // ── Chat header handlers ──
  const handleRename = useCallback((title: string) => {
    setTitleLocked(true);
    onRenameChat?.(title);
  }, [onRenameChat]);

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
  const inputDisabled = nativeMode ? !nativeSessionId : agentId === null;
  const sendDisabled = loading || !input.trim() || (nativeMode ? !nativeSessionId : agentId === null);

  const providerName = selectedProvider?.label ?? providerId;
  const modelName = selectedModel?.label ?? modelId;

  return (
    <div className="chat-panel" ref={panelRef}>
      <ChatHeader
        title={chatTitle ?? (nativeSessionId ? "Chat" : "New chat")}
        onRename={handleRename}
        titleLocked={titleLocked}
        modelChip={modelName}
        modelId={modelId}
        effortChip={effortLevel}
        agentMode={agentMode}
        onToggleAgentMode={() => setAgentMode((m) => (m === "build" ? "plan" : "build"))}
        planBadge={planBadge}
        onOpenPlan={() => { /* focus the plan in the side panel */ }}
        branch={branch}
        worktreePath={worktreePath}
        branches={branches}
        onSwitchBranch={handleSwitchBranch}
        onCreateBranch={handleCreateBranch}
        uncommittedCount={uncommittedCount}
        onStashAndSwitch={handleSwitchBranch}
        onDiscardAndSwitch={handleSwitchBranch}
        onToggleHistory={() => { /* history toggle */ }}
        onRenameAction={() => { /* handled by header internally */ }}
        onAssignPlan={handleOpenAssignPlan}
        onDuplicateChat={() => onDuplicateChat?.()}
        onCloseChat={() => onCloseChat?.()}
        onCloseAndDelete={() => onCloseAndDeleteChat?.()}
        prRecommendation={prRec ? { branch: prRec.branch, ahead: prRec.ahead, behind: prRec.behind, changedFiles: prRec.changedFiles } : null}
        onCreatePullRequest={handleCreatePullRequest}
        projectPath={projectPath}
        sessionId={nativeSessionId}
      />
      {showPrCard && prRec ? (
        <PrRecommendationCard
          projectPath={projectPath}
          recommendation={prRec}
          onDismiss={handleDismissPr}
        />
      ) : null}
      {showAssignPlanPicker ? (
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
                  title={`Assign ${p.referenceId}: ${p.title}`}
                  onClick={() => void handleAssignPlan(p.id)}
                >
                  <span>#{p.referenceId} {p.title}</span>
                  <span className="text-muted text-sm plan-status-inline">{p.status}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {/* Messages area */}
      <div className="chat-messages" ref={scrollRef}>
        {nativeMode && metrics ? (
          <div className="chat-metrics" title="Local request metrics">
            <BarChart3 size={11} />
            <span>{metrics.totalRequests} req</span>
            <span>{metrics.totalInputTokens + metrics.totalOutputTokens} tok</span>
            <span>{formatMetric(metrics.avgTokensPerSecond, " tok/s")}</span>
            <span>TTFT {formatMetric(metrics.avgTtftMs, "ms")}</span>
            <span>TTLT {formatMetric(metrics.avgTtltMs, "ms")}</span>
          </div>
        ) : null}
        {nativeMode
          ? (() => {
              // Flat chronological timeline: merge messages + tool events +
              // reasoning into a single sorted list, rendered in order.
              // No grouping — each tool call is its own row. Thinking blocks
              // render as separate rows, split around tool calls/questions.
              type ChatEvent =
                | { kind: "user" | "assistant" | "system"; id: string; content: string; reasoning: string | null; createdAt: number | null; providerId: string | null; index: number }
                | { kind: "tool"; id: string; event: NativeToolEvent; createdAt: number | null; index: number }
                | { kind: "interaction"; id: string; interaction: PendingInteraction; createdAt: number | null; index: number };

              // Build the merged event list.
              const events: ChatEvent[] = [];
              for (let i = 0; i < renderMessages.length; i++) {
                const msg = renderMessages[i];
                const msgId = "id" in msg ? String(msg.id) : null;
                const ts = "createdAt" in msg ? (msg as NativeChatMessage).createdAt : null;
                const reasoning = "reasoning" in msg ? (msg as NativeChatMessage).reasoning ?? null : null;
                const providerId = "providerId" in msg ? (msg as NativeChatMessage).providerId ?? null : null;
                events.push({
                  kind: msg.role as "user" | "assistant" | "system",
                  id: msgId ?? `legacy-${i}`,
                  content: msg.content,
                  reasoning,
                  createdAt: ts,
                  providerId,
                  index: i,
                });
                // Attach tool events with this messageId right after the message.
                if (msgId) {
                  for (const te of toolEvents) {
                    if (te.messageId === msgId) {
                      events.push({
                        kind: "tool",
                        id: te.id,
                        event: te,
                        createdAt: ts,
                        index: i + 0.5,
                      });
                    }
                  }
                }
              }
              // Live tool events (null messageId) go at the end.
              for (const te of toolEvents) {
                if (!te.messageId) {
                  events.push({
                    kind: "tool",
                    id: te.id,
                    event: te,
                    createdAt: null,
                    index: events.length,
                  });
                }
              }
              // Live interactions go at the end (no messageId binding yet).
              for (const intr of interactions) {
                events.push({
                  kind: "interaction",
                  id: intr.id,
                  interaction: intr,
                  createdAt: intr.createdAt ?? null,
                  index: events.length,
                });
              }
              // Sort by (createdAt, index) — stable chronological order.
              events.sort((a, b) => {
                const ta = a.createdAt ?? 0;
                const tb = b.createdAt ?? 0;
                if (ta !== tb) return ta - tb;
                return a.index - b.index;
              });
              // Compute last user/assistant message IDs for action rail.
              let lastUserId: string | null = null;
              let lastAssistantId: string | null = null;
              for (const ev of events) {
                if (ev.kind === "user") lastUserId = ev.id;
                if (ev.kind === "assistant") lastAssistantId = ev.id;
              }


              // Render the flat chronological list — no grouping.
              // Each tool event renders as its own row. Reasoning renders
              // as a separate block before the message content.
              const rendered: React.ReactNode[] = [];
              for (const ev of events) {
                if (ev.kind === "tool") {
                  // Each tool call is its own row — no grouping.
                  rendered.push(
                    <ToolEventCard
                      key={`tool-${ev.id}`}
                      event={ev.event}
                      debugMode={debugMode}
                      onResolveApproval={ev.event.status === "pending" ? (decision) => void handleResolveApproval(ev.id, decision) : undefined}
                      onSetApprovalMode={handleSetApprovalMode}
                    />
                  );
                  continue;
                }
                if (ev.kind === "interaction") {
                  rendered.push(
                    <QuestionCard
                      key={`intr-${ev.id}`}
                      interaction={ev.interaction}
                      onResolved={(resolved) => setInteractions((prev) => prev.map((i) => i.id === resolved.id ? resolved : i))}
                      onCancelled={(id) => setInteractions((prev) => prev.map((i) => i.id === id ? { ...i, status: "cancelled" } : i))}
                    />,
                  );
                  continue;
                }
                // Render reasoning as a separate thinking block row before
                // the message content, so thinking splits around tool calls.
                const isOfflineTurn = ev.kind === "assistant" && ev.providerId === LOCAL_PROVIDER_ID;
                const timeStr = ev.createdAt != null
                  ? new Date(ev.createdAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : null;
                const fullDate = ev.createdAt != null ? new Date(ev.createdAt * 1000).toLocaleString() : null;
                // Thinking block as its own row (split around interruptions).
                if (ev.reasoning && ev.reasoning.trim()) {
                  rendered.push(
                    <ThinkingBlock key={`thinking-${ev.id}`} text={ev.reasoning} />,
                  );
                }
                rendered.push(
                  <div key={ev.id} className={`chat-message chat-message-${ev.kind}`}>
                    <span className="chat-message-role">
                      {ev.kind === "user" ? "You" : ev.kind === "assistant" ? "Basebuild" : "System"}
                      {isOfflineTurn ? <span className="chat-offline-tag" title="No external model was contacted">Offline</span> : null}
                      {timeStr ? <span className="chat-message-time" title={fullDate ?? ""}>{timeStr}</span> : null}
                    </span>
                    {ev.kind === "assistant"
                      ? <MarkdownView text={ev.content} className="chat-message-content" />
                      : <pre className="chat-message-content">{ev.content}</pre>}
                    {ev.kind === "user" || ev.kind === "assistant" ? (
                      <div className="chat-message-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon-sm chat-message-action-copy"
                          title="Copy message source text to clipboard"
                          onClick={() => void handleCopyMessage(ev.content)}
                        >
                          <Copy size={11} />
                        </button>
                        {ev.kind === "assistant" && ev.id === lastAssistantId && !streaming ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon-sm chat-message-action-retry"
                            title="Retry — re-send the last user message as a new turn"
                            onClick={() => void handleRetryMessage()}
                          >
                            <RefreshCw size={11} />
                          </button>
                        ) : null}
                        {ev.kind === "user" && ev.id === lastUserId && !streaming ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon-sm chat-message-action-edit"
                            title="Edit and resend — load this message into the composer"
                            onClick={() => handleEditAndResend()}
                          >
                            <Edit2 size={11} />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>,
                );
              }

              // Loading row for streaming/thinking state.
              if (streaming) {
                rendered.push(
                  <div key="loading-streaming" className="chat-loading-row" title="Assistant is responding">
                    <Loader2 size={12} className="is-spinning" />
                    <span className="text-sm text-muted">Thinking…</span>
                  </div>,
                );
              }
              // Loading row for queued state.
              if (loading && !streaming) {
                rendered.push(
                  <div key="loading-queued" className="chat-loading-row" title="Request in progress">
                    <Loader2 size={12} className="is-spinning" />
                    <span className="text-sm text-muted">Working…</span>
                  </div>,
                );
              }

              return rendered;
            })()
          : renderMessages.map((msg, index) => {
              const key = `legacy-${index}`;
              return (
                <div key={key} className={`chat-message chat-message-${msg.role}`}>
                  <span className="chat-message-role">
                    {msg.role === "user" ? "You" : msg.role === "assistant" ? "Basebuild" : "System"}
                  </span>
                  <pre className="chat-message-content">{msg.content}</pre>
                </div>
              );
            })}

        {/* Live thinking with elapsed timer */}
        {streaming && reasoningText ? (
          <div className="chat-message chat-message-assistant chat-message-reasoning" title="Live chain-of-thought from the model. Final answer follows.">
            <span className="chat-message-role">
              Thinking…
              <span className="chat-elapsed-badge" title={`Elapsed: ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
            </span>
            <pre className="chat-message-content chat-reasoning-live">{reasoningText}<span className="chat-cursor" /></pre>
          </div>
        ) : null}

        {/* Streaming assistant text with elapsed timer */}
        {streaming && streamText ? (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-role">
              Basebuild
              <span className="chat-elapsed-badge" title={`Elapsed: ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
            </span>
            <div className="chat-message-content"><MarkdownView text={streamText} /><span className="chat-cursor" /></div>
          </div>
        ) : null}

        {/* Waiting for first token with elapsed timer */}
        {streaming && streamPhase === "thinking" && !streamText && !reasoningText ? (
          <div className="chat-message chat-thinking-indicator" title={`Waiting for the model to start responding (${formatElapsed(elapsed)})`}>
            <span className="chat-message-role">
              Basebuild
              <span className="chat-elapsed-badge" title={`Elapsed: ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
            </span>
            <div className="chat-thinking-dots">
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
            </div>
          </div>
        ) : null}

        {/* Running tools with tool names, count, and elapsed timer */}
        {streaming && streamPhase === "tools" ? (() => {
          const pendingTools = toolEvents.filter((e) => e.status === "pending");
          const runningTools = toolEvents.filter((e) => e.status === "running");
          const completedTools = toolEvents.filter((e) => e.status === "success" || e.status === "error" || e.status === "denied" || e.status === "approved");
          const activeTools = [...pendingTools, ...runningTools];
          const toolNames = activeTools.length > 0
            ? activeTools.map((e) => e.kind.replace(/_/g, " ")).join(", ")
            : "tools";
          const isWaitingApproval = pendingTools.length > 0;
          return (
            <div
              className={`chat-loading chat-loading-active chat-loading-tools${isWaitingApproval ? " chat-loading-approval" : ""}`}
              title={
                isWaitingApproval
                  ? `Waiting for approval: ${pendingTools.map((e) => e.kind.replace(/_/g, " ")).join(", ")}. Click the approval card to allow or deny. Elapsed: ${formatElapsed(elapsed)}.`
                  : `Executing: ${toolNames} (${activeTools.length} running, ${completedTools.length} done). Elapsed: ${formatElapsed(elapsed)}.`
              }
            >
              <span className="chat-loading-spinner" />
              <span className="chat-loading-label">
                {isWaitingApproval
                  ? `Waiting for approval: ${pendingTools.map((e) => e.kind.replace(/_/g, " ")).join(", ")}…`
                  : activeTools.length > 0
                    ? `${toolNames}…`
                    : "Running tools…"}
              </span>
              {activeTools.length > 0 || completedTools.length > 0 ? (
                <span className="chat-loading-count" title={`${pendingTools.length} pending, ${runningTools.length} running, ${completedTools.length} completed`}>
                  {pendingTools.length > 0 ? `${pendingTools.length} pending` : ""}
                  {pendingTools.length > 0 && runningTools.length > 0 ? " · " : ""}
                  {runningTools.length > 0 ? `${runningTools.length} running` : ""}
                  {(pendingTools.length > 0 || runningTools.length > 0) && completedTools.length > 0 ? " · " : ""}
                  {completedTools.length > 0 ? `${completedTools.length} done` : ""}
                </span>
              ) : null}
              <span className="chat-elapsed-badge" title={`Elapsed: ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
            </div>
          );
        })() : null}

        {loading && !streaming ? (
          <div className="chat-loading">{nativeMode ? "Working…" : "Agent is typing…"}</div>
        ) : null}
        {stuck ? (
          <div className="chat-stuck-bar">
            <AlertCircle size={12} />
            <span className="text-sm">Agent frozen. No response after {SEND_TIMEOUT_MS / 1000}s.</span>
            <button className="btn btn-sm" type="button" title="Stop and restart the agent" onClick={() => void handleStopAgent()}>
              <RefreshCw size={12} /> Restart
            </button>
          </div>
        ) : null}
        {!streaming && !loading && interactions.length === 0 ? (() => {
          // Find the last assistant message content from renderMessages.
          let lastAssistantContent: string | null = null;
          for (let i = renderMessages.length - 1; i >= 0; i--) {
            const msg = renderMessages[i];
            if (msg.role === "assistant") { lastAssistantContent = msg.content; break; }
          }
          if (!lastAssistantContent) return null;
          const chips = detectProseQuickReplies(lastAssistantContent);
          if (chips.length < 2) return null;
          return (
            <div className="chat-quick-replies" title="Quick-reply options detected from the last message">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="chat-quick-reply-chip"
                  title={`Send: ${chip}`}
                  onClick={() => void sendMessage(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          );
        })() : null}
      </div>

      {/* Generated ideas surface */}
      {nativeMode && ideaState.ideas.length > 0 ? (
        <div className="chat-ideas">
          <div className="chat-ideas-header">
            <Lightbulb size={12} />
            <span>Ideas ({ideaState.ideas.length})</span>
          </div>
          {ideaState.ideas.map((idea) => (
            <div key={idea.id} className="chat-idea-card">
              <div className="chat-idea-card-top">
                <span className="chat-idea-title">{idea.title}</span>
                {idea.status === "concept" ? (
                  <div className="chat-idea-card-actions">
                    <button
                      className="btn btn-sm"
                      type="button"
                      title="Promote this idea into the plan pipeline"
                      onClick={() => void handlePromoteIdea(idea)}
                    >
                      Promote to Plan
                    </button>
                    <button
                      className="btn btn-sm"
                      type="button"
                      title="Reject this idea"
                      onClick={() => void ideaState.rejectIdea(idea.id)}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="chat-idea-status">{idea.status === "picked" ? "Planned" : idea.status === "rejected" ? "Rejected" : idea.status}</span>
                )}
              </div>
              {idea.description ? <p className="chat-idea-desc">{idea.description}</p> : null}
            </div>
          ))}
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
              title={`Connect ${setupRequired.providerLabel}`}
              onClick={() => {
                setLoginError(null);
                setShowLogin(true);
              }}
            >
              <Key size={11} /> Connect
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

      {/* Provider login modal: API key entry as a modal, not inline */}
      {nativeMode && showLogin && selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID ? (
        <div className="modal-overlay" onClick={() => { setShowLogin(false); cancelWebLogin(); }} title="Close login dialog">
          <div className="modal" onClick={(e) => e.stopPropagation()} title={`Connect ${selectedProvider.label}`}>
            <div className="modal-header">
              <h2>Connect {selectedProvider.label}</h2>
              <button
                className="btn-icon"
                title="Close"
                type="button"
                onClick={() => { setShowLogin(false); cancelWebLogin(); }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body stack" onClick={(e) => e.stopPropagation()} title={`Connect ${selectedProvider.label}`}>
              <p className="text-sm text-muted">
                Enter your {selectedProvider.label} API key below.
                {selectedProvider.apiKeyUrl ? (
                  <> Need a key? <button className="chat-link-btn" type="button" title={`Open ${selectedProvider.label} key page`} onClick={() => void openApiKeyUrl(selectedProvider.apiKeyUrl!)}>Get API key →</button></>
                ) : null}
              </p>
              <input
                className="input"
                type="password"
                placeholder="API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                title="Enter your API key for this provider"
              />
              <input
                className="input"
                placeholder="Base URL (optional)"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                title="Custom API base URL (optional)"
              />
              <button
                className="btn btn-primary"
                type="button"
                title="Save API key and connect"
                disabled={!apiKey.trim() || savingCred}
                onClick={() => void handleSaveCredential()}
              >
                {savingCred ? "Saving…" : "Save key & connect"}
              </button>
              {loginError ? <p className="text-danger text-sm">{loginError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Composer footer: always visible, never clipped */}
      <div className="chat-input-area">
        {nativeMode ? (
          <>
            <ChatComposerRail
              catalog={catalog}
              providerId={providerId}
              providerName={providerName}
              providerDegraded={providerDegraded}
              modelId={modelId}
              modelName={modelName}
              effortLevel={effortLevel}
              supportedEfforts={selectedModel?.supportedEfforts ?? []}
              catalogRefreshing={catalogRefreshing}
              lastSyncedAt={selectedProvider?.lastSyncedAt ?? null}
              localProviderId={LOCAL_PROVIDER_ID}
              onPickProvider={() => {
                addLog("debug", "Provider catalog modal opened", `sessionId=${activeSessionId ?? "none"}`);
                setShowProviderPicker(true);
                setShowModelPicker(false);
                setShowPlanningMenu(false);
              }}
              onPickModel={() => {
                addLog("debug", "Provider catalog modal opened", `sessionId=${activeSessionId ?? "none"}; focus=models`);
                setShowModelPicker(true);
                setShowProviderPicker(false);
                setShowPlanningMenu(false);
              }}
              onChangeEffort={(effort) => {
                setEffortLevel(effort);
                persistSelection(providerId, modelId, effort);
              }}
              onRefresh={() => void refreshCatalog(true, selectedProvider?.id)}
              onConnect={() => {
                setLoginError(null);
                setShowLogin(true);
                setShowProviderPicker(false);
              }}
              onDisconnect={() => void handleDisconnect()}
              onOpenCommands={() => {
                addLog("debug", "Command palette opened via button", `sessionId=${activeSessionId ?? "none"}`);
                setShowCommandPalette(true);
                setInput("/");
              }}
            />
            {showPlanningMenu ? (
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
            ) : null}
            {showCategoryPicker ? (
              <div className="modal-overlay" onClick={() => setShowCategoryPicker(false)} title="Close category picker">
                <div className="modal modal-sm" onClick={(e) => e.stopPropagation()} title="Pick a category">
                  <div className="modal-header">
                    <h2>Pick a category</h2>
                    <button className="btn-icon" type="button" title="Close category picker" onClick={() => setShowCategoryPicker(false)}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="modal-body stack">
                    {ideaState.categories.length === 0 ? (
                      <p className="text-muted text-sm">No categories yet.</p>
                    ) : null}
                    {ideaState.categories.map((cat) => (
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
            ) : null}
            {(showProviderPicker || showModelPicker) && catalog ? (
              <div
                className="modal-overlay provider-catalog-overlay"
                role="dialog"
                aria-label="Provider and model catalog"
                onClick={() => {
                  addLog("debug", "Provider catalog modal closed", "overlay");
                  setShowProviderPicker(false);
                  setShowModelPicker(false);
                }}
              >
                <div className="modal provider-catalog-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div className="provider-catalog-title">
                      <h2>Provider &amp; model</h2>
                      <span>{connectedProviders.length} connected · {catalog.providers.length} providers · {catalog.models.length} models</span>
                    </div>
                    <button
                      className="btn-icon"
                      type="button"
                      title="Close provider and model catalog"
                      onClick={() => {
                        addLog("debug", "Provider catalog modal closed", "button");
                        setShowProviderPicker(false);
                        setShowModelPicker(false);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="provider-catalog-body">
                    <section className="provider-catalog-providers" aria-label="Providers">
                      <div className="provider-catalog-section-heading">
                        <span>Providers</span>
                        <span className="text-muted">Select one to browse its models</span>
                      </div>
                      <div className="provider-card-grid">
                        {orderedProviders.map((provider) => (
                          <div
                            key={provider.id}
                            className={`provider-card is-${provider.configured ? "connected" : "available"}${provider.id === providerId ? " is-active" : ""}`}
                            title={`${provider.label}: ${provider.configured ? "connected" : "not connected"}; ${provider.modelCount} models`}
                          >
                            <button
                              className="provider-card-select"
                              type="button"
                              title={`${provider.label}: ${provider.configured ? "connected" : "not connected"}; ${provider.modelCount} models. Click to browse models.`}
                              onClick={() => {
                                addLog("debug", "Provider selected", `provider=${provider.id}; connected=${provider.configured}`);
                                setProviderId(provider.id);
                                const providerModels = catalog.models.filter((model) => model.providerId === provider.id);
                                const currentIsValid = providerModels.some((model) => model.id === modelId);
                                if (!currentIsValid && providerModels[0]) setModelId(providerModels[0].id);
                                setSetupRequired(null);
                                setModelFilter("");
                              }}
                            >
                              <span className="provider-card-topline">
                                <span className="provider-card-name">{provider.label}</span>
                                <span
                                  className={`provider-status is-${provider.status === "transport_unavailable" ? "warning" : provider.configured ? "connected" : "available"}`}
                                  title={provider.status === "transport_unavailable" ? "This provider uses a bespoke API that requires a custom base URL for native chat. Set a base URL to enable the native agent loop." : undefined}
                                >
                                  <span className="provider-status-dot" />
                                  {provider.status === "transport_unavailable" ? "No transport" : provider.configured ? "Connected" : "Available"}
                                </span>
                              </span>
                              <span className="provider-card-meta">{provider.modelCount} models</span>
                            </button>
                            {provider.id !== LOCAL_PROVIDER_ID ? (
                              <div className="provider-card-actions">
                                {provider.configured ? (
                                  <button
                                    className="btn btn-sm provider-card-action-btn"
                                    type="button"
                                    title={`Disconnect ${provider.label} — removes the stored API key`}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await nativeDeleteProviderCredential(provider.id);
                                        await refreshCatalog();
                                        addLog("debug", "Provider disconnected", `provider=${provider.id}`);
                                      } catch (err) {
                                        addLog("error", "Failed to disconnect provider", err instanceof Error ? err.message : String(err));
                                      }
                                    }}
                                  >
                                    <Unplug size={11} /> Disconnect
                                  </button>
                                ) : null}
                                <button
                                  className="btn btn-sm provider-card-action-btn"
                                  type="button"
                                  title={provider.configured ? `Update key for ${provider.label} — enter a new API key` : `Connect ${provider.label} — enter an API key`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProviderId(provider.id);
                                    const providerModels = catalog.models.filter((model) => model.providerId === provider.id);
                                    const currentIsValid = providerModels.some((model) => model.id === modelId);
                                    if (!currentIsValid && providerModels[0]) setModelId(providerModels[0].id);
                                    setShowProviderPicker(false);
                                    setShowModelPicker(false);
                                    setShowLogin(true);
                                  }}
                                >
                                  <Key size={11} /> {provider.configured ? "Update key" : "Connect"}
                                </button>
                            {provider.error ? (
                              <div className="provider-card-error text-danger text-sm" title={provider.error}>
                                <span className="provider-card-error-text">{provider.error}</span>
                                <button
                                  className="btn btn-sm provider-card-retry-btn"
                                  type="button"
                                  title={`Retry fetching models from ${provider.label}`}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await nativeProviderCatalogRefresh({ providerId: provider.id, force: true });
                                      await refreshCatalog();
                                    } catch (err) {
                                      addLog("error", "Failed to refresh provider", err instanceof Error ? err.message : String(err));
                                    }
                                  }}
                                >
                                  Retry
                                </button>
                              </div>
                            ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="provider-catalog-models" aria-label="Models">
                      <div className="provider-catalog-section-heading">
                        <span>{selectedProvider?.label ?? providerId} models</span>
                        <span className={`provider-status is-${selectedProvider?.configured ? "connected" : "available"}`}>
                          <span className="provider-status-dot" />
                          {selectedProvider?.configured ? "Connected" : "Not connected"}
                        </span>
                      </div>
                      <input
                        className="input provider-model-search"
                        value={modelFilter}
                        placeholder="Search this provider's models"
                        title="Filter models for the selected provider by id or label"
                        onChange={(event) => setModelFilter(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setShowProviderPicker(false);
                            setShowModelPicker(false);
                          }
                        }}
                      />
                      <div className="provider-model-list">
                        {filteredModels.map((model) => (
                          <button
                            key={`${model.providerId}:${model.id}`}
                            className={`provider-model-row${model.id === modelId && model.providerId === providerId ? " is-active" : ""}`}
                            type="button"
                            title={`${selectedProvider?.label ?? model.providerId} / ${model.id}. Source: ${model.source}`}
                            onClick={() => {
                              addLog("debug", "Model selected", `provider=${model.providerId}; model=${model.id}`);
                              setProviderId(model.providerId);
                              setModelId(model.id);
                              setShowProviderPicker(false);
                              setShowModelPicker(false);
                              setSetupRequired(null);
                              setModelNotice(null);
                              persistSelection(model.providerId, model.id, effortLevel);
                            }}
                          >
                            <span className="provider-model-main">
                              <span>{model.label}</span>
                              <span className="provider-model-id">{model.id}</span>
                            </span>
                            <span className="provider-model-badges">
                              {model.supportsTools ? <span className="provider-capability is-positive">Tools</span> : null}
                              {model.supportsReasoning ? <span className="provider-capability">Reasoning</span> : null}
                              <span className="provider-capability">{model.supportedEfforts.length ? model.supportedEfforts.join("/") : "Standard"}</span>
                            </span>
                          </button>
                        ))}
                        {filteredModels.length === 0 ? <p className="text-muted text-sm provider-model-empty">No matching models.</p> : null}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
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
            ) : null}
          </>
        ) : null}
        {(() => {
          const pending = interactions.find((i) => i.status === "pending");
          if (!pending) return null;
          const textQ = pending.questions.find((q) => q.kind === "text" || (q.kind === "options" && q.allowFreeText));
          if (!textQ) return null;
          return (
            <div className="chat-answering-banner" title="Your next send will be submitted as the answer. Use /send <text> to send a normal message instead.">
              <span className="chat-answering-icon">?</span>
              <span className="chat-answering-text">Answering: {textQ.prompt}</span>
              <span className="chat-answering-hint text-muted">/send to escape</span>
            </div>
          );
        })()}
        <div className="chat-input-row">
          <textarea
            ref={chatInputRef}
            className="input chat-input"
            placeholder={
              nativeMode
                ? "Type a message… (Enter to send, Shift+Enter for newline)"
                : "Agent not connected. Click retry above to start."
            }
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              // Open palette when input starts with `/` (command position).
              if (nativeMode && val.trimStart().startsWith("/")) {
                setShowCommandPalette(true);
              } else if (showCommandPalette) {
                setShowCommandPalette(false);
              }
              setPaletteActiveIndex(0);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
            }}
            onKeyDown={(e) => {
              // Command palette keyboard navigation.
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
                // Enter: if palette is open and there's a match, submit the command.
                if (e.key === "Enter" && !e.shiftKey && ranked.length > 0) {
                  e.preventDefault();
                  void handleSend();
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={3}
            disabled={inputDisabled}
            title={nativeMode ? "Chat input — type a message and press Enter to send" : "Chat input — start the agent to enable sending"}
          />
          {nativeMode && loading ? (
            <button
              className="btn chat-send-btn chat-stop-btn"
              type="button"
              title="Stop the agent and unlock the composer"
              onClick={() => void handleStopNative()}
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              className="btn btn-primary chat-send-btn"
              type="button"
              title="Send message"
              disabled={sendDisabled}
              onClick={() => void handleSend()}
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <div className="chat-input-controls">
          <select
            className="chat-permission-select"
            title={`Permission mode: ${approvalMode === "auto" ? "Auto — all tools allowed without asking" : approvalMode === "safe" ? "Safe — always ask before any tool" : "Balanced — read-only tools auto-allowed, mutating tools ask"}. Change to control how the agent handles tool calls.`}
            value={approvalMode}
            onChange={(e) => void handleSetApprovalMode(e.target.value as ApprovalMode)}
          >
            <option value="balanced" title="Read-only tools auto-allowed; writes and commands prompt">Balanced</option>
            <option value="safe" title="Every tool call prompts the user">Always Ask</option>
            <option value="auto" title="No prompts; everything auto-allowed within workspace">Run Everything</option>
          </select>
          <button
            type="button"
            className={`btn btn-sm chat-debug-toggle ${debugMode ? "chat-debug-toggle-on" : ""}`}
            title={debugMode ? "Debug mode ON — showing raw event data in tool cards. Click to turn off." : "Debug mode OFF — click to show raw event data in tool cards"}
            onClick={() => {
              const next = !debugMode;
              setDebugMode(next);
              localStorage.setItem("basebuild.debug-mode", String(next));
            }}
          >
            <Bug size={12} /> Debug
          </button>
        </div>
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
        <ChatContextStrip
          projectPath={projectPath}
          workspaceId={nativeSessionId}
          branch={branch}
          worktreePath={worktreePath}
          plan={planBadge ? { referenceId: planBadge.referenceId, title: planBadge.title, status: planBadge.status } : null}
          runState={streaming ? "running" : loading ? "queued" : "idle"}
          modelLabel={modelName}
          contextUsage={{ used: null, limit: null }}
        />
      </div>
    </div>
  );
}

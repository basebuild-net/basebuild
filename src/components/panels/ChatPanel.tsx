import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { ChatHeader, BranchDropdown } from "./ChatHeader";
import { PrRecommendationCard } from "./PrRecommendationCard";
import { QuestionCard } from "./QuestionCard";
import { InteractionWorkbench } from "./InteractionWorkbench";
import { IdeaBatchPreview, IdeaReviewWorkbench, parseIdeaBatch, type ParsedIdeaBatch } from "./IdeaReviewWorkbench";
import { MarkdownView } from "./MarkdownView";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit2,
  GitBranch as GitBranchIcon,
  FolderTree,
  HelpCircle,
  Key,
  LayoutGrid,
  Lightbulb,
  Loader2,
  RefreshCw,
  Rocket,
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
  nativeChatBootstrap,
  nativeChatCancel,
  nativeChatClearMessages,
  nativeChatGet,
  nativeChatMessages,
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
  nativeSessionLatestMetric,
  nativeSaveProviderCredential,
  renameNativeChatSession,
  type ChatModelDefault,
  type NativeChatMessage,
  type NativeModel,
  type NativeProviderCatalog,
  type NativeSetupRequired,
  type NativeToolEvent,
} from "../../lib/native-chat";
import { resolveToolApproval } from "../../lib/native-chat";
import { buildChatTimeline, type LiveSegment } from "../../lib/chatTimeline";
import { useIdeaState } from "../../state/ideas";
import { setLastGrounding } from "../../state/grounding";
import type { Idea } from "../../lib/ideas";
import { inspectProjectSchematic, type SchematicReport } from "../../lib/schematic";
import { schematicWizardAction } from "../../lib/planningActions";
import { readSkill } from "../../lib/skills";
import type { AgentMode } from "../../lib/sessions";
import { readModelRecency, recordModelUse } from "../../lib/modelRecency";
import { useLogs } from "../../state/log";
import { useDropdownPosition } from "../../state/useDropdownPosition";

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
  /** Duplicate this chat panel beside the current one. */
  onDuplicateChat?: () => void;
  /** Start a fresh empty chat for the current project (keeps the previous chat). */
  onNewChat?: () => void;
  /** Show a toast notification (success/warning/error/info). */
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
  /** Open the history drawer (closed panels). */
  onOpenHistory?: () => void;
};


function formatElapsed(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const minLabel = m === 1 ? "1 min" : `${m} min`;
  const secLabel = s === 1 ? "1 sec" : `${s} sec`;
  if (m < 60) return `${minLabel} ${secLabel}`;
  const h = Math.floor(m / 60);
  const remainingMin = m % 60;
  const hourLabel = h === 1 ? "1 h" : `${h} h`;
  const remMinLabel = remainingMin === 1 ? "1 min" : `${remainingMin} min`;
  return `${hourLabel} ${remMinLabel}`;
}

function resolveAssistantLabel(
  catalog: NativeProviderCatalog | null,
  selectedModel: NativeModel | null,
  modelId: string,
  providerId: string | null,
): string {
  if (providerId && modelId) {
    const catalogModel = catalog?.models.find((m) => m.providerId === providerId && m.id === modelId);
    if (catalogModel) return catalogModel.label;
  }
  return selectedModel?.label ?? modelId ?? "Assistant";
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="chat-thinking-block" title="Model thinking — click to expand">
      <button
        className="chat-thinking-toggle"
        type="button"
        title={expanded ? "Collapse model thinking trace" : "Expand model thinking trace"}
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
function UserMessageContent({
  content,
  onViewPayload,
}: {
  content: string;
  onViewPayload: (name: string, payload: string) => void;
}) {
  const parsed = useMemo(() => parseCommandPayload(content), [content]);
  if (!parsed) return <pre className="chat-message-content">{content}</pre>;
  return (
    <div className="chat-message-content">
      <button
        className="chat-command-chip"
        type="button"
        title={`View full ${parsed.name} payload`}
        onClick={() => onViewPayload(parsed.name, parsed.content)}
      >
        {parsed.name}
      </button>
      {parsed.trailing ? <span className="chat-command-trailing">{parsed.trailing}</span> : null}
    </div>
  );
}

// Module-level expansion state for tool cards. Keyed by tool event id,
// survives re-renders during streaming so a card the user expanded stays
// expanded as the event updates from pending → running → success.
const toolCardExpanded = new Map<string, boolean>();


function ToolEventCard({
  event,
  onResolveApproval,
  debugMode,
  onSetApprovalMode,
  ideas = [],
  onOpenIdeaBatch,
}: {
  event: NativeToolEvent;
  onResolveApproval?: (decision: "allow" | "allow_session" | "deny") => void;
  debugMode?: boolean;
  onSetApprovalMode?: (mode: "safe" | "balanced" | "auto") => void;
  ideas?: Idea[];
  onOpenIdeaBatch?: (toolId: string) => void;
}) {
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
  const showExpanded = expanded || isApproval;

  // Prefer the structured diff field from the backend; fall back to
  // parsing the summary for legacy events that predate the diff column.
  const hasDiff = isEdit && (event.diff != null || /^[+-]/m.test(event.summary));
  const diffText = event.diff ?? (hasDiff ? event.summary : "");
  const diffLines = diffText.split("\n").filter((l) => l.length > 0);

  const timeStr = event.createdAt
    ? new Date(event.createdAt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const activeDuration = isRunning && event.createdAt
    ? formatElapsed(Math.max(0, Math.floor(Date.now() / 1000) - event.createdAt))
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

  const ideaBatch = event.kind === "propose_ideas" ? parseIdeaBatch(parsedArgs) : null;
  if (ideaBatch) {
    return (
      <IdeaBatchPreview
        {...ideaBatch}
        status={event.status}
        ideas={ideas}
        onOpen={() => onOpenIdeaBatch?.(event.id)}
      />
    );
  }

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
    <div data-tool-id={event.id} className={`tool-card tool-card-${statusClass}${isApproval ? " tool-card-approval" : ""}`} title={`${event.kind}: ${event.status}${timeStr ? ` at ${timeStr}` : ""}${provenance ? ` — ${provenance}` : ""}`}>
      <div className="tool-card-header" onClick={() => { if (!isApproval) toggleExpanded(); }} role={isApproval ? undefined : "button"} tabIndex={isApproval ? -1 : 0} aria-expanded={isApproval ? undefined : expanded}>
        <span className="tool-card-icon">{icon}</span>
        <span className={`tool-card-name is-${event.kind.replace(/_/g, "-")}`}>{event.kind.replace(/_/g, " ")}</span>
        {argDisplay ? <code className="tool-card-arg-value" title={`${argDisplay.label}: ${argDisplay.value}`}>{argDisplay.value}</code> : null}
        <span className={`tool-card-status tool-card-status-${statusClass}`}>
          {event.status}{activeDuration ? ` · ${activeDuration}` : ""}
        </span>
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
  onDuplicateChat,
  onNewChat,
  onShowToast,
  onOpenHistory,
}: ChatPanelProps) {
  const [profileId, setProfileId] = useState(NATIVE_PROFILE_ID);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "refreshing" | "ready" | "stale" | "error">("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [contextUsedTokens, setContextUsedTokens] = useState(0);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
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
  const [loading, setLoading] = useState(false);
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
          : "idle";
    if (lastPublishedStatusRef.current === status) return;
    lastPublishedStatusRef.current = status;
    publishPanelStatus(status);
  }, [panelId, interactions, streaming, streamPhase, loading, publishPanelStatus]);
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
  // Grounding metadata is written to the shared store (src/state/grounding.ts).
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [showPlanningMenu, setShowPlanningMenu] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [schematicReport, setSchematicReport] = useState<SchematicReport | null>(null);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandRecency, setCommandRecency] = useState<Record<string, number>>(() => readCommandRecency());
  const [modelRecency, setModelRecency] = useState<Record<string, number>>(() => readModelRecency());
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
  const [metaBranchOpen, setMetaBranchOpen] = useState(false);
  const metaBranchPos = useDropdownPosition(200);
  const [metaNewBranch, setMetaNewBranch] = useState("");
  const [metaCreatingBranch, setMetaCreatingBranch] = useState(false);
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
    const needle = modelFilter.trim().toLowerCase();
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
    return ranked.filter((model) => {
      const provider = catalog?.providers.find((p) => p.id === model.providerId);
      return (
        model.id.toLowerCase().includes(needle) ||
        model.label.toLowerCase().includes(needle) ||
        model.providerId.toLowerCase().includes(needle) ||
        (provider?.label.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [catalog, modelFilter, providerId, modelRecency]);
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
    if (!nativeMode || (!nativeSessionId && !catalog)) return;
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
    let renderFrame: number | null = null;
    const scheduleStreamRender = () => {
      if (renderFrame !== null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        setStreamText(streamBufRef.current);
        setReasoningText(reasoningBufRef.current);
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
            setStreamPhase(phase === "tools" ? "tools" : "thinking");
          }
          return;
        }
        // Tool-call argument fragments are raw JSON — don't pollute the
        // content stream. They render as tool cards via the tool-event
        // channel instead.
        if (channel === "tool_call") return;
        if (channel === "reasoning") {
          reasoningBufRef.current += event.payload.delta;
          scheduleStreamRender();
          return;
        }
        // Only the content channel accumulates into the visible stream.
        // Anything else (debug frames, tool summaries, protocol markers)
        // must never leak into the transcript — the debug listener captures
        // every channel when debug mode is on.
        if (channel !== "content") return;
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
          setShowLogin(true);
          return;
        }
        setInput("");
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
    [nativeMode, nativeSessionId, selectedProvider, loading, providerId, modelId, effortLevel, agentId, addLog, setModelRecency],
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
  const generateIdeasRef = useRef<((opts?: { categoryIds?: string[]; ideaCount?: number; direction?: string | null }) => Promise<void>) | null>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    addLog("debug", "Chat send", `text=${text.slice(0, 80)} nativeMode=${nativeMode} session=${nativeSessionId ?? "none"}`);
    if (!text) return;
    // Composer answer routing: if there's a pending text/free-text question,
    // capture the next send as the answer (unless escaped with /send).
    const pendingInteraction = interactions.find((i) => i.status === "pending" && !minimizedQuestions.has(i.id));
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
  }, [input, nativeMode, sendMessage, catalog, addLog, interactions, minimizedQuestions, nativeMessages, toolEvents, loading, streaming, onNewChat, effortLevel, modelId, onOpenSchematic, projectPath, selectedModel]);

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
  const inputDisabled = nativeMode ? !nativeSessionId : agentId === null;
  const sendDisabled = loading || !input.trim() || (nativeMode ? !nativeSessionId : agentId === null);

  const modelName = selectedModel?.label ?? modelId;
  // Pending ask_user questions. Non-minimized ("active") questions take over
  // the composer: the input box is hidden so the only affordance is answering
  // the question card in the dock. Users can minimize a question at any time to
  // reclaim the composer; a compact clickable preview then lets them reopen it.
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
        </ModalPortal>
      ) : null}
      {/* Messages area */}
      <div className="chat-messages" ref={scrollRef}>
        {nativeMode
          ? (() => {
              // Flat chronological timeline: merge messages + tool events +
              // reasoning into a single sorted list, rendered in order.
              // No grouping — each tool call is its own row. Thinking blocks
              // render as separate rows, split around tool calls/questions.
              const events = chatTimeline;
              // Compute last user/assistant message IDs for action rail.
              let lastUserId: string | null = null;
              let lastAssistantId: string | null = null;
              for (const ev of events) {
                if (ev.kind === "user") lastUserId = ev.id;
                if (ev.kind === "assistant") lastAssistantId = ev.id;
              }

              // Render the flat chronological list — consecutive tool
              // events are grouped into a compact grid.
              const rendered: React.ReactNode[] = [];
              let toolBatch: Extract<(typeof events)[number], { kind: "tool" }>[] = [];
              function flushToolBatch() {
                if (toolBatch.length === 0) return;
                if (toolBatch.length === 1) {
                  const ev = toolBatch[0];
                  rendered.push(
                    <ToolEventCard
                      key={`tool-${ev.id}`}
                      event={ev.event}
                      debugMode={debugMode}
                      onResolveApproval={ev.event.status === "pending" ? (decision) => void handleResolveApproval(ev.id, decision) : undefined}
                      onSetApprovalMode={handleSetApprovalMode}
                      ideas={ideaState.ideas}
                      onOpenIdeaBatch={(toolId) => {
                        minimizedIdeaBatchIdsRef.current.delete(toolId);
                        setFocusedIdeaBatchId(toolId);
                      }}
                    />
                  );
                } else {
                  rendered.push(
                    <div className="tool-card-grid" key={`grid-${toolBatch[0].id}`}>
                      {toolBatch.map((ev) => (
                        <ToolEventCard
                          key={`tool-${ev.id}`}
                          event={ev.event}
                          debugMode={debugMode}
                          onResolveApproval={ev.event.status === "pending" ? (decision) => void handleResolveApproval(ev.id, decision) : undefined}
                          onSetApprovalMode={handleSetApprovalMode}
                          ideas={ideaState.ideas}
                          onOpenIdeaBatch={(toolId) => {
                            minimizedIdeaBatchIdsRef.current.delete(toolId);
                            setFocusedIdeaBatchId(toolId);
                          }}
                        />
                      ))}
                    </div>
                  );
                }
                toolBatch = [];
              }
              for (const ev of events) {
                if (ev.kind === "tool") {
                  toolBatch.push(ev);
                  continue;
                }
                flushToolBatch();
                if (ev.kind === "interaction") {
                  // Pending questions replace the composer in the focused
                  // workbench; answered/cancelled items render inline here.
                  if (ev.interaction.status === "pending") continue;
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
                // Reasoning-only rows (no text in this iteration) get just
                // the thinking block — skip the empty message bubble.
                if (ev.kind === "assistant" && !ev.content.trim()) continue;
                rendered.push(
                  <div key={ev.id} className={`chat-message chat-message-${ev.kind}`} aria-label={`${ev.kind === "user" ? "You" : ev.kind === "assistant" ? "Assistant" : "System"}: ${ev.content.slice(0, 100)}`}>
                    <span className="chat-message-role">
                      {ev.kind === "user" ? "You" : ev.kind === "assistant" ? resolveAssistantLabel(catalog, selectedModel, ev.modelId ?? modelId, ev.providerId) : "System"}
                      {isOfflineTurn ? <span className="chat-offline-tag" title="No external model was contacted">Offline</span> : null}
                      {timeStr ? <span className="chat-message-time" title={fullDate ?? ""}>{timeStr}</span> : null}
                    </span>
                    {ev.kind === "assistant"
                      ? <MarkdownView text={ev.content} className="chat-message-content" />
                      : ev.kind === "user"
                        ? <UserMessageContent content={ev.content} onViewPayload={(name, payload) => setCommandPayloadModal({ name, content: payload })} />
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
              flushToolBatch();

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
                    {msg.role === "user" ? "You" : msg.role === "assistant" ? resolveAssistantLabel(catalog, selectedModel, modelId, providerId) : "System"}
                  </span>
                  {msg.role === "user"
                    ? <UserMessageContent content={msg.content} onViewPayload={(name, payload) => setCommandPayloadModal({ name, content: payload })} />
                    : <pre className="chat-message-content">{msg.content}</pre>}
                </div>
              );
            })}

        {/* Thinking block — visible while streaming and after stop */}
        {reasoningText ? (
          <div className="chat-message chat-message-assistant chat-message-reasoning" title="Live chain-of-thought from the model. Final answer follows.">
            <span className="chat-message-role">
              Thinking{streaming ? "…" : " (stopped)"}
              {streaming ? <span className="chat-elapsed-badge" title={`Thinking for ${formatElapsed(phaseElapsed)}`}>{formatElapsed(phaseElapsed)}</span> : null}
            </span>
            <pre className="chat-message-content chat-reasoning-live">{reasoningText}{streaming ? <span className="chat-cursor" /> : null}</pre>
          </div>
        ) : null}

        {/* Assistant text — visible while streaming and after stop */}
        {streamText ? (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-role">
              {selectedModel?.label ?? modelId}
              {streaming ? <span className="chat-elapsed-badge" title={`Elapsed: ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span> : null}
            </span>
            <div className="chat-message-content"><MarkdownView text={streamText} />{streaming ? <span className="chat-cursor" /> : null}</div>
          </div>
        ) : null}

        {/* Waiting for first token with elapsed timer */}
        {streaming && streamPhase === "thinking" && !streamText && !reasoningText ? (
          <div className="chat-message chat-thinking-indicator" title={`Waiting for the model to start responding (${formatElapsed(phaseElapsed)})`}>
            <span className="chat-message-role">
              {selectedModel?.label ?? modelId}
              <span className="chat-elapsed-badge" title={`Thinking for ${formatElapsed(phaseElapsed)}`}>{formatElapsed(phaseElapsed)}</span>
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
          // Search scope: extract query/pattern from the latest running search tool.
          const searchToolKinds = ["search_files", "search_files_in_workspace", "grep", "search"];
          const searchTool = runningTools.find((e) =>
            searchToolKinds.some((k) => e.kind.toLowerCase().includes(k))
          );
          const searchScope = (() => {
            if (!searchTool || !searchTool.arguments) return null;
            try {
              const parsed = JSON.parse(searchTool.arguments);
              if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                const q = (parsed as Record<string, unknown>).query
                  ?? (parsed as Record<string, unknown>).pattern
                  ?? (parsed as Record<string, unknown>).search
                  ?? null;
                return q ? String(q) : null;
              }
            } catch { /* ignore malformed JSON */ }
            return null;
          })();
          // "Xs ago" elapsed since the last tool event.
          const toolAgoText = toolAgoSeconds > 0
            ? toolAgoSeconds < 60
              ? `${toolAgoSeconds}s ago`
              : `${Math.floor(toolAgoSeconds / 60)}m ${toolAgoSeconds % 60}s ago`
            : null;
          return (
            <div
              className={`chat-loading chat-loading-active chat-loading-tools${isWaitingApproval ? " chat-loading-approval" : ""}`}
              title={
                isWaitingApproval
                  ? `Waiting for approval: ${pendingTools.map((e) => e.kind.replace(/_/g, " ")).join(", ")}. Click the approval card to allow or deny. Waiting for ${formatElapsed(phaseElapsed)}.`
                  : `Executing: ${toolNames} (${activeTools.length} running, ${completedTools.length} done). Running for ${formatElapsed(phaseElapsed)}.`
              }
            >
              <LogoPulse size={14} className="chat-loading-spinner" />
              <span className="chat-loading-label">
                {isWaitingApproval
                  ? `Waiting for approval: ${pendingTools.map((e) => e.kind.replace(/_/g, " ")).join(", ")}…`
                  : activeTools.length > 0
                    ? `${toolNames}…`
                    : "Running tools…"}
              </span>
              {stalled ? (
                <span className="chat-tool-stalled" title={`Stalled: no tool events for ${toolAgoSeconds}s. Last tool: ${lastToolKind.replace(/_/g, " ")}. Click Cancel to stop.`}>
                  Stalled · {lastToolKind.replace(/_/g, " ")}
                  <button
                    className="chat-tool-stalled-cancel"
                    type="button"
                    title="Cancel the stalled agent run"
                    onClick={() => void handleStopNative()}
                  >
                    Cancel
                  </button>
                </span>
              ) : null}
              {searchScope ? (
                <span className="chat-tool-scope" title={`Searching: ${searchScope}`}>
                  Searching: {searchScope}
                </span>
              ) : null}
              {toolAgoText ? (
                <span className="chat-tool-elapsed" title={`Last tool event ${toolAgoText}`}>
                  {toolAgoText}
                </span>
              ) : null}
              {activeTools.length > 0 || completedTools.length > 0 ? (
                <span className="chat-loading-count" title={`${pendingTools.length} pending, ${runningTools.length} running, ${completedTools.length} completed`}>
                  {pendingTools.length > 0 ? `${pendingTools.length} pending` : ""}
                  {pendingTools.length > 0 && runningTools.length > 0 ? " · " : ""}
                  {runningTools.length > 0 ? `${runningTools.length} running` : ""}
                  {(pendingTools.length > 0 || runningTools.length > 0) && completedTools.length > 0 ? " · " : ""}
                  {completedTools.length > 0 ? `${completedTools.length} done` : ""}
                </span>
              ) : null}
              <span className="chat-elapsed-badge" title={`Tool phase: ${formatElapsed(phaseElapsed)}`}>{formatElapsed(phaseElapsed)}</span>
            </div>
          );
        })() : null}

        {loading && !streaming ? (
          <div className="chat-loading">{nativeMode ? "Working…" : "Agent is typing…"}</div>
        ) : null}
        {interruptedRun && !streaming ? (
          <div className="chat-stuck-bar chat-recovery-bar" role="status">
            <AlertCircle size={12} />
            <span className="text-sm">Previous run was interrupted. Saved messages, thinking, and tool progress are shown above.</span>
            <button
              className="btn btn-sm"
              type="button"
              title="Prepare a safe continuation message without automatically repeating tools"
              onClick={() => {
                setInput("Continue from the saved checkpoint. Review what completed before retrying any tool.");
                window.requestAnimationFrame(() => chatInputRef.current?.focus());
              }}
            >
              Continue
            </button>
          </div>
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
      {/* Pending-question dock — the active ask_user question is pinned here
          above the composer so its options / text input / Submit / Cancel are
          always visible, instead of scrolling out of view up in the transcript
          (which left only the cryptic "/send to escape" banner). Answered and
          cancelled questions fall back into the transcript as history. */}
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
        <ModalPortal>
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
        </ModalPortal>
      ) : null}

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
              <ModalPortal>
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
                      <span>
                        {catalogStatus === "loading" || catalogStatus === "refreshing"
                          ? `${catalog ? "Refreshing" : "Loading"} provider catalog…`
                          : catalogStatus === "error"
                            ? "Catalog unavailable"
                            : catalogStatus === "stale"
                              ? `Refresh failed · showing ${catalog?.models.length ?? 0} cached models`
                              : `${connectedProviders.length} connected · ${catalog?.providers.length ?? 0} providers · ${catalog?.models.length ?? 0} models`}
                      </span>
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
                  {catalog ? (
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
                              setModelRecency(recordModelUse(model.providerId, model.id));
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
                              {modelRecency[`${model.providerId}/${model.id}`] ? (
                                <span className="provider-model-recency" title="Last used">
                                  used {formatRelativeTime(modelRecency[`${model.providerId}/${model.id}`]!)}
                                </span>
                              ) : null}
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
                  ) : catalogStatus === "error" ? (
                    <div className="modal-loading" role="alert">
                      <AlertCircle size={20} />
                      <span>Provider catalog could not load.</span>
                      <span className="text-muted text-sm">{catalogError ?? "Unknown catalog error"}</span>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        title="Retry loading the provider catalog"
                        onClick={() => void refreshCatalog()}
                      >
                        <RefreshCw size={12} /> Retry
                      </button>
                    </div>
                  ) : (
                    <div className="modal-loading" role="status" aria-live="polite">
                      <Loader2 size={20} className="spin" />
                      <span>Loading provider catalog…</span>
                    </div>
                  )}
                </div>
              </div>
              </ModalPortal>
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
          <div className="chat-composer-textarea-wrap">
            <textarea
              ref={chatInputRef}
              className="input chat-input"
              aria-label="Chat message input"
              placeholder={
                nativeMode
                  ? "Type a message… (Enter to send, Shift+Enter for newline)"
                  : "Agent not connected. Click retry above to start."
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
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              disabled={inputDisabled}
              title={nativeMode ? "Chat input — type a message and press Enter to send" : "Chat input — start the agent to enable sending"}
            />
          </div>
          <div className="chat-composer-controls">
            <ChatHeader
              modelChip={modelName}
              modelId={modelId}
              modelCatalogStatus={catalogStatus}
              modelCatalogError={catalogError}
              effortChip={effortLevel}
              effortOptions={(catalog?.effortLevels ?? [])
                .filter((effort) => selectedModel?.supportedEfforts.includes(effort.id) ?? false)
                .map((effort) => ({ id: effort.id, label: effort.label }))}
              onPickModel={() => {
                addLog("debug", "Provider catalog modal opened", `sessionId=${activeSessionId ?? "none"}; focus=models`);
                setShowModelPicker(true);
                setShowProviderPicker(false);
              }}
              onChangeEffort={(effort) => {
                addLog("debug", "Chat effort selected", `sessionId=${nativeSessionId ?? "none"}; effort=${effort}`);
                setEffortLevel(effort);
                persistSelection(providerId, modelId, effort);
              }}
              permissionMode={approvalMode}
              onChangePermission={(mode) => void handleSetApprovalMode(mode)}
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
              onDuplicateChat={() => onDuplicateChat?.()}
              onCloseChat={() => onCloseChat?.()}
              onCloseAndDelete={() => onCloseAndDeleteChat?.()}
              prRecommendation={prRec ? { branch: prRec.branch, ahead: prRec.ahead, behind: prRec.behind, changedFiles: prRec.changedFiles } : null}
              onCreatePullRequest={handleCreatePullRequest}
              projectPath={projectPath}
              sessionId={nativeSessionId}
              hideBranch
              onCopySessionId={() => {
                if (nativeSessionId) {
                  void navigator.clipboard.writeText(nativeSessionId);
                  onShowToast?.("Chat ID copied", nativeSessionId, "info");
                }
              }}
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
        <div className="chat-composer-meta">
          <div className="chat-composer-meta-left">
            {projectPath ? (
              <span title={`Project: ${projectPath}`}>{projectPath.split(/[\\/]/).pop() ?? projectPath}</span>
            ) : null}
            {worktreePath ? (
              <span className="chat-worktree-badge" title={`Worktree: ${worktreePath}`}>
                <span className="chat-worktree-dot" />
                {worktreePath.split("/").pop()}
              </span>
            ) : branch ? (
              <span className="chat-worktree-badge chat-worktree-primary" title="Primary workspace: using the open project checkout">
                <span className="chat-worktree-dot" />
                primary
              </span>
            ) : null}
          </div>
          <div className="chat-composer-meta-right">
            {branch ? (
              <button
                ref={metaBranchPos.triggerRef}
                className="chat-composer-branch-btn"
                type="button"
                title={`Branch: ${branch}. Click to switch or create.`}
                onClick={() => { metaBranchPos.recompute(); setMetaBranchOpen((v) => !v); }}
              >
                <GitBranchIcon size={10} />
                <span>{branch}</span>
                <ChevronDown size={9} />
              </button>
            ) : null}
            {metaBranchOpen ? (
              <BranchDropdown
                branches={branches}
                current={branch ?? ""}
                onPick={(name) => { setMetaBranchOpen(false); void handleSwitchBranch(name); }}
                onCreate={() => { setMetaCreatingBranch(true); setMetaNewBranch(""); }}
                creating={metaCreatingBranch}
                newBranchName={metaNewBranch}
                setNewBranchName={setMetaNewBranch}
                onCreateBranch={() => { void handleCreateBranch(metaNewBranch.trim()); setMetaCreatingBranch(false); setMetaNewBranch(""); setMetaBranchOpen(false); }}
                onCancelCreate={() => setMetaCreatingBranch(false)}
                placement={metaBranchPos.placement}
              />
            ) : null}
          </div>
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
        </div>
      </div>
  );
}

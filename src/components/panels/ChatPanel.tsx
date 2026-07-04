import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  BarChart3,
  Brain,
  Key,
  Lightbulb,
  RefreshCw,
  Send,
  Sparkles,
  Unplug,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { getRuntimeDefaults } from "../../lib/settings";
import { openUrl } from "../../lib/app";
import {
  nativeChatMessages,
  nativeChatModelDefault,
  nativeChatSend,
  nativeChatSetProjectModelDefault,
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
import { useIdeaState } from "../../state/ideas";
import type { Idea } from "../../lib/ideas";
import { useLogs } from "../../state/log";

const SEND_TIMEOUT_MS = 45_000;
const NATIVE_PROFILE_ID = "basebuild-native";
const LOCAL_PROVIDER_ID = "basebuild-local";
const LOGIN_POLL_MS = 1500;

type LegacyChatMessage = { role: "user" | "assistant" | "system"; content: string };

type ChatPanelProps = {
  projectPath: string;
  chatSessionId?: string | null;
  onChatSessionCreated?: (id: string) => void;
  draftPrompt?: string | null;
  onDraftConsumed?: () => void;
  autoSendDraft?: boolean;
  /** Project session id — used to persist generated ideas and seed plans. */
  activeSessionId?: string | null;
  /** Project schematic content, sent to the provider for idea generation. */
  schematicContent?: string | null;
  /** Promote a generated idea into the plan pipeline (owned by AppShell). */
  onCreatePlanFromIdea?: (title: string, description: string, chatSessionId: string | null) => Promise<void> | void;
};

function formatMetric(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function ToolEventCard({ event }: { event: NativeToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = event.status === "running" || event.status === "pending";
  const isError = event.status === "error" || event.status === "denied";
  const isApproval = event.kind === "approval" || event.kind === "request_tool_approval";
  const isCommand = event.kind === "run_command" || event.kind === "command";
  const isEdit = event.kind === "edit_file" || event.kind === "write_file";
  const icon = isApproval ? "🔐" : isCommand ? "▶" : isEdit ? "✎" : event.kind === "request_metrics" ? "📊" : "🔧";
  const statusClass = isRunning ? "running" : isError ? "error" : event.status === "success" || event.status === "recorded" || event.status === "allow" ? "success" : "info";

  return (
    <div className={`tool-card tool-card-${statusClass}`} title={`${event.kind}: ${event.status}`}>
      <div className="tool-card-header" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0}>
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-name">{event.kind.replace(/_/g, " ")}</span>
        <span className={`tool-card-status tool-card-status-${statusClass}`}>{event.status}</span>
        <span className="tool-card-expand">{expanded ? "▼" : "▶"}</span>
      </div>
      {expanded ? (
        <div className="tool-card-body">
          <pre className="tool-card-summary">{event.summary}</pre>
        </div>
      ) : null}
      {!expanded && event.summary ? (
        <div className="tool-card-summary-truncated text-muted text-sm">{event.summary.slice(0, 120)}{event.summary.length > 120 ? "…" : ""}</div>
      ) : null}
    </div>
  );
}
export function ChatPanel({
  projectPath,
  chatSessionId,
  onChatSessionCreated,
  draftPrompt,
  onDraftConsumed,
  autoSendDraft,
  activeSessionId,
  schematicContent,
  onCreatePlanFromIdea,
}: ChatPanelProps) {
  const [profileId, setProfileId] = useState(NATIVE_PROFILE_ID);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [metrics, setMetrics] = useState<NativeRequestMetricsSummary | null>(null);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
  const [nativeMessages, setNativeMessages] = useState<NativeChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<NativeToolEvent[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<LegacyChatMessage[]>([]);
  const [providerId, setProviderId] = useState(LOCAL_PROVIDER_ID);
  const [modelId, setModelId] = useState("basebuild-local-coordinator");
  const [effortLevel, setEffortLevel] = useState("medium");
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState<NativeSetupRequired | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const streamBufRef = useRef("");
  const reasoningBufRef = useRef("");
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
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState("");

  const sendTimerRef = useRef<number | null>(null);
  const assistantBufferRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();
  const ideaState = useIdeaState(activeSessionId ?? null);

  const filteredModels = useMemo(() => {
    const models = catalog?.models ?? [];
    const needle = modelFilter.trim().toLowerCase();
    const ranked = models.slice().sort((a, b) => {
      if (a.providerId === providerId && b.providerId !== providerId) return -1;
      if (a.providerId !== providerId && b.providerId === providerId) return 1;
      return a.label.localeCompare(b.label);
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
  }, [catalog, modelFilter, providerId]);
  const nativeMode = profileId === NATIVE_PROFILE_ID;
  const selectedProvider = catalog?.providers.find((p) => p.id === providerId) ?? null;
  const selectedModel = catalog?.models.find((m) => m.id === modelId) ?? null;
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
        const [defaults, cat, met, resolved] = await Promise.all([
          getRuntimeDefaults(),
          nativeProviderCatalog(),
          nativeRequestMetricsSummary(),
          nativeChatModelDefault(projectPath),
        ]);
        if (cancelled) return;
        setProfileId(defaults.defaultChatProfileId ?? NATIVE_PROFILE_ID);
        setCatalog(cat);
        setMetrics(met);
        setProviderId(resolved.providerId);
        setModelId(resolved.modelId);
        setEffortLevel(resolved.effortLevel);
        setModelNotice(resolved.notice);
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
  }, [addLog, projectPath]);

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

  // Native mode: load or create session
  useEffect(() => {
    if (!nativeMode || !catalog) return;
    let cancelled = false;
    async function loadOrCreate() {
      try {
        if (nativeSessionId) {
          const [msgs, events] = await Promise.all([
            nativeChatMessages(nativeSessionId),
            nativeChatToolEvents(nativeSessionId),
          ]);
          if (!cancelled) {
            setNativeMessages(msgs);
            setToolEvents(events);
          }
          return;
        }
        const session = await nativeChatStart({
          projectPath,
          title: "Native Chat",
          providerId,
          modelId,
          effortLevel,
        });
        if (cancelled) return;
        setNativeSessionId(session.id);
        onChatSessionCreated?.(session.id);
        setNativeMessages([]);
        setToolEvents([]);
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to open native chat", msg);
        if (!cancelled) setError(msg);
      }
    }
    void loadOrCreate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeMode, catalog, nativeSessionId, projectPath, onChatSessionCreated, addLog]);

  // Native mode: listen for streamed assistant chunks for this session
  useEffect(() => {
    const unlisten = listen<{ sessionId: string; delta: string; channel?: string }>(
      "native-chat://chunk",
      (event) => {
        if (event.payload.sessionId !== nativeSessionId) return;
        const channel = event.payload.channel;
        if (channel === "ideas") return;
        if (channel === "reasoning") {
          reasoningBufRef.current += event.payload.delta;
          setReasoningText(reasoningBufRef.current);
          return;
        }
        streamBufRef.current += event.payload.delta;
        setStreamText(streamBufRef.current);
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [nativeMode, nativeSessionId]);

  // Legacy mode: start agent
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
          const msg = e instanceof Error ? e.message : String(e);
          addLog("error", "Failed to send native message", msg);
          try {
            setNativeMessages(await nativeChatMessages(nativeSessionId));
            setToolEvents(await nativeChatToolEvents(nativeSessionId));
          } catch {
            /* ignore */
          }
        } finally {
          setStreaming(false);
          setStreamText("");
          setReasoningText("");
          streamBufRef.current = "";
          reasoningBufRef.current = "";
          setLoading(false);
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

  // Draft prompt injection
  useEffect(() => {
    if (!draftPrompt) return;
    setInput(draftPrompt);
    onDraftConsumed?.();
    if (autoSendDraft) void sendMessage(draftPrompt.trim());
  }, [draftPrompt, autoSendDraft, onDraftConsumed, sendMessage]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [nativeMessages, legacyMessages, streamText, reasoningText]);

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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (nativeMode && text.startsWith("/")) {
      const [rawCommand, ...parts] = text.slice(1).split(/\s+/);
      const command = rawCommand.toLowerCase();
      const rest = parts.join(" ").trim();
      setCommandNotice(null);

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
        },
        model: () => {
          setModelFilter(rest);
          setShowModelPicker(true);
        },
        mcp: () => {
          // MCP management is opened via Settings — show a notice.
          setCommandNotice("MCP servers are managed in Settings.");
        },
        plan: () => {
          setCommandNotice(rest ? `Plan: ${rest}` : "Plan commands: list, run <ref>, status");
        },
        idea: () => {
          setCommandNotice(rest ? `Idea: ${rest}` : "Idea commands: generate, promote");
        },
        openspec: () => {
          setCommandNotice(rest ? `OpenSpec: ${rest}` : "OpenSpec commands: generate <ref>, progress <ref>");
        },
      };

      if (command in builtinActions) {
        await builtinActions[command]();
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

      // /skill:<name> — inject skill content.
      if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        if (skillName) {
          // Skill injection: fetch skill body and send as context.
          try {
            const skillBody = await invoke<string>("read_skill", { name: skillName });
            const prompt = `${skillBody}\n\n${rest}`;
            await sendMessage(prompt);
            setInput("");
            return;
          } catch {
            setCommandNotice(`Skill '${skillName}' not found.`);
            return;
          }
        }
      }

      // Unknown command fallthrough: show notice + send-as-text action.
      setCommandNotice(`Unknown slash command: /${command}. Send as text or use /login, /model, /plan, /idea, /openspec.`);
      return;
    }
    await sendMessage(text);
  }, [input, nativeMode, sendMessage, catalog, addLog]);

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to save provider credential", msg);
      setLoginError(msg);
    } finally {
      setSavingCred(false);
    }
  }, [apiKey, baseUrl, providerId, selectedProvider, refreshCatalog, addLog]);

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
    } catch (e) {
      addLog("error", "Failed to disconnect provider", e instanceof Error ? e.message : String(e));
    }
  }, [selectedProvider, refreshCatalog, addLog]);

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
        return;
      }
      if (result.ideas.length === 0) {
        setError("No ideas were generated. Add more detail to the conversation and try again.");
        return;
      }
      if (activeSessionId) {
        for (const idea of result.ideas) {
          await ideaState.createIdea(idea.title, idea.description);
        }
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

  const renderMessages = nativeMode ? nativeMessages : legacyMessages;
  const inputDisabled = nativeMode ? !nativeSessionId : agentId === null;
  const sendDisabled = loading || !input.trim() || (nativeMode ? !nativeSessionId : agentId === null);

  const providerName = selectedProvider?.label ?? providerId;
  const modelName = selectedModel?.label ?? modelId;

  return (
    <div className="chat-panel">
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

        {renderMessages.length === 0 && !streaming && nativeMode ? (
          <div className="chat-empty-state">
            <Brain size={24} />
            <h3>Chat ready — {providerName} · {modelName}</h3>
            <p>
              Type below and press Enter to send. Turns run against the selected provider and model, and are
              stored locally with real metrics.
            </p>
            {providerDegraded ? (
              <button
                className="btn btn-sm"
                type="button"
                title={`Connect ${providerName} to enable this model`}
                onClick={() => {
                  setLoginError(null);
                  setShowLogin(true);
                }}
              >
                <Key size={11} /> Connect {providerName}
              </button>
            ) : null}
          </div>
        ) : null}

        {renderMessages.map((msg, index) => {
          const key = "id" in msg ? String(msg.id) : `legacy-${index}`;
          const isOfflineTurn =
            "providerId" in msg && msg.role === "assistant" && msg.providerId === LOCAL_PROVIDER_ID;
          return (
            <div key={key} className={`chat-message chat-message-${msg.role}`}>
              <span className="chat-message-role">
                {msg.role === "user" ? "You" : msg.role === "assistant" ? "Basebuild" : "System"}
                {isOfflineTurn ? <span className="chat-offline-tag" title="No external model was contacted">Offline</span> : null}
              </span>
              <pre className="chat-message-content">{msg.content}</pre>
            </div>
          );
        })}

        {nativeMode && toolEvents.length > 0 ? (
          <div className="chat-tool-events">
            {toolEvents.map((ev) => (
              <ToolEventCard key={ev.id} event={ev} />
            ))}
          </div>
        ) : null}


        {streaming && reasoningText ? (
          <div className="chat-message chat-message-assistant chat-message-reasoning" title="Live chain-of-thought from the model. Final answer follows.">
            <span className="chat-message-role">Thinking…</span>
            <pre className="chat-message-content">{reasoningText}</pre>
          </div>
        ) : null}

        {streaming && streamText ? (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-role">Basebuild</span>
            <pre className="chat-message-content">{streamText}</pre>
          </div>
        ) : null}

        {loading && (!streaming || (!streamText && !reasoningText)) ? (
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
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Promote this idea into the plan pipeline"
                    onClick={() => void handlePromoteIdea(idea)}
                  >
                    Promote to Plan
                  </button>
                ) : (
                  <span className="chat-idea-status">{idea.status === "picked" ? "Planned" : idea.status}</span>
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

      {/* Provider login panel: in-app API key entry + link to provider's key page */}
      {nativeMode && showLogin && selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID ? (
        <div className="chat-login-form">
          <div className="chat-login-header">
            <Key size={12} />
            <span>Connect {selectedProvider.label}</span>
            <button
              className="btn-icon btn-icon-sm"
              title="Close"
              type="button"
              onClick={() => {
                setShowLogin(false);
                cancelWebLogin();
              }}
            >
              <X size={11} />
            </button>
          </div>
          <p className="chat-login-hint">
            Enter your {selectedProvider.label} API key below.
            {selectedProvider.apiKeyUrl ? (
              <> Need a key? <button className="chat-link-btn" type="button" title={`Open ${selectedProvider.label} key page`} onClick={() => void openApiKeyUrl(selectedProvider.apiKeyUrl!)}>Get API key →</button></>
            ) : null}
          </p>
          <input
            className="input chat-login-input"
            type="password"
            placeholder="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            title="Enter your API key for this provider"
          />
          <input
            className="input chat-login-input"
            placeholder="Base URL (optional)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            title="Custom API base URL (optional)"
          />
          <button
            className="btn btn-primary btn-sm"
            type="button"
            title="Save API key and connect"
            disabled={!apiKey.trim() || savingCred}
            onClick={() => void handleSaveCredential()}
          >
            {savingCred ? "Saving…" : "Save key & connect"}
          </button>
          {loginError ? <p className="text-danger text-sm">{loginError}</p> : null}
        </div>
      ) : null}

      {/* Composer footer: always visible, never clipped */}
      <div className="chat-input-area">
        {nativeMode ? (
          <>
            <div className="chat-composer-header">
              {catalog ? (
                <>
                  <button
                    className={`btn btn-sm chat-provider-trigger${providerDegraded ? " is-warn" : ""}`}
                    type="button"
                    title={`${providerName} — ${providerDegraded ? "setup required" : "ready"}. Click to choose or connect a provider.`}
                    onClick={() => {
                      setShowProviderPicker((value) => !value);
                      setShowModelPicker(false);
                      setShowActionMenu(false);
                    }}
                  >
                    <span className={`chat-health-dot ${providerDegraded ? "is-warn" : "is-ok"}`} />
                    <span className="chat-trigger-label">{providerName}</span>
                  </button>
                  <button
                    className="btn btn-sm chat-model-trigger"
                    type="button"
                    title={`Select model. Current model: ${modelName} (${modelId})`}
                    onClick={() => {
                      setShowModelPicker((value) => !value);
                      setShowProviderPicker(false);
                      setShowActionMenu(false);
                    }}
                  >
                    <span className="chat-trigger-kicker">Model</span>
                    <span className="chat-trigger-label">{modelName}</span>
                  </button>
                  <select
                    className="input chat-select chat-effort-select"
                    title="Select effort level"
                    value={effortLevel}
                    onChange={(e) => {
                      setEffortLevel(e.target.value);
                      const next: ChatModelDefault = {
                        providerId,
                        modelId,
                        effortLevel: e.target.value,
                      };
                      void nativeChatSetProjectModelDefault(projectPath, next);
                    }}
                  >
                    {catalog.effortLevels.map((ef) => (
                      <option key={ef.id} value={ef.id}>
                        {ef.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-icon btn-icon-sm"
                    type="button"
                    title={selectedProvider?.lastSyncedAt ? `Refresh models. Last sync: ${new Date(selectedProvider.lastSyncedAt * 1000).toLocaleString()}` : "Refresh models"}
                    disabled={catalogRefreshing}
                    onClick={() => void refreshCatalog(true, selectedProvider?.id)}
                  >
                    <RefreshCw size={12} className={catalogRefreshing ? "spin" : ""} />
                  </button>
                  {providerDegraded ? (
                    <button
                      className="btn-icon btn-icon-sm"
                      type="button"
                      title={`Connect ${providerName}`}
                      onClick={() => {
                        setLoginError(null);
                        setShowLogin(true);
                        setShowProviderPicker(false);
                      }}
                    >
                      <Key size={11} />
                    </button>
                  ) : selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID ? (
                    <button
                      className="btn-icon btn-icon-sm"
                      type="button"
                      title={`Disconnect ${providerName}`}
                      onClick={() => void handleDisconnect()}
                    >
                      <Unplug size={11} />
                    </button>
                  ) : null}
                  <button
                    className="btn-icon btn-icon-sm"
                    type="button"
                    title="More chat actions"
                    onClick={() => {
                      setShowActionMenu((value) => !value);
                      setShowProviderPicker(false);
                      setShowModelPicker(false);
                    }}
                  >
                    ⋯
                  </button>
                </>
              ) : (
                <div className="chat-select-group">
                  <span className="chat-select-skeleton" />
                  <span className="chat-select-skeleton" />
                  <span className="chat-select-skeleton" />
                </div>
              )}
            </div>
            {showActionMenu ? (
              <div className="chat-inline-menu">
                <button
                  className="chat-inline-menu-item"
                  type="button"
                  title="Generate ideas from this conversation"
                  disabled={generatingIdeas || !nativeSessionId}
                  onClick={() => {
                    setShowActionMenu(false);
                    void handleGenerateIdeas();
                  }}
                >
                  <Sparkles size={11} /> {generatingIdeas ? "Generating…" : "Generate ideas"}
                </button>
              </div>
            ) : null}
            {showProviderPicker && catalog ? (
              <div className="chat-picker" role="dialog" aria-label="Choose provider">
                <div className="chat-picker-header">
                  <span>Choose provider</span>
                  <button className="btn-icon btn-icon-sm" type="button" title="Close provider picker" onClick={() => setShowProviderPicker(false)}>
                    <X size={11} />
                  </button>
                </div>
                <div className="chat-picker-list">
                  {catalog.providers.map((provider) => (
                    <button
                      key={provider.id}
                      className={`chat-picker-item${provider.id === providerId ? " is-active" : ""}`}
                      type="button"
                      title={`${provider.label}: ${provider.configured ? "connected" : "not connected"}`}
                      onClick={() => {
                        setProviderId(provider.id);
                        setShowProviderPicker(false);
                        setShowLogin(!provider.configured && provider.id !== LOCAL_PROVIDER_ID);
                        setSetupRequired(null);
                      }}
                    >
                      <span className="chat-picker-main">{provider.label}</span>
                      <span className="chat-picker-meta">{provider.configured ? `${provider.modelCount} models` : "connect"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {showModelPicker && catalog ? (
              <div className="chat-picker" role="dialog" aria-label="Choose model">
                <div className="chat-picker-header">
                  <span>Choose model</span>
                  <button className="btn-icon btn-icon-sm" type="button" title="Close model picker" onClick={() => setShowModelPicker(false)}>
                    <X size={11} />
                  </button>
                </div>
                <input
                  className="input chat-picker-search"
                  value={modelFilter}
                  placeholder="Filter models"
                  title="Filter models by provider, id, or label"
                  onChange={(e) => setModelFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowModelPicker(false);
                  }}
                />
                <div className="chat-picker-list">
                  {filteredModels.map((model) => {
                    const provider = catalog.providers.find((p) => p.id === model.providerId);
                    return (
                      <button
                        key={`${model.providerId}:${model.id}`}
                        className={`chat-picker-item${model.id === modelId && model.providerId === providerId ? " is-active" : ""}`}
                        type="button"
                        title={`${provider?.label ?? model.providerId} / ${model.id}. Source: ${model.source}`}
                        onClick={() => {
                          setProviderId(model.providerId);
                          setModelId(model.id);
                          setShowModelPicker(false);
                          setSetupRequired(null);
                          setModelNotice(null);
                          const next: ChatModelDefault = {
                            providerId: model.providerId,
                            modelId: model.id,
                            effortLevel,
                          };
                          void nativeChatSetProjectModelDefault(projectPath, next);
                        }}
                      >
                        <span className="chat-picker-main">{model.label}</span>
                        <span className="chat-picker-meta">{provider?.label ?? model.providerId} · {model.supportedEfforts.length ? model.supportedEfforts.join("/") : "standard"} · {model.source}</span>
                      </button>
                    );
                  })}
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
          </>
        ) : null}
        <div className="chat-input-row">
          <textarea
            className="input chat-input"
            placeholder={
              nativeMode
                ? "Type a message… (Enter to send, Shift+Enter for newline)"
                : "Agent not connected. Click retry above to start."
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={2}
            disabled={inputDisabled}
            title={nativeMode ? "Chat input — type a message and press Enter to send" : "Chat input — start the agent to enable sending"}
          />
          <button
            className="btn btn-primary chat-send-btn"
            type="button"
            title="Send message"
            disabled={sendDisabled}
            onClick={() => void handleSend()}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

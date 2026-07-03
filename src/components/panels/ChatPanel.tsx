import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  BarChart3,
  Brain,
  Globe,
  Key,
  Lightbulb,
  RefreshCw,
  Send,
  Sparkles,
  Unplug,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { getRuntimeDefaults } from "../../lib/settings";
import {
  nativeChatMessages,
  nativeChatSend,
  nativeChatStart,
  nativeDeleteProviderCredential,
  nativeGenerateIdeas,
  nativeProviderCatalog,
  nativeProviderLoginCancel,
  nativeProviderLoginPoll,
  nativeProviderLoginStart,
  nativeRequestMetricsSummary,
  nativeSaveProviderCredential,
  type NativeChatMessage,
  type NativeProviderCatalog,
  type NativeRequestMetricsSummary,
  type NativeSetupRequired,
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
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
  const [nativeMessages, setNativeMessages] = useState<NativeChatMessage[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<LegacyChatMessage[]>([]);
  const [metrics, setMetrics] = useState<NativeRequestMetricsSummary | null>(null);
  const [providerId, setProviderId] = useState(LOCAL_PROVIDER_ID);
  const [modelId, setModelId] = useState("basebuild-local-coordinator");
  const [effortLevel, setEffortLevel] = useState("medium");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState<NativeSetupRequired | null>(null);
  // Streaming assistant output for the in-flight turn.
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const streamBufRef = useRef("");
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

  const sendTimerRef = useRef<number | null>(null);
  const assistantBufferRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();
  const ideaState = useIdeaState(activeSessionId ?? null);

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
        const [defaults, cat, met] = await Promise.all([
          getRuntimeDefaults(),
          nativeProviderCatalog(),
          nativeRequestMetricsSummary(),
        ]);
        if (cancelled) return;
        setProfileId(defaults.defaultChatProfileId ?? NATIVE_PROFILE_ID);
        setCatalog(cat);
        setMetrics(met);
        setProviderId(cat.defaultProviderId);
        setModelId(defaults.defaultModel ?? cat.defaultModelId);
        setEffortLevel(cat.defaultEffortLevel);
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
  }, [addLog]);

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
          const msgs = await nativeChatMessages(nativeSessionId);
          if (!cancelled) setNativeMessages(msgs);
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
    if (!nativeMode || !nativeSessionId) return;
    const unlisten = listen<{ sessionId: string; delta: string; channel?: string }>(
      "native-chat://chunk",
      (event) => {
        if (event.payload.sessionId !== nativeSessionId) return;
        if (event.payload.channel === "ideas") return;
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
        setStreamText("");
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
          if (result.setupRequired) {
            setSetupRequired(result.setupRequired);
            setShowLogin(true);
          }
          setMetrics(await nativeRequestMetricsSummary());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          addLog("error", "Failed to send native message", msg);
          setError(msg);
          // The backend persists the user message before contacting the provider;
          // reload to reflect the real conversation state.
          try {
            setNativeMessages(await nativeChatMessages(nativeSessionId));
          } catch {
            /* ignore */
          }
        } finally {
          setStreaming(false);
          setStreamText("");
          streamBufRef.current = "";
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
  }, [nativeMessages, legacyMessages, streamText]);

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
    await sendMessage(text);
  }, [input, sendMessage]);

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

  const refreshCatalog = useCallback(async () => {
    try {
      setCatalog(await nativeProviderCatalog());
    } catch (e) {
      addLog("error", "Failed to refresh provider catalog", e instanceof Error ? e.message : String(e));
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
        await ideaState.updateIdeaStatus(idea.id, "planReady");
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

        {streaming && streamText ? (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-role">Basebuild</span>
            <pre className="chat-message-content">{streamText}</pre>
          </div>
        ) : null}

        {loading && (!streaming || !streamText) ? (
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
                  <span className="chat-idea-status">{idea.status === "planReady" ? "Planned" : idea.status}</span>
                )}
              </div>
              {idea.description ? <p className="chat-idea-desc">{idea.description}</p> : null}
            </div>
          ))}
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

      {/* Provider login panel: web flow + API key fallback */}
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
          {loginPolling ? (
            <>
              <p className="chat-login-hint">
                Waiting for the browser… Get an API key on the {selectedProvider.label} page, paste it, and Connect.
              </p>
              <button className="btn btn-sm" type="button" title="Cancel web login" onClick={cancelWebLogin}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              title={`Open ${selectedProvider.label} in your browser to connect`}
              onClick={() => void startWebLogin()}
            >
              <Globe size={12} /> Connect with {selectedProvider.label}
            </button>
          )}
          <div className="chat-login-sep">or paste an API key</div>
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
            className="btn btn-sm"
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
          <div className="chat-composer-header">
            {catalog ? (
              <>
                <div className="chat-select-group">
                  <select
                    className="input chat-select"
                    title="Select provider"
                    value={providerId}
                    onChange={(e) => {
                      setProviderId(e.target.value);
                      setShowLogin(false);
                      setSetupRequired(null);
                    }}
                  >
                    {catalog.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {p.configured ? "" : " — not connected"}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input chat-select"
                    title="Select model"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                  >
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input chat-select"
                    title="Select effort level"
                    value={effortLevel}
                    onChange={(e) => setEffortLevel(e.target.value)}
                  >
                    {catalog.effortLevels.map((ef) => (
                      <option key={ef.id} value={ef.id}>
                        {ef.label}
                      </option>
                    ))}
                  </select>
                </div>
                <span
                  className="chat-health"
                  title={
                    providerDegraded
                      ? `${providerName} is not connected`
                      : `${providerName} is ready`
                  }
                >
                  <span className={`chat-health-dot ${providerDegraded ? "is-warn" : "is-ok"}`} />
                  {providerDegraded ? "Setup required" : "Ready"}
                </span>
                {providerDegraded ? (
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={`Connect ${providerName}`}
                    onClick={() => {
                      setLoginError(null);
                      setShowLogin(true);
                    }}
                  >
                    <Key size={11} /> Connect
                  </button>
                ) : selectedProvider && selectedProvider.id !== LOCAL_PROVIDER_ID ? (
                  <button
                    className="btn btn-sm"
                    type="button"
                    title={`Disconnect ${providerName}`}
                    onClick={() => void handleDisconnect()}
                  >
                    <Unplug size={11} /> Disconnect
                  </button>
                ) : null}
                <span className="chat-health-spacer" />
                <button
                  className="btn btn-sm"
                  type="button"
                  title="Generate ideas from this conversation"
                  disabled={generatingIdeas || !nativeSessionId}
                  onClick={() => void handleGenerateIdeas()}
                >
                  <Sparkles size={11} /> {generatingIdeas ? "Generating…" : "Generate ideas"}
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

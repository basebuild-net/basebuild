import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertCircle, BarChart3, Brain, RefreshCw, Send, StopCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { getRuntimeDefaults } from "../../lib/settings";
import {
  nativeChatMessages,
  nativeChatSend,
  nativeChatStart,
  nativeProviderCatalog,
  nativeRequestMetricsSummary,
  type NativeChatMessage,
  type NativeProviderCatalog,
  type NativeRequestMetricsSummary,
} from "../../lib/native-chat";
import { useLogs } from "../../state/log";

const SEND_TIMEOUT_MS = 45_000;
const NATIVE_PROFILE_ID = "basebuild-native";

type LegacyChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatPanelProps = {
  projectPath: string;
  chatSessionId?: string | null;
  onChatSessionCreated?: (id: string) => void;
  /** A one-shot draft prompt injected by a workflow. Consumed exactly once. */
  draftPrompt?: string | null;
  /** Called after the draft prompt is consumed, so the caller can clear it. */
  onDraftConsumed?: () => void;
  /** Whether to auto-send the draft prompt. Defaults to false. */
  autoSendDraft?: boolean;
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
}: ChatPanelProps) {
  const [profileId, setProfileId] = useState(NATIVE_PROFILE_ID);
  const [catalog, setCatalog] = useState<NativeProviderCatalog | null>(null);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(chatSessionId ?? null);
  const [nativeMessages, setNativeMessages] = useState<NativeChatMessage[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<LegacyChatMessage[]>([]);
  const [metrics, setMetrics] = useState<NativeRequestMetricsSummary | null>(null);
  const [providerId, setProviderId] = useState("basebuild-local");
  const [modelId, setModelId] = useState("basebuild-local-coordinator");
  const [effortLevel, setEffortLevel] = useState("medium");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendTimerRef = useRef<number | null>(null);
  const assistantBufferRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();

  const nativeMode = profileId === NATIVE_PROFILE_ID;
  const selectedProvider = catalog?.providers.find((provider) => provider.id === providerId) ?? null;
  const availableModels = useMemo(
    () => catalog?.models.filter((model) => model.providerId === providerId) ?? [],
    [catalog, providerId],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadConfiguration() {
      try {
        const [defaults, nextCatalog, nextMetrics] = await Promise.all([
          getRuntimeDefaults(),
          nativeProviderCatalog(),
          nativeRequestMetricsSummary(),
        ]);
        if (cancelled) return;
        setProfileId(defaults.defaultChatProfileId ?? NATIVE_PROFILE_ID);
        setCatalog(nextCatalog);
        setMetrics(nextMetrics);
        setProviderId(nextCatalog.defaultProviderId);
        setModelId(defaults.defaultModel ?? nextCatalog.defaultModelId);
        setEffortLevel(nextCatalog.defaultEffortLevel);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("error", "Failed to load native chat configuration", message);
        setError(message);
      }
    }
    void loadConfiguration();
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  useEffect(() => {
    if (!catalog) return;
    if (availableModels.length > 0 && !availableModels.some((model) => model.id === modelId)) {
      setModelId(availableModels[0].id);
    }
  }, [availableModels, catalog, modelId]);

  useEffect(() => {
    setNativeSessionId(chatSessionId ?? null);
  }, [chatSessionId]);

  useEffect(() => {
    if (!nativeMode) return;
    if (!catalog) return;
    let cancelled = false;

    async function loadOrCreateNativeSession() {
      try {
        const id = nativeSessionId;
        if (id) {
          const messages = await nativeChatMessages(id);
          if (!cancelled) setNativeMessages(messages);
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
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("error", "Failed to open native chat", message);
        if (!cancelled) setError(message);
      }
    }

    void loadOrCreateNativeSession();
    return () => {
      cancelled = true;
    };
  }, [nativeMode, catalog, nativeSessionId, projectPath, providerId, modelId, effortLevel, onChatSessionCreated, addLog]);

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
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("error", "Failed to start agent", message);
        setError(message);
        setLegacyMessages([{ role: "system", content: `Failed to start agent: ${message}` }]);
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (startedId !== null) {
        void agentStop(startedId);
      }
    };
  }, [nativeMode, projectPath, profileId, addLog]);

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
        if (selectedProvider && !selectedProvider.configured) {
          setError(`${selectedProvider.label} is not configured. Choose Basebuild Local or configure the provider first.`);
          return;
        }
        setInput("");
        setLoading(true);
        setStuck(false);
        try {
          const result = await nativeChatSend({
            sessionId: nativeSessionId,
            content: text,
            providerId,
            modelId,
            effortLevel,
          });
          setNativeMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
          setMetrics(await nativeRequestMetricsSummary());
          setError(null);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught);
          addLog("error", "Failed to send native message", message);
          setError(message);
        } finally {
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
        addLog("error", "Agent send timed out", `No response after ${SEND_TIMEOUT_MS / 1000}s. The agent may be frozen.`);
      }, SEND_TIMEOUT_MS);

      try {
        await agentSend(agentId, text);
      } catch (caught) {
        if (sendTimerRef.current) {
          window.clearTimeout(sendTimerRef.current);
          sendTimerRef.current = null;
        }
        setStuck(false);
        const message = caught instanceof Error ? caught.message : String(caught);
        addLog("error", "Failed to send message to agent", message);
        setLegacyMessages((prev) => [...prev, { role: "system", content: `Error: ${message}` }]);
        setLoading(false);
      }
    },
    [
      nativeMode,
      nativeSessionId,
      selectedProvider,
      loading,
      providerId,
      modelId,
      effortLevel,
      agentId,
      addLog,
    ],
  );

  useEffect(() => {
    if (!draftPrompt) return;
    setInput(draftPrompt);
    onDraftConsumed?.();

    if (autoSendDraft) {
      void sendMessage(draftPrompt.trim());
    }
  }, [draftPrompt, autoSendDraft, onDraftConsumed, sendMessage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [nativeMessages, legacyMessages]);

  useEffect(() => {
    if (!loading && sendTimerRef.current) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, [loading]);

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
        // best effort recovery path
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
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })();
    }, 500);
  }, [agentId, projectPath, profileId]);

  const renderMessages = nativeMode ? nativeMessages : legacyMessages;
  const sendDisabled = loading || !input.trim() || (nativeMode ? !nativeSessionId || !!(selectedProvider && !selectedProvider.configured) : agentId === null);

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <div className="chat-toolbar-title">
          <Brain size={13} />
          <span>{nativeMode ? "Basebuild Native" : "Runtime Adapter"}</span>
          <span className="pill mono">{profileId}</span>
        </div>
        {nativeMode && catalog ? (
          <div className="chat-controls">
            <select className="input chat-select" title="Select native provider" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {catalog.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
            <select className="input chat-select" title="Select native model" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <select className="input chat-select" title="Select effort level" value={effortLevel} onChange={(event) => setEffortLevel(event.target.value)}>
              {catalog.effortLevels.map((effort) => (
                <option key={effort.id} value={effort.id}>{effort.label}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {nativeMode && metrics ? (
        <div className="chat-metrics" title="Local OMP-stats-style native request metrics">
          <BarChart3 size={12} />
          <span>{metrics.totalRequests} req</span>
          <span>{metrics.totalInputTokens + metrics.totalOutputTokens} tok</span>
          <span>{formatMetric(metrics.avgTokensPerSecond, " tok/s")}</span>
          <span>TTFT {formatMetric(metrics.avgTtftMs, "ms")}</span>
          <span>TTLT {formatMetric(metrics.avgTtltMs, "ms")}</span>
        </div>
      ) : null}

      {nativeMode && selectedProvider && !selectedProvider.configured ? (
        <div className="chat-setup-bar">
          <AlertCircle size={12} />
          <span>{selectedProvider.detail}</span>
        </div>
      ) : null}

      <div className="chat-messages" ref={scrollRef}>
        {renderMessages.length === 0 ? (
          <div className="chat-empty-state">
            <Brain size={24} />
            <h3>Native chat ready</h3>
            <p>Start a local Basebuild harness conversation. Requests are stored as structured chat and local metrics.</p>
          </div>
        ) : null}
        {renderMessages.map((msg, index) => {
          const key = "id" in msg ? String(msg.id) : `legacy-${index}`;
          return (
            <div key={key} className={`chat-message chat-message-${msg.role}`}>
              <span className="chat-message-role">
                {msg.role === "user" ? "You" : msg.role === "assistant" ? "Basebuild" : "System"}
              </span>
              <pre className="chat-message-content">{msg.content}</pre>
            </div>
          );
        })}
        {loading ? <div className="chat-loading">{nativeMode ? "Native harness is working…" : "Agent is typing…"}</div> : null}
        {stuck ? (
          <div className="chat-stuck-bar">
            <AlertCircle size={12} />
            <span className="text-sm">Agent appears frozen. No response after {SEND_TIMEOUT_MS / 1000}s.</span>
            <button className="btn btn-sm" type="button" title="Stop and restart the agent session" onClick={() => void handleStopAgent()}>
              <StopCircle size={12} /> Stop &amp; restart
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="chat-error-bar">
          <AlertCircle size={12} />
          <span className="text-sm">{error}</span>
          <button className="btn-icon btn-icon-sm" title="Clear chat error" type="button" onClick={() => setError(null)}>
            <RefreshCw size={11} />
          </button>
        </div>
      ) : null}

      <div className="chat-input-area">
        <textarea
          className="input chat-input"
          placeholder={nativeMode ? "Type a message… (Enter to send, Shift+Enter for newline)" : "Agent not connected. Click retry above to start."}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          disabled={nativeMode ? !nativeSessionId : agentId === null}
          title={nativeMode ? "Chat input — type a message and press Enter to send" : "Chat input — start the agent to enable sending"}
        />
        <button className="btn btn-primary chat-send-btn" type="button" title="Send message" disabled={sendDisabled} onClick={() => void handleSend()}>
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

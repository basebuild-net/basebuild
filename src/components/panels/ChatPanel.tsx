import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertCircle, BarChart3, Brain, Key, RefreshCw, Send, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { getRuntimeDefaults } from "../../lib/settings";
import {
  nativeChatMessages,
  nativeChatSend,
  nativeChatStart,
  nativeProviderCatalog,
  nativeRequestMetricsSummary,
  nativeSaveProviderCredential,
  type NativeChatMessage,
  type NativeProviderCatalog,
  type NativeRequestMetricsSummary,
} from "../../lib/native-chat";
import { useLogs } from "../../state/log";

const SEND_TIMEOUT_MS = 45_000;
const NATIVE_PROFILE_ID = "basebuild-native";

type LegacyChatMessage = { role: "user" | "assistant" | "system"; content: string };

type ChatPanelProps = {
  projectPath: string;
  chatSessionId?: string | null;
  onChatSessionCreated?: (id: string) => void;
  draftPrompt?: string | null;
  onDraftConsumed?: () => void;
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
  const [showLogin, setShowLogin] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const sendTimerRef = useRef<number | null>(null);
  const assistantBufferRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();

  const nativeMode = profileId === NATIVE_PROFILE_ID;
  const selectedProvider = catalog?.providers.find((p) => p.id === providerId) ?? null;
  const availableModels = useMemo(
    () => catalog?.models.filter((m) => m.providerId === providerId) ?? [],
    [catalog, providerId],
  );

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
    return () => { cancelled = true; };
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
          projectPath, title: "Native Chat",
          providerId, modelId, effortLevel,
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
    return () => { cancelled = true; };
  }, [nativeMode, catalog, nativeSessionId, projectPath, providerId, modelId, effortLevel, onChatSessionCreated, addLog]);

  // Legacy mode: start agent
  useEffect(() => {
    if (nativeMode) return;
    let cancelled = false;
    let startedId: number | null = null;
    async function start() {
      try {
        const id = await agentStart({ cwd: projectPath, profileId });
        if (cancelled) { void agentStop(id); return; }
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
    return () => { cancelled = true; if (startedId !== null) void agentStop(startedId); };
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
    return () => { void unlisten.then((fn) => fn()); };
  }, [agentId, nativeMode]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    if (nativeMode) {
      if (!nativeSessionId) return;
      if (selectedProvider && !selectedProvider.configured) {
        setShowLogin(true);
        return;
      }
      setInput("");
      setLoading(true);
      setStuck(false);
      try {
        const result = await nativeChatSend({ sessionId: nativeSessionId, content: text, providerId, modelId, effortLevel });
        setNativeMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
        setMetrics(await nativeRequestMetricsSummary());
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", "Failed to send native message", msg);
        setError(msg);
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
      setStuck(true); setLoading(false);
      addLog("error", "Agent send timed out", `No response after ${SEND_TIMEOUT_MS / 1000}s.`);
    }, SEND_TIMEOUT_MS);
    try {
      await agentSend(agentId, text);
    } catch (e) {
      if (sendTimerRef.current) { window.clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
      setStuck(false);
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to send message to agent", msg);
      setLegacyMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      setLoading(false);
    }
  }, [nativeMode, nativeSessionId, selectedProvider, loading, providerId, modelId, effortLevel, agentId, addLog]);

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
  }, [nativeMessages, legacyMessages]);

  // Clear stuck timer
  useEffect(() => {
    if (!loading && sendTimerRef.current) { window.clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
  }, [loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    await sendMessage(text);
  }, [input, sendMessage]);

  const handleStopAgent = useCallback(async () => {
    if (sendTimerRef.current) { window.clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
    setStuck(false); setLoading(false);
    if (agentId !== null) {
      try { await agentStop(agentId); } catch { /* ignore */ }
      setAgentId(null);
    }
    setLegacyMessages((prev) => [...prev, { role: "system", content: "Agent session stopped. Reloading..." }]);
    window.setTimeout(() => {
      void (async () => {
        try {
          const id = await agentStart({ cwd: projectPath, profileId });
          setAgentId(id);
          setLegacyMessages([{ role: "system", content: "Agent session restarted." }]);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      })();
    }, 500);
  }, [agentId, projectPath, profileId]);

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
      // Refresh catalog to update configured status
      const cat = await nativeProviderCatalog();
      setCatalog(cat);
      setShowLogin(false);
      setApiKey("");
      setBaseUrl("");
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", "Failed to save provider credential", msg);
      setError(msg);
    } finally {
      setSavingCred(false);
    }
  }, [apiKey, baseUrl, providerId, selectedProvider, addLog]);

  const renderMessages = nativeMode ? nativeMessages : legacyMessages;
  const inputDisabled = nativeMode ? !nativeSessionId : agentId === null;
  const sendDisabled = loading || !input.trim() || (nativeMode ? !nativeSessionId || !!(selectedProvider && !selectedProvider.configured) : agentId === null);

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

        {renderMessages.length === 0 && nativeMode ? (
          <div className="chat-empty-state">
            <Brain size={24} />
            <h3>Native chat ready</h3>
            <p>Send a message to start. Requests are stored locally as structured chat with metrics.</p>
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
        {loading ? <div className="chat-loading">{nativeMode ? "Working…" : "Agent is typing…"}</div> : null}
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

      {/* Provider login form */}
      {showLogin && selectedProvider && !selectedProvider.configured ? (
        <div className="chat-login-form">
          <div className="chat-login-header">
            <Key size={12} />
            <span>Connect to {selectedProvider.label}</span>
            <button className="btn-icon btn-icon-sm" title="Close" type="button" onClick={() => setShowLogin(false)}>
              <X size={11} />
            </button>
          </div>
          <input
            className="input chat-login-input"
            type="password"
            placeholder="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            title="Enter your API key for this provider"
          />
          {providerId === "umans" || providerId === "openai" ? (
            <input
              className="input chat-login-input"
              placeholder="Base URL (optional, e.g. https://api.umans.ai/v1)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              title="Custom API base URL (optional)"
            />
          ) : null}
          <button
            className="btn btn-primary btn-sm"
            type="button"
            title="Save credential and connect"
            disabled={!apiKey.trim() || savingCred}
            onClick={() => void handleSaveCredential()}
          >
            {savingCred ? "Saving…" : "Connect"}
          </button>
        </div>
      ) : null}

      {/* Input area with selectors */}
      <div className="chat-input-area">
        {nativeMode && catalog ? (
          <div className="chat-input-controls">
            <select className="input chat-select" title="Select provider" value={providerId} onChange={(e) => { setProviderId(e.target.value); setShowLogin(false); }}>
              {catalog.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}{p.configured ? "" : " — not connected"}</option>
              ))}
            </select>
            <select className="input chat-select" title="Select model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <select className="input chat-select" title="Select effort level" value={effortLevel} onChange={(e) => setEffortLevel(e.target.value)}>
              {catalog.effortLevels.map((ef) => (
                <option key={ef.id} value={ef.id}>{ef.label}</option>
              ))}
            </select>
            {selectedProvider && !selectedProvider.configured ? (
              <button className="btn btn-sm" type="button" title={`Connect to ${selectedProvider.label}`} onClick={() => setShowLogin(true)}>
                <Key size={11} /> Connect
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="chat-input-row">
          <textarea
            className="input chat-input"
            placeholder={nativeMode ? "Type a message… (Enter to send, Shift+Enter for newline)" : "Agent not connected. Click retry above to start."}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
            }}
            rows={2}
            disabled={inputDisabled}
            title={nativeMode ? "Chat input — type a message and press Enter to send" : "Chat input — start the agent to enable sending"}
          />
          <button className="btn btn-primary chat-send-btn" type="button" title="Send message" disabled={sendDisabled} onClick={() => void handleSend()}>
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

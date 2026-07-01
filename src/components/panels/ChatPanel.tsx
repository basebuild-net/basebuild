import { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, RefreshCw, Send } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { useLogs } from "../../state/log";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatPanelProps = {
  projectPath: string;
  /** A one-shot draft prompt injected by a workflow. Consumed exactly once. */
  draftPrompt?: string | null;
  /** Called after the draft prompt is consumed, so the caller can clear it. */
  onDraftConsumed?: () => void;
  /** Whether to auto-send the draft prompt. Defaults to false. */
  autoSendDraft?: boolean;
};

export function ChatPanel({ projectPath, draftPrompt, onDraftConsumed, autoSendDraft }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assistantBufferRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();

  // Start the agent when the panel mounts
  useEffect(() => {
    let cancelled = false;
    let startedId: number | null = null;

    async function start() {
      try {
        const id = await agentStart({ cwd: projectPath });
        if (cancelled) {
          void agentStop(id);
          return;
        }
        startedId = id;
        setAgentId(id);
        setError(null);
        setMessages([{ role: "system", content: "Agent session started. Type a message to begin." }]);
      } catch (e) {
        const msg = String(e);
        addLog("error", "Failed to start agent", msg);
        setError(msg);
        setMessages([{ role: "system", content: `Failed to start agent: ${msg}` }]);
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (startedId !== null) {
        void agentStop(startedId);
      }
    };
  }, [projectPath, addLog]);

  // Listen for agent output
  useEffect(() => {
    const unlisten = listen<{ id: number; kind: string; data?: string }>("agent://output", (event) => {
      if (agentId !== null && event.payload.id !== agentId) return;

      if (event.payload.kind === "close") {
        setLoading(false);
        setMessages((prev) => [...prev, { role: "system", content: "Agent session ended." }]);
        return;
      }

      const chunk = event.payload.data ?? "";
      assistantBufferRef.current += chunk;

      // Update the last assistant message or create one
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          return [...prev.slice(0, -1), { role: "assistant", content: assistantBufferRef.current }];
        }
        return [...prev, { role: "assistant", content: assistantBufferRef.current }];
      });
      setLoading(false);
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [agentId]);

  // Inject draft prompt into the input without sending by default
  useEffect(() => {
    if (!draftPrompt) return;
    setInput(draftPrompt);
    onDraftConsumed?.();

    if (autoSendDraft && agentId) {
      // Auto-send is only enabled by explicit user setting
      const text = draftPrompt.trim();
      if (!text) return;
      setLoading(true);
      assistantBufferRef.current = "";
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      void agentSend(agentId, text).catch((e) => {
        addLog("error", "Failed to send draft to agent", String(e));
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${e}` }]);
        setLoading(false);
      });
    }
  }, [draftPrompt, autoSendDraft, agentId, onDraftConsumed, addLog]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || agentId === null || loading) return;

    setInput("");
    setLoading(true);
    assistantBufferRef.current = "";
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      await agentSend(agentId, text);
    } catch (e) {
      addLog("error", "Failed to send message to agent", String(e));
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${e}` }]);
      setLoading(false);
    }
  }, [input, agentId, loading, addLog]);

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <span className="chat-message-role">{msg.role === "user" ? "You" : msg.role === "assistant" ? "Agent" : "System"}</span>
            <pre className="chat-message-content">{msg.content}</pre>
          </div>
        ))}
        {loading ? <div className="chat-loading">Agent is typing…</div> : null}
      </div>
      {error ? (
        <div className="chat-error-bar">
          <AlertCircle size={12} />
          <span className="text-sm">{error}</span>
          <button
            className="btn-icon btn-icon-sm"
            title="Retry agent start"
            type="button"
            onClick={() => { setError(null); setAgentId(null); }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      ) : null}
      <div className="chat-input-area">
        <textarea
          className="input chat-input"
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          disabled={agentId === null}
          title="Chat input — type a message and press Enter to send"
        />
        <button
          className="btn btn-primary chat-send-btn"
          type="button"
          title="Send message"
          disabled={!input.trim() || agentId === null || loading}
          onClick={() => void handleSend()}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

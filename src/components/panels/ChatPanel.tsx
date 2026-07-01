import { useEffect, useRef, useState, useCallback } from "react";
import { Send } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { agentStart, agentSend, agentStop } from "../../lib/agent";
import { useLogs } from "../../state/log";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatPanelProps = {
  projectPath: string;
  terminalId?: number;
};

export function ChatPanel({ projectPath }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const assistantBufferRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addLog } = useLogs();

  // Start the agent when the panel mounts
  useEffect(() => {
    let cancelled = false;
    let startedId: number | null = null;

    async function start() {
      try {
        const id = await agentStart(projectPath);
        if (cancelled) {
          void agentStop(id);
          return;
        }
        startedId = id;
        setAgentId(id);
        setMessages([{ role: "system", content: "Agent session started. Type a message to begin." }]);
      } catch (e) {
        addLog("error", "Failed to start agent", String(e));
        setMessages([{ role: "system", content: `Failed to start agent: ${e}` }]);
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

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !agentId || loading) return;

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
          disabled={!agentId || loading}
        />
        <button
          className="btn btn-primary chat-send-btn"
          type="button"
          title="Send message"
          disabled={!input.trim() || !agentId || loading}
          onClick={() => void handleSend()}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

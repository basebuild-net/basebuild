import { useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { MarkdownView } from "../MarkdownView";
import { parseCommandPayload } from "../../../lib/chatCommands";

export function ThinkingBlock({ text }: { text: string }) {
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
      {expanded ? <MarkdownView text={text} className="chat-thinking-content" /> : null}
    </div>
  );
}

export function UserMessageContent({
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

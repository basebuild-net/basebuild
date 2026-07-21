import { type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { AlertCircle, Copy, Edit2, Loader2, RefreshCw } from "lucide-react";
import { LogoPulse } from "../../layout/LogoPulse";
import { MarkdownView } from "../MarkdownView";
import { QuestionCard } from "../QuestionCard";
import type { ChatEvent } from "../../../lib/chatTimeline";
import type { NativeChatMessage, NativeModel, NativeProviderCatalog, NativeToolEvent } from "../../../lib/native-chat";
import type { PendingInteraction } from "../../../lib/interactions";
import type { ApprovalMode } from "../../../lib/settings";
import type { Idea } from "../../../lib/ideas";
import { ThinkingBlock, UserMessageContent } from "./ChatMessageParts";
import { ToolEventCard } from "./ToolEventCard";
import {
  SEND_TIMEOUT_MS,
  LOCAL_PROVIDER_ID,
  detectProseQuickReplies,
  formatElapsed,
  resolveAssistantLabel,
  type LegacyChatMessage,
} from "./chatFormat";

type ChatTranscriptProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  nativeMode: boolean;
  chatTimeline: ChatEvent[];
  debugMode: boolean;
  ideas: Idea[];
  catalog: NativeProviderCatalog | null;
  selectedModel: NativeModel | null;
  modelId: string;
  providerId: string;
  streaming: boolean;
  loading: boolean;
  renderMessages: (NativeChatMessage | LegacyChatMessage)[];
  reasoningText: string;
  streamText: string;
  streamPhase: "idle" | "thinking" | "streaming" | "tools";
  phaseElapsed: number;
  elapsed: number;
  toolCallChars: number;
  pendingToolName: string | null;
  quietSeconds: number;
  toolEvents: NativeToolEvent[];
  stalled: boolean;
  toolAgoSeconds: number;
  lastToolKind: string;
  interruptedRun: boolean;
  stuck: boolean;
  interactions: PendingInteraction[];
  minimizedIdeaBatchIdsRef: RefObject<Set<string>>;
  handleResolveApproval: (toolCallId: string, decision: "allow" | "allow_session" | "deny") => void;
  handleSetApprovalMode: (mode: ApprovalMode) => void;
  setInteractions: Dispatch<SetStateAction<PendingInteraction[]>>;
  setFocusedIdeaBatchId: Dispatch<SetStateAction<string | null>>;
  setCommandPayloadModal: Dispatch<SetStateAction<{ name: string; content: string } | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  handleCopyMessage: (content: string) => void;
  handleRetryMessage: () => void;
  handleEditAndResend: () => void;
  handleStopNative: () => void;
  handleStopAgent: () => void;
  sendMessage: (text: string) => void;
};

export function ChatTranscript({
  scrollRef,
  chatInputRef,
  nativeMode,
  chatTimeline,
  debugMode,
  ideas,
  catalog,
  selectedModel,
  modelId,
  providerId,
  streaming,
  loading,
  renderMessages,
  reasoningText,
  streamText,
  streamPhase,
  phaseElapsed,
  elapsed,
  toolCallChars,
  pendingToolName,
  quietSeconds,
  toolEvents,
  stalled,
  toolAgoSeconds,
  lastToolKind,
  interruptedRun,
  stuck,
  interactions,
  minimizedIdeaBatchIdsRef,
  handleResolveApproval,
  handleSetApprovalMode,
  setInteractions,
  setFocusedIdeaBatchId,
  setCommandPayloadModal,
  setInput,
  handleCopyMessage,
  handleRetryMessage,
  handleEditAndResend,
  handleStopNative,
  handleStopAgent,
  sendMessage,
}: ChatTranscriptProps) {
  return (
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
              const rendered: ReactNode[] = [];
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
                      ideas={ideas}
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
                          ideas={ideas}
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
        {/* Provider is writing a tool call — its JSON streams on a hidden
            channel, so without this row the transcript freezes mid-turn. */}
        {streaming && streamPhase !== "tools" && toolCallChars > 0 ? (
          <div
            className="chat-loading chat-loading-active"
            title={`The model is writing a ${pendingToolName ? pendingToolName.replace(/_/g, " ") : "tool"} call (${(toolCallChars / 1024).toFixed(1)} KB streamed). It appears as a tool card when complete.`}
          >
            <LogoPulse size={14} className="chat-loading-spinner" />
            <span className="chat-loading-label">
              Writing {pendingToolName ? pendingToolName.replace(/_/g, " ") : "tool call"}…
            </span>
            <span className="chat-loading-count" title={`${(toolCallChars / 1024).toFixed(1)} KB of tool arguments streamed`}>
              {(toolCallChars / 1024).toFixed(1)} KB
            </span>
            <span className="chat-elapsed-badge" title={`Phase: ${formatElapsed(phaseElapsed)}`}>{formatElapsed(phaseElapsed)}</span>
          </div>
        ) : null}

        {/* Quiet-provider hint: streaming but nothing arrived for 30s+. */}
        {streaming && streamPhase !== "tools" && quietSeconds >= 30 ? (
          <div className="chat-loading" title={`No streamed output for ${quietSeconds}s. The provider may be slow; keep waiting or stop the turn.`}>
            <span className="chat-loading-label">Still waiting — no output for {quietSeconds}s…</span>
            <button
              className="chat-tool-stalled-cancel"
              type="button"
              title="Stop the current turn"
              onClick={() => void handleStopNative()}
            >
              Stop
            </button>
          </div>
        ) : null}

        {/* Waiting for first token with elapsed timer */}
        {streaming && streamPhase === "thinking" && !streamText && !reasoningText && toolCallChars === 0 ? (
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
  );
}

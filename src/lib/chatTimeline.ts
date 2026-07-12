import type { NativeChatMessage, NativeToolEvent } from "./native-chat";
import type { PendingInteraction } from "./interactions";

/** A single row in the flat chronological chat timeline. */
export type ChatEvent =
  | { kind: "user" | "assistant" | "system"; id: string; content: string; reasoning: string | null; createdAt: number | null; providerId: string | null; modelId: string | null; index: number }
  | { kind: "tool"; id: string; event: NativeToolEvent; createdAt: number | null; index: number }
  | { kind: "interaction"; id: string; interaction: PendingInteraction; createdAt: number | null; index: number };

/**
 * Build the merged chronological event list from messages, tool events,
 * and interactions. Each tool call is its own row — no grouping. Thinking
 * blocks render as separate rows, split around tool calls/questions.
 *
 * Sorting is by (createdAt, index) — stable chronological order. Tool
 * events use their own `createdAt` and `sequence` (not the parent
 * message's timestamp) so they appear at the correct position. Live tool
 * events (null `messageId`) use their own `createdAt` too, so they sort
 * to where they occurred, not the top of the conversation.
 */
export function buildChatTimeline(
  messages: readonly NativeChatMessage[],
  toolEvents: readonly NativeToolEvent[],
  interactions: readonly PendingInteraction[],
): ChatEvent[] {
  const events: ChatEvent[] = [];

  // Bucket bound tool events by their parent message id once (O(m + t))
  // instead of scanning all tool events per message (O(m × t)).
  const toolsByMessage = new Map<string, NativeToolEvent[]>();
  for (const te of toolEvents) {
    if (te.messageId) {
      const bucket = toolsByMessage.get(te.messageId);
      if (bucket) bucket.push(te);
      else toolsByMessage.set(te.messageId, [te]);
    }
  }

  // Messages with their bound tool events.
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgId = msg.id ?? `legacy-${i}`;
    events.push({
      kind: msg.role as "user" | "assistant" | "system",
      id: msgId,
      content: msg.content,
      reasoning: msg.reasoning ?? null,
      createdAt: msg.createdAt ?? null,
      providerId: msg.providerId ?? null,
      modelId: msg.modelId ?? null,
      index: i,
    });
    const bound = msg.id ? toolsByMessage.get(msg.id) : undefined;
    if (bound) {
      for (const te of bound) {
        events.push({
          kind: "tool",
          id: te.id,
          event: te,
          createdAt: te.createdAt,
          // Fractional index: parent message index + sequence fraction.
          // Ensures bound tools sort after their parent message and
          // before the next message, regardless of timestamps.
          index: i + te.sequence * 0.001,
        });
      }
    }
  }

  // Live tool events (null messageId) — use their own createdAt. They
  // belong to the in-flight turn, so on a timestamp tie (second
  // granularity) with any message they must sort AFTER all messages:
  // index = messages.length + sequence. Without this offset a pending
  // approval card emitted in the same second as the (possibly huge)
  // optimistic user message sorts above it and ends up off-screen.
  for (const te of toolEvents) {
    if (!te.messageId) {
      events.push({
        kind: "tool",
        id: te.id,
        event: te,
        createdAt: te.createdAt,
        index: messages.length + te.sequence,
      });
    }
  }

  // Live interactions (no messageId binding yet). Interactions persist
  // createdAt in MILLISECONDS while messages/tool events use SECONDS, so
  // normalize to seconds — otherwise every interaction's ~1000× larger
  // timestamp sorts it to the very bottom of the transcript instead of the
  // chronological point where the question was asked.
  for (const intr of interactions) {
    const raw = intr.createdAt ?? null;
    const createdAt = raw != null && raw > 1e12 ? Math.floor(raw / 1000) : raw;
    events.push({
      kind: "interaction",
      id: intr.id,
      interaction: intr,
      createdAt,
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

  return events;
}

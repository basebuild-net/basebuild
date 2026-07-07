import { useCallback, useEffect, useState } from "react";

export type PromptMode = "insert" | "send";

export type PromptDelivery = {
  actionId: string;
  chatSessionId: string;
  text: string;
  mode: PromptMode;
};

type DeliverOpts = {
  chatSessionId: string;
  text: string;
  mode: PromptMode;
  actionId?: string;
};

// Module-level state — survives panel remounts and React re-renders.
// One pending delivery per chatSessionId (latest wins).
const pendingDeliveries = new Map<string, PromptDelivery>();
const deliveryListeners = new Map<string, Set<(d: PromptDelivery) => void>>();
const consumedActionIds = new Set<string>();

/**
 * Queue a prompt for delivery to a specific chat session. The target
 * ChatPanel consumes it via {@link usePromptDelivery} when its native session
 * is ready (catalog loaded for `send` mode). Exactly-once per `actionId`:
 * a repeated call with the same actionId is a no-op.
 *
 * @returns the actionId (generated if not supplied).
 */
export function deliverPrompt(opts: DeliverOpts): string {
  const actionId = opts.actionId ?? `pd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (consumedActionIds.has(actionId)) return actionId;
  const delivery: PromptDelivery = { actionId, chatSessionId: opts.chatSessionId, text: opts.text, mode: opts.mode };
  pendingDeliveries.set(opts.chatSessionId, delivery);
  deliveryListeners.get(opts.chatSessionId)?.forEach((fn) => fn(delivery));
  return actionId;
}


/**
 * Mark a delivery as consumed (exactly-once). Called by ChatPanel after it
 * has acted on the delivery (insert or send).
 */
export function consumeDelivery(chatSessionId: string): PromptDelivery | null {
  const d = pendingDeliveries.get(chatSessionId);
  if (!d) return null;
  pendingDeliveries.delete(chatSessionId);
  consumedActionIds.add(d.actionId);
  return d;
}

/**
 * React hook: surfaces the pending delivery for a chat session, or null.
 * The caller is responsible for calling {@link consumeDelivery} once it has
 * acted on the delivery (insert/setInput or send). The hook re-checks on
 * every `chatSessionId` change so deliveries queued before the session
 * existed are picked up when the id arrives.
 */
export function usePromptDelivery(chatSessionId: string | null): {
  delivery: PromptDelivery | null;
  consume: () => void;
} {
  const [delivery, setDelivery] = useState<PromptDelivery | null>(() =>
    chatSessionId ? (pendingDeliveries.get(chatSessionId) ?? null) : null,
  );

  useEffect(() => {
    if (!chatSessionId) {
      setDelivery(null);
      return;
    }
    // Check for a delivery that was queued before this session id was known.
    const existing = pendingDeliveries.get(chatSessionId) ?? null;
    if (existing) {
      setDelivery(existing);
    } else {
      setDelivery(null);
    }
    // Subscribe to future deliveries for this session.
    const handler = (d: PromptDelivery) => setDelivery(d);
    let listeners = deliveryListeners.get(chatSessionId);
    if (!listeners) {
      listeners = new Set();
      deliveryListeners.set(chatSessionId, listeners);
    }
    listeners.add(handler);
    return () => {
      deliveryListeners.get(chatSessionId)?.delete(handler);
    };
  }, [chatSessionId]);

  const consume = useCallback(() => {
    if (!chatSessionId) return;
    consumeDelivery(chatSessionId);
    setDelivery(null);
  }, [chatSessionId]);

  return { delivery, consume };
}

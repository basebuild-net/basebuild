export type Event<T> = {
  event: string;
  id: number;
  payload: T;
};

export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;

type ListenerEntry = { event: string; handler: EventCallback<unknown> };

const listeners: ListenerEntry[] = [];
let nextEventId = 1;

export async function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  const entry: ListenerEntry = { event, handler: handler as EventCallback<unknown> };
  listeners.push(entry);
  return () => {
    const idx = listeners.indexOf(entry);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Emit an event to all registered listeners (e2e test helper).
 *  Exposed on `window.__emit` so Playwright's `page.evaluate` can simulate
 *  backend events like `plan_run://event`. */
export function __emit<T>(event: string, payload: T): void {
  const evt: Event<T> = { event, id: nextEventId++, payload };
  for (const entry of listeners) {
    if (entry.event === event) {
      entry.handler(evt as Event<unknown>);
    }
  }
}

// Expose on window for e2e tests (Playwright page.evaluate).
const w = globalThis as typeof globalThis & { __emit?: typeof __emit };
w.__emit = __emit;

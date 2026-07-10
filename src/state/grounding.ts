// Module-level shared state for the last idea/category generation's
// grounding metadata. ChatPanel writes after nativeGenerateIdeas returns;
// PlanningInspector reads to render the batch header provenance line.
// This is a lightweight pub-sub — no React context needed since the
// data changes only on explicit generation calls.

import type { GroundingMetadata } from "../lib/native-chat";

type Listener = (grounding: GroundingMetadata | null) => void;

let currentGrounding: GroundingMetadata | null = null;
const listeners = new Set<Listener>();

export function setLastGrounding(grounding: GroundingMetadata | null): void {
  currentGrounding = grounding;
  for (const listener of listeners) {
    listener(currentGrounding);
  }
}

export function getLastGrounding(): GroundingMetadata | null {
  return currentGrounding;
}

export function subscribeGrounding(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

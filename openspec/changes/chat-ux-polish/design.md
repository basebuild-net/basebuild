# Design: Chat UX Polish

## Context
ChatPanel.tsx (~3100 lines) renders the conversation transcript with messages,
tool events, reasoning blocks, and interactions. Auto-scroll follows the bottom
when within 80px. Reasoning blocks currently default to collapsed. No in-conversation
search or copy-conversation action exists. The thinking toggle button was missing
a tooltip (fixed in this change).

## Goals / Non-Goals
**Goals**:
- Scroll-to-bottom button when scrolled up
- Reasoning blocks default expanded
- In-conversation search (Ctrl+F)
- Copy conversation as markdown

**Non-Goals**:
- Cross-session search (only current conversation)
- Search in tool event JSON payloads (only visible text)
- Changing the chat transport or data model

## Decisions

**Decision**: Scroll-to-bottom button as a floating overlay inside the scroll container
— **Rationale**: Keeps it scoped to the transcript area, doesn't interfere with
the composer or header. Uses `position: sticky` or absolute within the scroll
container's parent. **Alternatives**: Fixed position (breaks with multiple panels).

**Decision**: Search bar as a thin bar at the top of the transcript area
— **Rationale**: Familiar pattern (browser Find), doesn't obscure content.
Uses the browser's native `window.find` is unreliable in webviews, so we
implement text highlighting by wrapping matches in `<mark>` elements.
**Alternatives**: Modal search (too heavy for quick lookups).

**Decision**: Copy conversation iterates `buildChatTimeline` output
— **Rationale**: Reuses the already-extracted pure function, ensuring the
markdown export matches the on-screen order. **Alternatives**: Separate
serialization from messages array (would duplicate ordering logic).

**Decision**: Reasoning block default expanded = `true`
— **Rationale**: The spec says "Thinking blocks render as separate rows" —
defaulting to collapsed hides the agent's thinking. Users who want compact
view can collapse. **Alternatives**: Setting (too much complexity for this).

## Risks / Trade-offs
- Text highlighting with `<mark>` requires DOM manipulation after render →
  use a `useEffect` that walks the transcript container's text nodes. Risk:
  performance on very long conversations. Mitigation: cap search to first
  500 matches, debounce input by 150ms.
- Scroll-to-bottom button needs accurate "is at bottom" detection → reuse
  the existing 80px threshold from auto-scroll logic.

## Migration Plan
No migration needed — pure UI additions. No data model or API changes.

## Open Questions
None — all decisions are self-contained UI work.

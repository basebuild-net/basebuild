# Proposal: Chat UX Polish

## Why

The chat transcript has several UX gaps that reduce readability, accessibility, and usability during multi-turn conversations with tool calls: no scroll-to-bottom button when scrolled up during streaming, reasoning blocks default to collapsed (hiding the agent's thinking trace), no in-conversation search, no copy-conversation action, a history toggle that is a no-op, inline style on the textarea (violating the globals.css-only rule), missing aria-expanded on tool card headers, and missing aria labels on chat messages. These are self-contained improvements that increase transcript legibility and accessibility without changing the chat transport or data model.

## What Changes

- Add a scroll-to-bottom floating button that appears when the user has scrolled up during streaming or after completion, with a tooltip and 0px-radius styling
- Change thinking/reasoning blocks to default expanded (currently default collapsed), so the agent's reasoning is visible without an extra click
- Add a missing `title=` tooltip on the thinking toggle button (done)
- Add a `Ctrl+F` / `Cmd+F` in-conversation search bar that highlights matching text in messages and tool cards, with next/prev navigation
- Add a "Copy conversation" action in the chat header that copies the full transcript as markdown to the clipboard
- Wire the history toggle button in ChatHeader to actually open the HistoryDrawer (currently a no-op `() => {}`)
- Replace inline style on textarea auto-resize with a CSS class or CSS custom property approach
- Add `aria-expanded` to tool card header buttons
- Add `aria-label` to chat message rows for screen readers
- Add `aria-live` region for streaming/tool-running status updates

## Capabilities

### New Capabilities
- `chat-transcript-ux` — scroll-to-bottom, message search, copy conversation, history toggle wiring

### Modified Capabilities
- `tool-transcript-rendering` — thinking block default expanded, aria-expanded on tool cards, aria-label on messages, aria-live for streaming

## Impact

- `src/components/panels/ChatPanel.tsx` — scroll-to-bottom button, search bar, copy conversation, thinking block default, aria attributes, textarea inline style fix, history toggle wiring
- `src/styles/globals.css` — new CSS classes for scroll-to-bottom button, search bar, copy action, textarea auto-resize
- `tests/e2e/chat-edge-cases.spec.ts` — new tests for scroll-to-bottom, search, copy conversation, thinking block default, history toggle

## ADDED Requirements

### Requirement: Scroll-to-bottom button
The transcript SHALL show a floating scroll-to-bottom button when the user has scrolled up from the bottom of the conversation. The button SHALL appear during streaming and after completion, disappear when the user is already at the bottom, and scroll to the bottom instantly on click. The button SHALL have a `title=` tooltip, 0px border radius, and use `globals.css` classes only.

#### Scenario: Button appears when scrolled up during streaming
- **WHEN** the agent is streaming and the user scrolls up past 80px from the bottom
- **THEN** a floating scroll-to-bottom button appears in the bottom-right of the transcript area

#### Scenario: Button disappears at bottom
- **WHEN** the user is within 80px of the bottom of the transcript
- **THEN** the scroll-to-bottom button is not visible

#### Scenario: Click scrolls to bottom
- **WHEN** the user clicks the scroll-to-bottom button
- **THEN** the transcript scrolls to the bottom instantly and the button disappears

### Requirement: In-conversation search
The chat panel SHALL provide a search bar (toggled by `Ctrl+F` / `Cmd+F`) that searches across all rendered messages and tool card text in the current conversation. Matching text SHALL be highlighted, and the search SHALL provide next/prev navigation and a match count. The search bar SHALL use `globals.css` classes, 0px border radius, and `title=` tooltips on all interactive elements.

#### Scenario: Ctrl+F opens search
- **WHEN** the user presses `Ctrl+F` or `Cmd+F` while the chat panel is focused
- **THEN** a search bar appears at the top of the transcript area with a text input, match count, and prev/next buttons

#### Scenario: Typing highlights matches
- **WHEN** the user types a search query
- **THEN** all matching text in messages and tool cards is highlighted and the match count updates

#### Scenario: Next/prev navigates matches
- **WHEN** the user clicks next or prev (or presses Enter / Shift+Enter)
- **THEN** the transcript scrolls to the next or previous match and the active match is visually distinct

#### Scenario: Escape closes search
- **WHEN** the user presses Escape while the search bar is open
- **THEN** the search bar closes, highlights are cleared, and focus returns to the chat input

### Requirement: Copy conversation as markdown
The chat header SHALL include a "Copy conversation" button that copies the full transcript (messages, reasoning, tool event summaries) as markdown to the clipboard. The button SHALL have a `title=` tooltip and show a toast on success or failure.

#### Scenario: Copy produces markdown
- **WHEN** the user clicks the "Copy conversation" button
- **THEN** the full transcript is copied to the clipboard as markdown with user/assistant labels, timestamps, tool event summaries, and reasoning blocks

#### Scenario: Empty conversation shows disabled state
- **WHEN** the conversation has no messages
- **THEN** the "Copy conversation" button is disabled with a tooltip explaining why

### Requirement: History toggle wired to drawer
The chat header's history toggle button SHALL open the HistoryDrawer when clicked. The button SHALL not be a no-op.

#### Scenario: Click opens history drawer
- **WHEN** the user clicks the history toggle button in the chat header
- **THEN** the HistoryDrawer opens with closed panel entries

## MODIFIED Requirements

### Requirement: Tool cards in the transcript
The system SHALL normalize native and OMP-backed agent events into one ordered
activity timeline containing assistant text, reasoning availability, tool
calls, questions, captures, approvals, notices, errors, and completion. Every
active run SHALL show its latest operation and status; the UI SHALL NOT leave a
run at an unexplained prose-only "gathering information" state. Thinking/reasoning
blocks SHALL default to expanded so the agent's thinking trace is visible without
an extra click; the user MAY collapse them manually. Tool card header buttons
SHALL have `aria-expanded` reflecting the collapse state. Chat message rows
SHALL have `aria-label` attributes for screen reader accessibility. Streaming
and tool-running states SHALL be announced via an `aria-live` region.

#### Scenario: Agent reads files then asks a question
- **WHEN** a planning agent reads repository files and emits an `ask_user`
  question
- **THEN** the reads appear as tool activity in order, the question appears as
  an interactive blocking card, and answering it resumes the same run once

#### Scenario: Transport cannot expose activity
- **WHEN** a provider transport cannot produce the event contract required by a
  managed planning run
- **THEN** the run is prevented before send with a visible capability error
  rather than pretending to execute tools

#### Scenario: Reasoning blocks default expanded
- **WHEN** an assistant message with reasoning is rendered in the transcript
- **THEN** the reasoning block is visible by default without requiring a click, and the user may collapse it

#### Scenario: Tool card header has aria-expanded
- **WHEN** a tool card is rendered in the transcript
- **THEN** its header button has `aria-expanded` set to `true` when expanded and `false` when collapsed

#### Scenario: Chat messages have aria labels
- **WHEN** a chat message is rendered in the transcript
- **THEN** the message row has an `aria-label` describing the role and content snippet for screen readers

#### Scenario: Streaming status announced to screen readers
- **WHEN** the agent is streaming or running a tool
- **THEN** an `aria-live` region announces the current status (e.g., "Agent is responding", "Running tool: read_file")

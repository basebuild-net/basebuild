## MODIFIED Requirements

### Requirement: Agent Chat Panel
The system SHALL provide a non-terminal chat panel that communicates with agent runtimes through structured native or RPC events, rendering messages as a scrollable conversation plus an ordered activity timeline. The chat panel SHALL render inside a chat column within the workspace grid, with a per-chat header above the conversation, a compact composer rail, and a context status strip adjacent to or below the input. All assistant content SHALL support Markdown formatting, code fences, tables, lists, links, and syntax-highlighted code.

#### Scenario: User opens a chat tab
- **WHEN** the user clicks `+` and selects `Chat`
- **THEN** a new chat tab is created with a single-column grid containing one new chat column, and the agent chat panel is displayed inside that column

#### Scenario: User sends a message
- **WHEN** the user types a message and presses Enter (or clicks Send)
- **THEN** the message is sent to the configured agent runtime, the response is rendered as a new assistant message, and runtime/tool/thinking activity streams into the timeline as separate rows

#### Scenario: Agent is processing
- **WHEN** the agent is processing a request
- **THEN** the chat panel shows a loading indicator tied to the current phase (`thinking`, `streaming`, `running tools`, `waiting for answer`, `queued`, or `blocked`) and disables only actions that would conflict with the active run

#### Scenario: Chat panel inside a grid cell
- **WHEN** the chat panel is rendered as one of multiple columns in a `1×N` or `M×N` grid
- **THEN** the header, timeline, composer rail, context strip, and input are fully visible and operable at the column's width, and the conversation scrolls independently within the column

### Requirement: Reasoning channel separation
Reasoning/thinking tokens (e.g. `reasoning_content` from reasoning-capable models) SHALL be stored separately from assistant message content, SHALL render as visually distinct `Thinking` timeline blocks, and SHALL NOT be sent back to providers as part of prior assistant turns. A thinking block SHALL end before a tool call, question, approval, capture, notice, or assistant text segment that interrupts it; later reasoning SHALL render as a new thinking block. The system MUST NOT concatenate reasoning and content into one persisted string.

#### Scenario: Reasoning hidden but available
- **WHEN** a model streams reasoning followed by the answer `GLM52-OK`
- **THEN** the message bubble shows `GLM52-OK` with a distinct Thinking timeline row, not a combined reasoning/content blob

#### Scenario: Thinking visually distinct from reply
- **WHEN** a thinking section is expanded or streaming live
- **THEN** it renders with a labelled treatment and muted/vibrant theme tokens so it can never be confused with the assistant's final reply text

#### Scenario: Reasoning excluded from context
- **WHEN** a follow-up message is sent in a session whose history contains reasoning
- **THEN** the provider request contains only the content portions of prior assistant turns and tool results needed by the protocol

#### Scenario: Stray think tags sanitized
- **WHEN** a provider emits literal `<LM-thinking>`/`</LM-thinking>` markers inside the content channel
- **THEN** the persisted content has the markers stripped and the enclosed text routed to the reasoning store

#### Scenario: Tool call splits thinking
- **WHEN** reasoning streams before and after a tool call in the same logical turn
- **THEN** the UI persists and renders two thinking blocks separated by the tool call/result row

### Requirement: Agent Capability Surface
The system SHALL expose typed runtime capabilities for chat messages, tools, questions, approvals, providers, models, commands, OpenSpec execution, context metrics, and activity events so OMP, native, and future runtimes can connect without hardcoding runtime-specific branches into React components.

#### Scenario: Load capabilities
- **WHEN** a chat runtime starts
- **THEN** the frontend can request supported capabilities, including chat, tools, questions, approvals, providers, model metadata, commands, context metrics, and activity events

#### Scenario: Unsupported capability
- **WHEN** the UI requests a capability the active runtime does not support
- **THEN** the backend returns a typed unsupported-capability error and the UI displays it inline with an actionable message

#### Scenario: Planning requires tools and questions
- **WHEN** the user launches an OpenSpec planning run
- **THEN** the UI verifies the selected runtime can expose activity, tools, and questions before dispatching the run

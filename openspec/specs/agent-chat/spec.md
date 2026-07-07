# agent-chat Specification

<!-- Created from MODIFIED delta of change 'chat-context-defaults'; base ADDED requirements live in the still-active 'stabilize-and-agent-chat' change. When that change archives, skip same-named requirements — these versions are newer. -->

## Requirements

### Requirement: Agent Chat Panel
The system SHALL provide a non-terminal chat panel that communicates with CLI agents via structured RPC, rendering messages as a scrollable conversation. The chat panel SHALL render inside a chat column within a chat grid tab, with a per-chat header (per the `chat-header-context` capability) above its conversation and a compact composer rail (per `chat-composer-controls`) above the input.

#### Scenario: User opens a chat tab
- **WHEN** the user clicks "+" in the workspace tab bar and selects "Chat"
- **THEN** a new chat tab is created with a single-column grid containing one new chat column, and the agent chat panel is displayed inside that column

#### Scenario: User sends a message
- **WHEN** the user types a message and presses Enter (or clicks Send)
- **THEN** the message is sent to the configured agent adapter, and the response is rendered as a new assistant message in the conversation

#### Scenario: Agent is processing
- **WHEN** the agent is processing a request
- **THEN** the chat panel shows a loading indicator and disables the send button

#### Scenario: Chat panel inside a grid cell
- **WHEN** the chat panel is rendered as one of multiple columns in a `1×N` or `M×N` grid
- **THEN** the panel's composer rail and input are fully visible and operable at the column's width (clamped to the minimum), and the conversation scrolls independently within the column

### Requirement: Chat Draft Injection
The system SHALL allow other workflows to focus a chat tab and place a generated draft prompt into a specific chat column's chat input without sending it automatically.

#### Scenario: Inject draft into existing chat
- **WHEN** a workflow requests chat with a draft prompt and the active chat tab's grid has at least one chat column
- **THEN** the system focuses the target chat column, displays its chat panel, and replaces the chat input draft with the requested prompt

#### Scenario: Inject draft into new chat
- **WHEN** a workflow requests chat with a draft prompt and the active chat tab's grid is empty or no chat tab exists
- **THEN** the system creates a new chat column (or a new chat tab if none is active), focuses it, displays the chat panel, and places the requested prompt in the chat input

#### Scenario: User reviews before send
- **WHEN** a draft prompt is injected and the user has not enabled an explicit auto-send default
- **THEN** the prompt remains in the chat input and is not sent to the adapter until the user presses Send or Enter

#### Scenario: Explicit auto-send default
- **WHEN** a draft prompt is injected and the user has enabled the explicit auto-send generated prompts default
- **THEN** the prompt is sent only after permission checks pass, and the chat records the user message visibly before streaming any assistant response

### Requirement: Agent Capability Surface
The system SHALL expose typed adapter capabilities for chat messages, skills, providers, information, and commands so OMP features can be connected without hardcoding them into React components.

#### Scenario: Load capabilities
- **WHEN** a chat adapter starts
- **THEN** the frontend can request the adapter's supported capabilities, including chat, skills, providers, commands, and information endpoints

#### Scenario: Unsupported capability
- **WHEN** the UI requests a capability the active adapter does not support
- **THEN** the backend returns a typed unsupported-capability error and the UI displays it inline with an actionable message

#### Scenario: OMP skills visible
- **WHEN** the OMP adapter reports available skills
- **THEN** the chat UI can render those skills as selectable context or commands without knowing OMP-specific command syntax

### Requirement: Message Streaming Integrity
The system SHALL maintain coherent chat turns when adapter output streams over a PTY or structured RPC channel.

#### Scenario: Streaming assistant response
- **WHEN** the adapter emits assistant output chunks for a message
- **THEN** the chat appends chunks to the current assistant turn instead of creating unrelated messages for each chunk

#### Scenario: Command echo handling
- **WHEN** a PTY-backed adapter echoes user input or control sequences
- **THEN** the chat filters or marks echoes so user-entered text does not appear as assistant content

#### Scenario: Agent session closes
- **WHEN** the adapter process exits
- **THEN** the chat marks the session ended, disables send until restarted, and retains visible conversation history

### Requirement: Agent Chat Panel
The system SHALL provide a non-terminal chat panel that communicates with CLI agents via structured RPC, rendering messages as a scrollable conversation.

#### Scenario: User opens a chat tab
- **WHEN** the user clicks "+" in the workspace tab bar and selects "Chat"
- **THEN** a new chat tab is created and the agent chat panel is displayed

#### Scenario: User sends a message
- **WHEN** the user types a message and presses Enter (or clicks Send)
- **THEN** the message is sent to the configured agent adapter, and the response is rendered as a new assistant message in the conversation

#### Scenario: Agent is processing
- **WHEN** the agent is processing a request
- **THEN** the chat panel shows a loading indicator and disables the send button

### Requirement: Agent Adapter Architecture
The system SHALL use an agent-agnostic adapter pattern so multiple CLI agents (OMP, Claude Code, Codex CLI) can be supported without changing the chat UI.

#### Scenario: Default adapter
- **WHEN** the app starts
- **THEN** the OhMyPi adapter is used by default

#### Scenario: Adapter selection (future)
- **WHEN** additional adapters are registered
- **THEN** the user can select between them in the chat panel header

### Requirement: Unsupported Feature Error Surfacing
The system SHALL catch unsupported OMP features and surface them in the error UI rather than crashing.

#### Scenario: Unsupported feature encountered
- **WHEN** the agent adapter receives a response containing an unsupported feature
- **THEN** the error is logged to the warnings/errors panel with an "unsupported" tag and the chat panel shows an inline error message

### Requirement: Reasoning channel separation
Reasoning/thinking tokens (e.g. `reasoning_content` from Umans GLM or
DeepSeek-style models) SHALL be stored separately from the assistant
message content, SHALL render as a collapsed, visually distinct "thinking"
section, and SHALL NOT be sent back to providers as part of prior assistant
turns. The system MUST NOT concatenate reasoning and content into one
persisted string (the current `{reasoning}\n\n---\n\n{content}` fold).

#### Scenario: Reasoning hidden by default
- **WHEN** a model streams reasoning followed by the answer "GLM52-OK"
- **THEN** the message bubble shows "GLM52-OK" with a collapsed expandable
  thinking section, not "The user wants me to reply with exactly … ---
  GLM52-OK"

#### Scenario: Thinking visually distinct from reply
- **WHEN** a thinking section is expanded (or streaming live)
- **THEN** it renders with clearly distinct styling (muted/labelled
  "Thinking" treatment per DESIGN.md) so it can never be confused with the
  assistant's reply text at a glance

#### Scenario: Reasoning excluded from context
- **WHEN** a follow-up message is sent in a session whose history contains
  reasoning
- **THEN** the provider request contains only the content portions of prior
  assistant turns

#### Scenario: Stray think tags sanitized
- **WHEN** a provider emits literal `<LM-thinking>`/`</LM-thinking>` markers inside the
  content channel
- **THEN** the persisted content has the markers stripped and the enclosed
  text routed to the reasoning store
